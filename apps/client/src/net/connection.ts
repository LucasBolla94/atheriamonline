/**
 * The client's side of the conversation with the world server.
 *
 * Two things matter here, and both come straight from `docs/SPEC.md`:
 *
 *  1. This file sends **intents** and nothing else. It never decides that the
 *     player moved. It asks, and then it believes the next snapshot.
 *  2. It validates what the server sends before using it. Our own server is
 *     not hostile, but a browser tab left open across a deployment is, in
 *     effect, talking to a stranger.
 *
 * There is no Phaser and no React in this file, so all of it is testable
 * without a browser.
 */
import {
  decodeServerMessage,
  encode,
  type ClientMessage,
  type MapPatch,
  type PlayerView,
  type RejectReason,
  type ServerMessage,
} from '@atheriam/protocol';
import type { Direction, TilePos } from '@atheriam/shared';

/** Just enough of a WebSocket for this file to use, so tests can fake it. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
}

/** How the connection reports back. Every field is optional. */
export interface ConnectionHandlers {
  onStateChange?: (state: ConnectionState) => void;
  onWelcome?: (map: MapPatch, playerId: string) => void;
  onSnapshot?: (you: PlayerView, others: PlayerView[]) => void;
  onReject?: (reason: RejectReason) => void;
  onClosed?: (reason: string) => void;
}

export type ConnectionState = 'idle' | 'connecting' | 'joining' | 'playing' | 'closed';

/**
 * How many intents we will send per second. The server disconnects a client
 * that sends more than 40; we stay well under so that a stuck key or a
 * fast-clicking player never gets someone kicked out of the game.
 */
export const MAX_INTENTS_PER_SECOND = 15;

export class WorldConnection {
  private socket: SocketLike | null = null;
  private readonly handlers: ConnectionHandlers;
  private readonly now: () => number;
  private state: ConnectionState = 'idle';
  private pendingName: string | null = null;
  private seq = 0;
  private windowStartedAtMs = 0;
  private intentsInWindow = 0;

  /** Where the player is, according to the server. Never set locally. */
  you: PlayerView | null = null;
  others: PlayerView[] = [];
  map: MapPatch | null = null;
  playerId: string | null = null;

  constructor(handlers: ConnectionHandlers = {}, now: () => number = () => Date.now()) {
    this.handlers = handlers;
    this.now = now;
  }

  get currentState(): ConnectionState {
    return this.state;
  }

  /**
   * Attach an already-open socket and ask to join under this name.
   *
   * The socket is passed in rather than created here so that the same class
   * works in a test with a fake one.
   */
  attach(socket: SocketLike, name: string): void {
    this.socket = socket;
    this.pendingName = name;
    this.setState('connecting');
  }

  /** Call when the socket opens. Sends the join intent. */
  handleOpen(): void {
    const name = this.pendingName;
    if (name === null) return;
    this.setState('joining');
    this.sendRaw({ t: 'join', name });
  }

  /** Call with every raw message the socket delivers. */
  handleMessage(raw: string): void {
    const decoded = decodeServerMessage(raw);
    if (!decoded.ok) {
      // Something we do not understand. Dropping it is correct: acting on a
      // half-understood message is how a client ends up drawing a lie.
      return;
    }
    this.apply(decoded.message);
  }

  /**
   * Call when the socket closes, for any reason.
   *
   * Only the first call counts. The server says goodbye and *then* closes the
   * socket, so without this guard the real reason ("that name is taken") would
   * immediately be replaced by the generic "connection lost", and the player
   * would be told nothing useful.
   */
  handleClose(reason = 'connection lost'): void {
    if (this.state === 'closed') return;
    this.socket = null;
    this.pendingName = null;
    this.setState('closed');
    this.handlers.onClosed?.(reason);
  }

  /** "I want to take one step this way." */
  step(direction: Direction): void {
    this.sendIntent({ t: 'step', seq: this.nextSeq(), dir: direction });
  }

  /** "I want to be standing there." The server works out the route. */
  walkTo(target: TilePos): void {
    this.sendIntent({ t: 'walkTo', seq: this.nextSeq(), to: target });
  }

  /** "Stop where I am." */
  stop(): void {
    this.sendIntent({ t: 'stop', seq: this.nextSeq() });
  }

  /** Close the connection on purpose. */
  disconnect(): void {
    this.socket?.close();
    this.handleClose('you left');
  }

  private apply(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome': {
        this.playerId = message.playerId;
        this.map = message.map;
        this.setState('playing');
        this.handlers.onWelcome?.(message.map, message.playerId);
        return;
      }
      case 'snapshot': {
        this.you = message.you;
        this.others = message.players;
        this.handlers.onSnapshot?.(message.you, message.players);
        return;
      }
      case 'reject': {
        // Not an error worth showing the player. The next snapshot is the
        // truth, and the character simply snaps to it.
        this.handlers.onReject?.(message.reason);
        return;
      }
      case 'bye': {
        this.handleClose(message.reason);
        return;
      }
      case 'pong': {
        return;
      }
    }
  }

  private sendIntent(message: ClientMessage): void {
    if (this.state !== 'playing') return;
    if (this.isSendingTooFast()) return;
    this.sendRaw(message);
  }

  private sendRaw(message: ClientMessage): void {
    this.socket?.send(encode(message));
  }

  private isSendingTooFast(): boolean {
    const nowMs = this.now();
    if (nowMs - this.windowStartedAtMs >= 1000) {
      this.windowStartedAtMs = nowMs;
      this.intentsInWindow = 0;
    }
    this.intentsInWindow += 1;
    return this.intentsInWindow > MAX_INTENTS_PER_SECOND;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.handlers.onStateChange?.(state);
  }
}

/** Wrap a real browser WebSocket so it drives a `WorldConnection`. */
export function connectToWorld(
  url: string,
  name: string,
  handlers: ConnectionHandlers,
): WorldConnection {
  const connection = new WorldConnection(handlers);
  const socket = new WebSocket(url);
  connection.attach(socket, name);
  socket.addEventListener('open', () => connection.handleOpen());
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    connection.handleMessage(String(event.data));
  });
  socket.addEventListener('close', () => connection.handleClose());
  socket.addEventListener('error', () => connection.handleClose('could not reach the world'));
  return connection;
}
