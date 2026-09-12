/**
 * The WebSocket server: the only door into the world.
 *
 * Its whole job is to take bytes off a socket, refuse anything that is not a
 * valid intent, hand what is left to `World`, and send back what each player is
 * allowed to know. All the game rules live in `world.ts`; none live here.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CHUNK_SIZE_TILES,
  HOUSE_ENTRANCE,
  INTERIOR_ENTRANCE,
  TICK_MS,
  chunkKey,
  type TilePos,
} from '@atheriam/shared';
import {
  PROTOCOL_VERSION,
  decodeClientMessage,
  encode,
  type Bye,
  type PlayerView,
  type ServerMessage,
} from '@atheriam/protocol';
import { spawnPoint } from './map.js';
import {
  Realms,
  houseIdOf,
  houseRealm,
  propertyIdOf,
  propertyRealm,
  type RealmId,
} from './realms.js';
import { chunksInView, diffChunks } from './streaming.js';
import type { JoiningCharacter, PlayerState, World } from './world.js';

/**
 * The most messages one connection may send per second. A normal player sends
 * a handful; anything near this limit is a script, and a script that ignores
 * the limit is disconnected rather than served.
 */
const MAX_MESSAGES_PER_SECOND = 40;

/** A connection that has said nothing at all for this long is dropped. */
const IDLE_TIMEOUT_MS = 60_000;

/** How often we check for silent, half-dead connections. */
const HEARTBEAT_INTERVAL_MS = 15_000;

interface Connection {
  readonly socket: WebSocket;
  /** Null until the player has successfully joined. */
  playerId: string | null;
  lastMessageAtMs: number;
  /** Start of the current one-second window used for rate limiting. */
  windowStartedAtMs: number;
  messagesInWindow: number;
  /**
   * The world revision this connection was last told about. -1 means it has
   * never had a snapshot, so the first one is always sent.
   */
  lastSentRevision: number;
  /**
   * Where this client believes everybody is, by character id.
   *
   * A snapshot is a difference against this, so a crowd standing still costs
   * nothing to keep on screen. Without it, a busy square repeats "nobody has
   * moved" to every player ten times a second — measured at 144 kB a second
   * each in a load test.
   */
  readonly believes: Map<string, string>;
  /**
   * The chunks of the map this client has been given, by key. A chunk is only
   * added once it has actually gone out, so a socket that dies mid-send is
   * simply sent it again rather than left with a hole in the world.
   */
  readonly chunks: Set<string>;
  /** Where this player is: the city, or the inside of one house. */
  realm: RealmId;
  /**
   * Where they were standing in the city before they went indoors, so that
   * coming out puts them back on the doorstep rather than in the square.
   */
  cityPosition: TilePos | null;
  alive: boolean;
}

/**
 * How the world server reaches the things it does not own.
 *
 * Both of these are passed in rather than imported, so that the tests can run
 * the real server against simple stand-ins, and so that this file never grows
 * a database connection of its own.
 */
export interface WorldServerOptions {
  readonly host: string;
  readonly port: number;
  readonly world: World;
  /**
   * Spend a ticket and say which character it belongs to. A ticket works
   * once; a second attempt with the same one must return null.
   */
  readonly resolveTicket: (ticket: string) => Promise<JoiningCharacter | null>;
  /**
   * Write a character's position down. Called when they leave, never per
   * step — see `docs/SPEC.md` section 7.
   */
  readonly savePosition: (character: {
    id: string;
    x: number;
    y: number;
    facing: JoiningCharacter['facing'];
  }) => Promise<void>;
  /** Injectable clock, so tests do not depend on the wall clock. */
  readonly now?: () => number;
  readonly heartbeatIntervalMs?: number;
  /** Read-only authorization; rechecked while visitors remain inside. */
  readonly canEnterProperty?: (characterId: string, propertyId: string) => Promise<boolean>;
}

export class WorldServer {
  private readonly wss: WebSocketServer;
  /** The city, and the inside of every house somebody is standing in. */
  private readonly realms: Realms;
  private readonly connections = new Map<WebSocket, Connection>();
  /** The same connections, found by the character playing on them. */
  private readonly byPlayer = new Map<string, Connection>();
  private readonly now: () => number;
  private readonly heartbeatIntervalMs: number;
  private readonly resolveTicket: WorldServerOptions['resolveTicket'];
  private readonly savePosition: WorldServerOptions['savePosition'];
  private readonly canEnterProperty: (characterId: string, propertyId: string) => Promise<boolean>;
  private readonly checkingProperties = new Set<Connection>();
  private nextPropertyCheck = 0;
  private tickTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: WorldServerOptions) {
    this.realms = new Realms(options.world);
    this.canEnterProperty = options.canEnterProperty ?? (async () => false);
    this.now = options.now ?? (() => Date.now());
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.resolveTicket = options.resolveTicket;
    this.savePosition = options.savePosition;
    this.wss = new WebSocketServer({ host: options.host, port: options.port });
    this.wss.on('connection', (socket) => this.onConnection(socket));
  }

  /** The city itself. Everything that is not inside somebody's house. */
  private get world(): World {
    return this.realms.city;
  }

  /** The world one connection is standing in. */
  private worldOf(connection: Connection): World {
    return this.realms.get(connection.realm);
  }

  /** How many houses have somebody in them. */
  get occupiedHouses(): number {
    return this.realms.occupiedHouses;
  }

  /** The port actually in use. Useful when the port was chosen as 0. */
  get port(): number {
    const address = this.wss.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  setAppearance(characterId: string, appearance: number): void {
    for (const connection of this.connections.values()) {
      if (connection.playerId === characterId)
        this.worldOf(connection).setAppearance(characterId, appearance);
    }
  }

  /** Start the simulation loop. */
  start(): void {
    this.tickTimer = setInterval(() => this.onTick(), TICK_MS);
    this.heartbeatTimer = setInterval(() => this.onHeartbeat(), this.heartbeatIntervalMs);
  }

  /** Stop cleanly: tell everyone why, then close. */
  async stop(): Promise<void> {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.tickTimer = null;
    this.heartbeatTimer = null;

    for (const connection of this.connections.values()) {
      this.send(connection, { t: 'bye', reason: 'shutdown' });
      connection.socket.close();
    }
    this.connections.clear();

    await new Promise<void>((resolve, reject) => {
      this.wss.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private onConnection(socket: WebSocket): void {
    const nowMs = this.now();
    const connection: Connection = {
      socket,
      playerId: null,
      lastMessageAtMs: nowMs,
      windowStartedAtMs: nowMs,
      messagesInWindow: 0,
      lastSentRevision: -1,
      believes: new Map<string, string>(),
      chunks: new Set<string>(),
      realm: 'city',
      cityPosition: null,
      alive: true,
    };
    this.connections.set(socket, connection);

    socket.on('message', (data) => this.onMessage(connection, String(data)));
    socket.on('pong', () => {
      connection.alive = true;
      // Reading, decorating and waiting for friends are normal social play.
      // A healthy joined browser stays connected without movement/chat intents.
      // Unauthenticated sockets still have a deadline to present a ticket.
      if (connection.playerId !== null) connection.lastMessageAtMs = this.now();
    });
    socket.on('close', () => this.onClose(connection));
    socket.on('error', () => this.onClose(connection));
  }

  private onClose(connection: Connection): void {
    const playerId = connection.playerId;
    if (playerId !== null) {
      const world = this.worldOf(connection);
      const player = world.get(playerId);
      connection.playerId = null;
      this.byPlayer.delete(playerId);
      world.leave(playerId);
      this.realms.forgetIfEmpty(connection.realm);

      if (player !== undefined) {
        /*
         * Where they stood is written down now, once, as they leave.
         *
         * Somebody who closes the tab inside a house has their *doorstep*
         * written down, not the spot on the floorboards: a house tile means
         * nothing in the city, and saving it would put them somewhere
         * arbitrary next time they log in.
         *
         * A failure here must not take the server down with it. The worst case
         * is that one player starts tomorrow a few tiles from where they
         * stopped.
         */
        const outside = connection.cityPosition;
        const saved =
          connection.realm === 'city' || outside === null ? { x: player.x, y: player.y } : outside;

        void this.savePosition({
          id: player.id,
          x: saved.x,
          y: saved.y,
          facing: player.facing,
        }).catch((error: unknown) => {
          console.error('[world] could not save a position on disconnect:', error);
        });
      }
    }
    this.connections.delete(connection.socket);
  }

  private onMessage(connection: Connection, raw: string): void {
    const nowMs = this.now();
    connection.lastMessageAtMs = nowMs;

    if (this.isFlooding(connection, nowMs)) {
      this.disconnect(connection, 'protocol-error');
      return;
    }

    const decoded = decodeClientMessage(raw);
    if (!decoded.ok) {
      // One bad message is not fatal on its own — a half-written frame happens.
      // It is the rate limit above that stops someone spamming rubbish.
      this.send(connection, { t: 'reject', seq: 0, reason: 'malformed' });
      return;
    }

    const message = decoded.message;

    if (message.t === 'ping') {
      this.send(connection, {
        t: 'pong',
        ts: message.ts,
        serverTick: this.worldOf(connection).tick,
      });
      return;
    }

    if (message.t === 'join') {
      void this.handleJoin(connection, message.ticket, nowMs);
      return;
    }

    const playerId = connection.playerId;
    if (playerId === null) {
      this.send(connection, {
        t: 'reject',
        seq: 'seq' in message ? message.seq : 0,
        reason: 'not-joined',
      });
      return;
    }

    if (message.t === 'say') {
      this.handleSay(connection, playerId, message.seq, message.text, nowMs);
      return;
    }

    const rejection =
      message.t === 'step'
        ? this.worldOf(connection).handleStep(playerId, message.dir, nowMs)
        : message.t === 'walkTo'
          ? this.worldOf(connection).handleWalkTo(playerId, message.to)
          : this.worldOf(connection).handleStop(playerId);

    if (rejection !== null) {
      this.send(connection, { t: 'reject', seq: message.seq, reason: rejection });
    }
    // Whether accepted or refused, the next snapshot carries the truth. The
    // client corrects itself from that, never from the rejection alone.
    this.sendSnapshot(connection);
  }

  private async handleJoin(connection: Connection, ticket: string, nowMs: number): Promise<void> {
    if (connection.playerId !== null) {
      // Joining twice on one socket is not a thing. Ignore it quietly rather
      // than leaving a player behind in the world with nobody driving them.
      return;
    }

    let character: JoiningCharacter | null = null;
    try {
      character = await this.resolveTicket(ticket);
    } catch (error: unknown) {
      console.error('[world] could not check a ticket:', error);
    }

    if (character === null) {
      this.disconnect(connection, 'bad-ticket');
      return;
    }

    // The socket may have gone away while we were asking about the ticket.
    if (!this.connections.has(connection.socket)) return;

    // Reserve outdoor capacity for indoor residents and reject duplicate sessions
    // across every realm, not only the people currently standing outside.
    if (this.byPlayer.has(character.id)) {
      this.disconnect(connection, 'already-online');
      return;
    }
    if (this.byPlayer.size >= this.world.capacity) {
      this.disconnect(connection, 'server-full');
      return;
    }
    const result = this.world.join(character, nowMs);
    if (!result.ok) {
      this.disconnect(connection, result.reason);
      return;
    }

    connection.playerId = result.player.id;
    this.byPlayer.set(result.player.id, connection);
    this.send(connection, {
      t: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      playerId: result.player.id,
      tickMs: TICK_MS,
      spawn: spawnPoint(this.world.map),
      world: {
        width: this.world.map.width,
        height: this.world.map.height,
        chunkSize: CHUNK_SIZE_TILES,
      },
    });
    this.sendSnapshot(connection);
  }

  /**
   * Deliver a remark to the people who are allowed to hear it.
   *
   * The world decides who those are. This method only addresses envelopes, so
   * there is no second place where "who can hear this" could be got wrong.
   */
  private handleSay(
    connection: Connection,
    playerId: string,
    seq: number,
    text: string,
    nowMs: number,
  ): void {
    const result = this.worldOf(connection).handleSay(playerId, text, nowMs);
    if (!result.ok) {
      this.send(connection, { t: 'reject', seq, reason: result.reason });
      return;
    }

    const chat = {
      t: 'chat',
      from: result.from.id,
      name: result.from.name,
      text: result.text,
      tick: this.worldOf(connection).tick,
    } as const;

    for (const listenerId of result.listeners) {
      const listener = this.byPlayer.get(listenerId);
      if (listener === undefined) continue;
      // Belt and braces: the world already only lists people in the same
      // realm, because each realm is its own world.
      if (listener.realm !== connection.realm) continue;
      this.send(listener, chat);
    }
  }

  /**
   * Throw somebody out of the city, because a moderator said so.
   *
   * Returns whether anyone was actually here to throw out, so the API can tell
   * a moderator whether the ban took effect now or will on next login.
   */
  kick(characterId: string, reason: 'kicked' | 'banned'): boolean {
    const connection = this.byPlayer.get(characterId);
    if (connection === undefined) return false;
    this.disconnect(connection, reason);
    return true;
  }

  /** Silence a player who is online right now, wherever they are standing. */
  mute(characterId: string, untilMs: number | null): void {
    for (const world of this.realms.all()) world.mute(characterId, untilMs);
  }

  /**
   * Nudge a player to go and look at something.
   *
   * Returns whether they were here to be nudged. The API does not wait for an
   * answer: a player who is offline will see the change when they come back.
   */
  notify(characterId: string, about: 'trade'): boolean {
    const connection = this.byPlayer.get(characterId);
    if (connection === undefined) return false;
    this.send(connection, { t: 'notice', about });
    return true;
  }

  /** Apply a block, or lift one, for a player who is online right now. */
  setBlock(blockerId: string, blockedId: string, blocked: boolean): void {
    for (const world of this.realms.all()) world.block(blockerId, blockedId, blocked);
  }

  /**
   * Take a player indoors.
   *
   * Whether they are allowed in was decided by the API, which owns the house.
   * This only moves them. Returns false when they are not online, which is
   * ordinary: somebody may be sent home while they are logged out.
   */
  enterHouse(characterId: string, houseId: string): boolean {
    const connection = this.byPlayer.get(characterId);
    if (connection === undefined) return false;
    if (connection.realm !== 'city') return false;

    const player = this.world.get(characterId);
    if (player === undefined) return false;
    connection.cityPosition = { x: player.x, y: player.y };

    return this.moveRealm(connection, houseRealm(houseId), HOUSE_ENTRANCE);
  }

  async enterProperty(characterId: string, propertyId: string): Promise<boolean> {
    const connection = this.byPlayer.get(characterId);
    if (connection === undefined || connection.realm !== 'city') return false;
    let allowed = false;
    try {
      allowed = await this.canEnterProperty(characterId, propertyId);
    } catch {
      return false;
    }
    if (!allowed || this.byPlayer.get(characterId) !== connection || connection.realm !== 'city')
      return false;
    const player = this.world.get(characterId);
    if (player === undefined) return false;
    connection.cityPosition = { x: player.x, y: player.y };
    const entered = this.moveRealm(connection, propertyRealm(propertyId), INTERIOR_ENTRANCE);
    if (!entered) connection.cityPosition = null;
    return entered;
  }

  recheckProperty(propertyId: string): void {
    for (const connection of this.connections.values()) {
      if (propertyIdOf(connection.realm) === propertyId) void this.validateProperty(connection);
    }
  }

  private async validateProperty(connection: Connection): Promise<void> {
    const propertyId = propertyIdOf(connection.realm),
      characterId = connection.playerId;
    if (propertyId === null || characterId === null || this.checkingProperties.has(connection))
      return;
    this.checkingProperties.add(connection);
    let allowed = false;
    try {
      allowed = await this.canEnterProperty(characterId, propertyId);
    } catch {
      /* Fail closed. */
    } finally {
      this.checkingProperties.delete(connection);
    }
    if (
      !allowed &&
      this.byPlayer.get(characterId) === connection &&
      propertyIdOf(connection.realm) === propertyId
    )
      this.leaveHouse(characterId);
  }

  /** Send a player back out into the city, where they came in. */
  leaveHouse(characterId: string): boolean {
    const connection = this.byPlayer.get(characterId);
    if (connection === undefined) return false;
    if (connection.realm === 'city') return false;

    const back = connection.cityPosition;
    const left = this.moveRealm(connection, 'city', back);
    if (left) connection.cityPosition = null;
    return left;
  }

  /**
   * Move one player from the world they are in to another one.
   *
   * Everything the client was holding about where it was — the ground, and
   * everybody standing on it — is thrown away on both sides, because none of
   * it is true any more.
   */
  private moveRealm(connection: Connection, to: RealmId, at: TilePos | null): boolean {
    const playerId = connection.playerId;
    if (playerId === null) return false;

    const from = this.worldOf(connection);
    const player = from.get(playerId);
    if (player === undefined) return false;

    const carried = carriedState(player);
    from.leave(playerId);

    const target = this.realms.get(to);
    const landing = at ?? spawnPoint(target.map);
    const arrived = target.join({ ...carried, x: landing.x, y: landing.y }, this.now());

    if (!arrived.ok) {
      // Put them back where they were rather than leaving them nowhere.
      from.join({ ...carried, x: player.x, y: player.y }, this.now());
      this.realms.forgetIfEmpty(to);
      return false;
    }

    const previous = connection.realm;
    connection.realm = to;
    connection.chunks.clear();
    connection.believes.clear();
    connection.lastSentRevision = -1;
    this.realms.forgetIfEmpty(previous);

    const houseId = houseIdOf(to);
    this.send(connection, {
      t: 'realm',
      realm: propertyIdOf(to) !== null ? 'property' : houseId === null ? 'city' : 'house',
      houseId,
      ...(propertyIdOf(to) === null ? {} : { propertyId: propertyIdOf(to) }),
      world: {
        width: target.map.width,
        height: target.map.height,
        chunkSize: CHUNK_SIZE_TILES,
      },
      spawn: { x: arrived.player.x, y: arrived.player.y },
    });
    this.sendSnapshot(connection);
    return true;
  }

  private isFlooding(connection: Connection, nowMs: number): boolean {
    if (nowMs - connection.windowStartedAtMs >= 1000) {
      connection.windowStartedAtMs = nowMs;
      connection.messagesInWindow = 0;
    }
    connection.messagesInWindow += 1;
    return connection.messagesInWindow > MAX_MESSAGES_PER_SECOND;
  }

  private onTick(): void {
    const nowMs = this.now();
    if (nowMs >= this.nextPropertyCheck) {
      this.nextPropertyCheck = nowMs + 5000;
      for (const connection of this.connections.values()) void this.validateProperty(connection);
    }
    // The city, and the inside of every house somebody is standing in.
    for (const world of this.realms.all()) world.advance(nowMs);

    for (const connection of this.connections.values()) {
      if (connection.playerId === null) continue;
      // Refresh a client whenever the world it is in has changed since the
      // last snapshot it was sent. That covers a player moving, but also
      // somebody joining or leaving, which no movement would have caught.
      if (connection.lastSentRevision !== this.worldOf(connection).revision) {
        this.sendSnapshot(connection);
      }
    }
  }

  private onHeartbeat(): void {
    const nowMs = this.now();
    for (const connection of this.connections.values()) {
      if (nowMs - connection.lastMessageAtMs > IDLE_TIMEOUT_MS) {
        this.disconnect(connection, 'idle');
        continue;
      }
      if (!connection.alive) {
        this.disconnect(connection, 'idle');
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }

  /**
   * Tell one client what has changed around them.
   *
   * Everything this client already knows is left out. When nothing at all has
   * changed — which is most ticks, for most players — no message is sent.
   */
  private sendSnapshot(connection: Connection): void {
    if (connection.playerId === null) return;
    const world = this.worldOf(connection);
    const view = world.viewFor(connection.playerId);
    if (view === null) return;

    // The ground goes out before the people standing on it, so the client
    // never has to draw a player over a chunk it has not been given.
    this.syncChunks(connection, view.you);

    const changed: PlayerView[] = [];
    const stillHere = new Set<string>();

    for (const player of view.players) {
      stillHere.add(player.id);
      const signature = signatureOf(player);
      if (connection.believes.get(player.id) === signature) continue;
      connection.believes.set(player.id, signature);
      changed.push(player);
    }

    const gone: string[] = [];
    for (const id of connection.believes.keys()) {
      if (stillHere.has(id)) continue;
      // The observer is in `believes` too, so that their own corrections can
      // be left out when nothing has changed. They have not left the city.
      if (id === view.you.id) continue;
      gone.push(id);
      connection.believes.delete(id);
    }

    // A player is always told about themselves, but only when it has changed:
    // being sure of your own position is what a correction is for.
    const mySignature = signatureOf(view.you);
    const meChanged = connection.believes.get(view.you.id) !== mySignature;
    connection.believes.set(view.you.id, mySignature);

    connection.lastSentRevision = world.revision;
    if (!meChanged && changed.length === 0 && gone.length === 0) return;

    this.send(connection, {
      t: 'snapshot',
      tick: world.tick,
      you: view.you,
      players: changed,
      gone,
    });
  }

  /**
   * Give this client the chunks its player can now see, and take back the ones
   * it has walked away from.
   *
   * Called every time a snapshot goes out. Working it out again costs a
   * handful of comparisons and means there is exactly one place that decides
   * what a client is allowed to know about the map.
   */
  private syncChunks(connection: Connection, centre: { x: number; y: number }): void {
    const map = this.worldOf(connection).map;
    const wanted = chunksInView(map, centre);
    const { toSend, toDrop } = diffChunks(connection.chunks, wanted);

    for (const chunk of toDrop) {
      this.send(connection, { t: 'chunkDrop', cx: chunk.cx, cy: chunk.cy });
      connection.chunks.delete(chunkKey(chunk));
    }

    for (const chunk of toSend) {
      const rows = map.chunkRows(chunk);
      if (rows === null) continue;
      this.send(connection, { t: 'chunk', cx: chunk.cx, cy: chunk.cy, rows: [...rows] });
      connection.chunks.add(chunkKey(chunk));
    }
  }

  private disconnect(connection: Connection, reason: Bye['reason']): void {
    this.send(connection, { t: 'bye', reason });
    connection.socket.close();
    this.onClose(connection);
  }

  private send(connection: Connection, message: ServerMessage): void {
    if (connection.socket.readyState !== connection.socket.OPEN) return;
    connection.socket.send(encode(message));
  }
}

/**
 * Everything about a player that a client can see.
 *
 * Comparing these strings is how "has anything changed for this observer?" is
 * answered without comparing whole objects ten times a second.
 */
function signatureOf(player: PlayerView): string {
  return `${player.x},${player.y},${player.facing},${player.appearance ?? 0}`;
}

/**
 * What follows a player from one world to another.
 *
 * A mute and a block list are about the person, not the place: walking into a
 * house must not be a way to escape either.
 */
function carriedState(player: PlayerState): JoiningCharacter {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    facing: player.facing,
    appearance: player.appearance,
    mutedUntilMs: player.mutedUntilMs,
    blocked: [...player.blocked],
  };
}
