/**
 * The authoritative world.
 *
 * Everything the players can see lives in this object, in memory. Nothing here
 * touches the database: positions change ten times a second, and a database
 * write per step would be the end of the server. Durable saving is a separate,
 * slow job — see `docs/SPEC.md` section 7.
 *
 * This file has no sockets and no timers on purpose. It takes the current time
 * as an argument and returns decisions, so every rule in it can be tested
 * without a network.
 */
import {
  CHAT_RADIUS_TILES,
  MIN_STEP_INTERVAL_MS,
  VIEW_MARGIN_TILES,
  VIEW_RADIUS_TILES,
  directionBetween,
  isValidTile,
  step as stepTile,
  tileDistance,
  type Direction,
  type TilePos,
} from '@atheriam/shared';
import type { PlayerView, RejectReason } from '@atheriam/protocol';
import type { GameMap } from './map.js';
import { spawnPoint } from './map.js';
import { canStep, findPath } from './pathfinding.js';
import { cleanChatText, newChatAllowance, takeChatToken, type ChatAllowance } from './chat.js';

/** A player as the server knows them. More than the client is ever told. */
export interface PlayerState {
  readonly id: string;
  readonly name: string;
  x: number;
  y: number;
  facing: Direction;
  appearance: number;
  /** When this player last moved a tile, used to enforce the speed limit. */
  lastStepAtMs: number;
  /** Tiles still to walk, in order. Empty means standing still. */
  path: TilePos[];
  /** How many things this player may still say before they must slow down. */
  chat: ChatAllowance;
  /**
   * When a moderator's mute runs out, as a clock time in milliseconds, or null
   * when this player is not muted.
   */
  mutedUntilMs: number | null;
  /**
   * Character ids this player has chosen not to hear. Blocking is personal and
   * one-way: it hides somebody from you, and tells them nothing.
   */
  blocked: ReadonlySet<string>;
}

/**
 * Who is entering the world.
 *
 * The world server never invents this. It comes from the ticket the player
 * presented, which the API issued to a logged-in account.
 */
export interface JoiningCharacter {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly facing: Direction;
  readonly appearance?: number;
  /** A mute a moderator set earlier, if it has not run out. */
  readonly mutedUntilMs?: number | null;
  /** The people this player has blocked, from the database. */
  readonly blocked?: readonly string[];
}

export type JoinResult =
  { ok: true; player: PlayerState } | { ok: false; reason: 'already-online' | 'server-full' };

/** Who heard a remark, or why nobody did. */
export type SayResult =
  | { ok: true; text: string; from: PlayerState; listeners: string[] }
  | { ok: false; reason: RejectReason };

export interface WorldOptions {
  /** Refuse new players past this many. Protects memory and bandwidth. */
  readonly maxPlayers?: number;
}

const DEFAULT_MAX_PLAYERS = 200;

export class World {
  readonly map: GameMap;
  private readonly players = new Map<string, PlayerState>();
  /** Lower-cased name -> id, so two players cannot share a name. */
  private readonly namesInUse = new Map<string, string>();
  private readonly maxPlayers: number;
  private currentTick = 0;
  private currentRevision = 0;

  constructor(map: GameMap, options: WorldOptions = {}) {
    this.map = map;
    this.maxPlayers = options.maxPlayers ?? DEFAULT_MAX_PLAYERS;
  }

  get tick(): number {
    return this.currentTick;
  }

  /**
   * Goes up by one every time anything a player could see changes: somebody
   * joined, somebody left, somebody moved.
   *
   * The server uses it to answer "does this client's picture need refreshing?"
   * without comparing whole snapshots. Phase 3 narrows this down per observer;
   * for one district it is enough that any change refreshes everyone, because
   * interest management already keeps each message small.
   */
  get revision(): number {
    return this.currentRevision;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get(id: string): PlayerState | undefined {
    return this.players.get(id);
  }

  /**
   * Put a character into the world, where they last stood.
   *
   * A character who is somehow already connected is refused rather than
   * duplicated: two copies of one person would be two inventories later, and
   * that is how items get duplicated.
   */
  join(character: JoiningCharacter, nowMs: number): JoinResult {
    if (this.players.size >= this.maxPlayers) {
      return { ok: false, reason: 'server-full' };
    }
    const nameKey = character.name.toLocaleLowerCase();
    if (this.namesInUse.has(nameKey) || this.players.has(character.id)) {
      return { ok: false, reason: 'already-online' };
    }

    // Where they logged out, unless that tile is no longer somewhere a person
    // can stand — a building may have been put there while they were away.
    const saved = { x: character.x, y: character.y };
    const start = this.map.isWalkable(saved) ? saved : spawnPoint(this.map);

    const player: PlayerState = {
      id: character.id,
      name: character.name,
      x: start.x,
      y: start.y,
      facing: character.facing,
      appearance: character.appearance ?? 0,
      // Dated in the past so a player may move as soon as they arrive.
      lastStepAtMs: nowMs - MIN_STEP_INTERVAL_MS,
      path: [],
      chat: newChatAllowance(nowMs),
      mutedUntilMs: character.mutedUntilMs ?? null,
      blocked: new Set(character.blocked ?? []),
    };
    this.players.set(player.id, player);
    this.namesInUse.set(nameKey, player.id);
    this.currentRevision += 1;
    return { ok: true, player };
  }

  setAppearance(id: string, appearance: number): void {
    const player = this.players.get(id);
    if (player === undefined || !Number.isInteger(appearance) || appearance < 0 || appearance > 5)
      return;
    player.appearance = appearance;
    this.currentRevision += 1;
  }

  /** Take a player out of the world. Safe to call twice. */
  leave(id: string): void {
    const player = this.players.get(id);
    if (player === undefined) return;
    this.players.delete(id);
    this.namesInUse.delete(player.name.toLocaleLowerCase());
    this.currentRevision += 1;
  }

  /**
   * "I want to take one step this way."
   *
   * Returns `null` when the step was taken, or the reason it was refused.
   * Every refusal is a normal event: a slow connection produces them, and so
   * does a modified client. They are treated the same way.
   */
  handleStep(id: string, direction: Direction, nowMs: number): RejectReason | null {
    const player = this.players.get(id);
    if (player === undefined) return 'not-joined';

    if (nowMs - player.lastStepAtMs < MIN_STEP_INTERVAL_MS) return 'too-fast';

    const from: TilePos = { x: player.x, y: player.y };
    const to = stepTile(from, direction);

    if (!isValidTile(to) || !this.map.contains(to)) return 'out-of-bounds';
    if (!canStep(this.map, from, to)) return 'blocked';

    // A manual step cancels whatever route the player was following.
    player.path = [];
    this.place(player, to, nowMs);
    return null;
  }

  /**
   * "I want to be over there."
   *
   * The server finds the route. The client is never asked for one, so it can
   * never invent a route through a wall.
   */
  handleWalkTo(id: string, to: TilePos): RejectReason | null {
    const player = this.players.get(id);
    if (player === undefined) return 'not-joined';

    if (!isValidTile(to)) return 'out-of-bounds';
    if (!this.map.contains(to)) return 'out-of-bounds';
    if (!this.map.isWalkable(to)) return 'blocked';

    const path = findPath(this.map, { x: player.x, y: player.y }, to);
    if (path === null) return 'no-path';

    player.path = path;
    return null;
  }

  /**
   * "I want to say this out loud."
   *
   * Returns who hears it and what they hear, or the reason nobody does. The
   * speaker is included in the list of listeners: seeing your own words appear
   * is how you know the server accepted them.
   *
   * Three things are decided here and nowhere else: the words are cleaned, the
   * speaker must not be muted or flooding, and only the people close enough —
   * who have not blocked the speaker — are listed. A client is never told
   * about a remark it is not allowed to hear, so there is nothing to filter in
   * the browser.
   */
  handleSay(id: string, rawText: string, nowMs: number): SayResult {
    const player = this.players.get(id);
    if (player === undefined) return { ok: false, reason: 'not-joined' };

    if (player.mutedUntilMs !== null && nowMs < player.mutedUntilMs) {
      return { ok: false, reason: 'muted' };
    }

    const text = cleanChatText(rawText);
    if (text === null) return { ok: false, reason: 'malformed' };

    if (!takeChatToken(player.chat, nowMs)) return { ok: false, reason: 'too-chatty' };

    const listeners: string[] = [];
    for (const other of this.players.values()) {
      if (tileDistance(player, other) > CHAT_RADIUS_TILES) continue;
      if (other.blocked.has(player.id)) continue;
      listeners.push(other.id);
    }

    return { ok: true, text, from: player, listeners };
  }

  /**
   * Silence a player, or let them speak again by passing a time in the past.
   *
   * The world server holds the mute in memory so it costs nothing to check on
   * every message; the database row is what makes it survive a restart.
   */
  mute(id: string, untilMs: number | null): void {
    const player = this.players.get(id);
    if (player === undefined) return;
    player.mutedUntilMs = untilMs;
  }

  /** Stop delivering one player's words to another. Personal and one-way. */
  block(blockerId: string, blockedId: string, blocked: boolean): void {
    const player = this.players.get(blockerId);
    if (player === undefined) return;
    const next = new Set(player.blocked);
    if (blocked) next.add(blockedId);
    else next.delete(blockedId);
    player.blocked = next;
  }

  /** "Stop where I am." Always allowed, for anyone who is in the world. */
  handleStop(id: string): RejectReason | null {
    const player = this.players.get(id);
    if (player === undefined) return 'not-joined';
    player.path = [];
    return null;
  }

  /**
   * Advance the simulation by one tick: every player following a route moves
   * one tile, if enough time has passed since their last step.
   *
   * Returns the ids of the players who actually moved, so the caller only
   * sends snapshots when something changed.
   */
  advance(nowMs: number): Set<string> {
    this.currentTick += 1;
    const moved = new Set<string>();

    for (const player of this.players.values()) {
      const next = player.path[0];
      if (next === undefined) continue;
      if (nowMs - player.lastStepAtMs < MIN_STEP_INTERVAL_MS) continue;

      // The map cannot change today, but it will once doors exist, so the
      // route is re-checked every single step rather than trusted.
      if (!canStep(this.map, { x: player.x, y: player.y }, next)) {
        player.path = [];
        continue;
      }

      player.path.shift();
      this.place(player, next, nowMs);
      moved.add(player.id);
    }

    return moved;
  }

  /**
   * What one player is allowed to know: themselves, and the players close
   * enough to matter. Anyone further away is not sent at all, which keeps
   * bandwidth flat as the city fills up and means a modified client cannot see
   * across the map.
   */
  viewFor(id: string): { you: PlayerView; players: PlayerView[] } | null {
    const me = this.players.get(id);
    if (me === undefined) return null;

    const limit = VIEW_RADIUS_TILES + VIEW_MARGIN_TILES;
    const nearby: PlayerView[] = [];
    for (const other of this.players.values()) {
      if (other.id === me.id) continue;
      if (tileDistance(me, other) > limit) continue;
      nearby.push(toView(other));
    }

    return { you: toView(me), players: nearby };
  }

  private place(player: PlayerState, to: TilePos, nowMs: number): void {
    const facing = directionBetween({ x: player.x, y: player.y }, to);
    if (facing !== null) player.facing = facing;
    player.x = to.x;
    player.y = to.y;
    player.lastStepAtMs = nowMs;
    this.currentRevision += 1;
  }
}

function toView(player: PlayerState): PlayerView {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    facing: player.facing,
    appearance: player.appearance,
  };
}
