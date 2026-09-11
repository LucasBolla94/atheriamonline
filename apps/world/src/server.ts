/**
 * The WebSocket server: the only door into the world.
 *
 * Its whole job is to take bytes off a socket, refuse anything that is not a
 * valid intent, hand what is left to `World`, and send back what each player is
 * allowed to know. All the game rules live in `world.ts`; none live here.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_MS } from '@atheriam/shared';
import {
  PROTOCOL_VERSION,
  decodeClientMessage,
  encode,
  type Bye,
  type ServerMessage,
} from '@atheriam/protocol';
import { spawnPoint } from './map.js';
import type { JoiningCharacter, World } from './world.js';

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
}

export class WorldServer {
  private readonly wss: WebSocketServer;
  private readonly world: World;
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly now: () => number;
  private readonly resolveTicket: WorldServerOptions['resolveTicket'];
  private readonly savePosition: WorldServerOptions['savePosition'];
  private tickTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: WorldServerOptions) {
    this.world = options.world;
    this.now = options.now ?? (() => Date.now());
    this.resolveTicket = options.resolveTicket;
    this.savePosition = options.savePosition;
    this.wss = new WebSocketServer({ host: options.host, port: options.port });
    this.wss.on('connection', (socket) => this.onConnection(socket));
  }

  /** The port actually in use. Useful when the port was chosen as 0. */
  get port(): number {
    const address = this.wss.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  /** Start the simulation loop. */
  start(): void {
    this.tickTimer = setInterval(() => this.onTick(), TICK_MS);
    this.heartbeatTimer = setInterval(() => this.onHeartbeat(), HEARTBEAT_INTERVAL_MS);
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
      alive: true,
    };
    this.connections.set(socket, connection);

    socket.on('message', (data) => this.onMessage(connection, String(data)));
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('close', () => this.onClose(connection));
    socket.on('error', () => this.onClose(connection));
  }

  private onClose(connection: Connection): void {
    const playerId = connection.playerId;
    if (playerId !== null) {
      const player = this.world.get(playerId);
      connection.playerId = null;
      this.world.leave(playerId);

      if (player !== undefined) {
        // Where they stood is written down now, once, as they leave. A failure
        // here must not take the server down with it: the worst case is that
        // one player starts tomorrow a few tiles from where they stopped.
        void this.savePosition({
          id: player.id,
          x: player.x,
          y: player.y,
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
      this.send(connection, { t: 'pong', ts: message.ts, serverTick: this.world.tick });
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

    const rejection =
      message.t === 'step'
        ? this.world.handleStep(playerId, message.dir, nowMs)
        : message.t === 'walkTo'
          ? this.world.handleWalkTo(playerId, message.to)
          : this.world.handleStop(playerId);

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

    const result = this.world.join(character, nowMs);
    if (!result.ok) {
      this.disconnect(connection, result.reason);
      return;
    }

    connection.playerId = result.player.id;
    this.send(connection, {
      t: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      playerId: result.player.id,
      tickMs: TICK_MS,
      spawn: spawnPoint(this.world.map),
      map: this.world.map.toPatch(),
    });
    this.sendSnapshot(connection);
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
    this.world.advance(nowMs);

    for (const connection of this.connections.values()) {
      if (connection.playerId === null) continue;
      // Refresh a client whenever the world has changed since the last
      // snapshot it was sent. That covers a player moving, but also somebody
      // joining or leaving, which no amount of movement would have caught.
      if (connection.lastSentRevision !== this.world.revision) {
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

  private sendSnapshot(connection: Connection): void {
    if (connection.playerId === null) return;
    const view = this.world.viewFor(connection.playerId);
    if (view === null) return;
    this.send(connection, {
      t: 'snapshot',
      tick: this.world.tick,
      you: view.you,
      players: view.players,
    });
    connection.lastSentRevision = this.world.revision;
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
