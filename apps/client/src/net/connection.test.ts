import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, encode, type ServerMessage } from '@atheriam/protocol';
import {
  CHAT_HISTORY,
  MAX_INTENTS_PER_SECOND,
  WorldConnection,
  type SocketLike,
} from './connection.js';

class FakeSocket implements SocketLike {
  readonly sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** The messages this socket was asked to send, already parsed. */
  parsed(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

/** A ticket long enough to satisfy the protocol's length rule. */
const TICKET = 'ticket-for-the-tests-0123456789';

const WELCOME: ServerMessage = {
  t: 'welcome',
  protocolVersion: PROTOCOL_VERSION,
  playerId: 'p1',
  tickMs: 100,
  spawn: { x: 2, y: 2 },
  world: { width: 128, height: 128, chunkSize: 32 },
};

/** A chunk of plain grass, which is all the renderer needs to be handed. */
function chunk(cx: number, cy: number): ServerMessage {
  return { t: 'chunk', cx, cy, rows: Array.from({ length: 32 }, () => '.'.repeat(32)) };
}

function snapshot(x: number, y: number): ServerMessage {
  return {
    t: 'snapshot',
    tick: 1,
    you: { id: 'p1', name: 'Aldric', x, y, facing: 's' },
    players: [],
    gone: [],
  };
}

function chatFrom(name: string, text: string): ServerMessage {
  return { t: 'chat', from: 'p2', name, text, tick: 3 };
}

describe('WorldConnection', () => {
  it.each([PROTOCOL_VERSION - 1, PROTOCOL_VERSION + 1])(
    'refuses server version %s before loading any world state',
    (protocolVersion) => {
      const socket = new FakeSocket();
      const onClosed = vi.fn();
      const onWelcome = vi.fn();
      const connection = new WorldConnection({ onClosed, onWelcome });
      connection.attach(socket, TICKET);
      connection.handleOpen();
      connection.handleMessage(encode({ ...WELCOME, protocolVersion }));
      connection.handleMessage(encode(chunk(0, 0)));
      connection.handleMessage(encode(snapshot(2, 2)));
      connection.handleClose('connection lost');
      expect(connection.currentState).toBe('closed');
      expect(connection.chunks.size).toBe(0);
      expect(connection.you).toBeNull();
      expect(socket.closed).toBe(true);
      expect(onWelcome).not.toHaveBeenCalled();
      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(onClosed).toHaveBeenCalledWith('client-update-required');
    },
  );

  it('recognizes the server refresh hint without accepting a new world', () => {
    const onClosed = vi.fn();
    const connection = new WorldConnection({ onClosed });
    connection.attach(new FakeSocket(), TICKET);
    connection.handleOpen();
    connection.handleMessage(encode({ t: 'bye', reason: 'protocol-error', reload: true }));
    expect(connection.currentState).toBe('closed');
    expect(onClosed).toHaveBeenCalledWith('client-update-required');
  });
  let socket: FakeSocket;
  let connection: WorldConnection;
  let clock: number;

  beforeEach(() => {
    socket = new FakeSocket();
    clock = 0;
    connection = new WorldConnection({}, () => clock);
  });

  function join(): void {
    connection.attach(socket, TICKET);
    connection.handleOpen();
    connection.handleMessage(encode(WELCOME));
  }

  it('sends social intents and replaces an observed pose when the server clears it', () => {
    join();
    connection.social('sit', '68:81');
    expect(socket.parsed().at(-1)).toMatchObject({ t: 'social', action: 'sit', seatId: '68:81' });
    const base = snapshot(2, 2);
    if (base.t !== 'snapshot') throw new Error('Expected snapshot fixture');
    const other = { id: 'p2', name: 'Neighbour', x: 68, y: 82, facing: 's' as const };
    connection.handleMessage(
      encode({
        ...base,
        players: [{ ...other, pose: 'sit', poseSince: 1000, seat: { x: 68, y: 81 } }],
      }),
    );
    expect(connection.others[0]?.seat).toEqual({ x: 68, y: 81 });
    connection.handleMessage(encode({ ...base, players: [other] }));
    expect(connection.others[0]?.pose).toBeUndefined();
    expect(connection.others[0]?.seat).toBeUndefined();
  });

  it('clears the previous environment and remembers the meeting deadline only while inside', () => {
    join();
    connection.handleMessage(encode(chunk(0, 0)));
    connection.handleMessage(encode(snapshot(2, 2)));
    const booking = {
      id: '30000000-0000-4000-8000-000000000001',
      roomId: 'studio' as const,
      endsAt: 2_000_000_000_000,
    };
    const room = { width: 20, height: 16, chunkSize: 32 };
    connection.handleMessage(
      encode({
        t: 'realm',
        realm: 'booking',
        venueId: 'studio',
        houseId: null,
        booking,
        world: room,
        spawn: { x: 10, y: 14 },
      }),
    );
    expect(connection.realm).toBe('booking');
    expect(connection.venueId).toBe('studio');
    expect(connection.booking).toEqual(booking);
    expect(connection.propertyId).toBeNull();
    expect(connection.chunks.size).toBe(0);
    expect(connection.you).toBeNull();
    connection.handleMessage(
      encode({
        t: 'realm',
        realm: 'property',
        houseId: null,
        propertyId: '20000000-0000-4000-8000-000000000001',
        world: room,
        spawn: { x: 10, y: 14 },
      }),
    );
    expect(connection.booking).toBeNull();
    expect(connection.venueId).toBeNull();
    expect(connection.realm).toBe('property');
    expect(connection.realmRevision).toBe(2);
  });

  it('starts idle and sends nothing', () => {
    expect(connection.currentState).toBe('idle');
    expect(socket.sent).toEqual([]);
  });

  it('asks to join as soon as the socket opens', () => {
    connection.attach(socket, TICKET);
    expect(connection.currentState).toBe('connecting');
    connection.handleOpen();
    expect(connection.currentState).toBe('joining');
    expect(socket.parsed()[0]).toEqual({
      t: 'join',
      ticket: TICKET,
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it('starts playing when the server welcomes it, and remembers how big the city is', () => {
    join();
    expect(connection.currentState).toBe('playing');
    expect(connection.playerId).toBe('p1');
    expect(connection.world?.width).toBe(128);
  });

  it('keeps the chunks it is sent, and forgets the ones it is told to drop', () => {
    join();
    const before = connection.chunkRevision;

    connection.handleMessage(encode(chunk(1, 2)));
    expect(connection.chunks.get('1:2')?.rows).toHaveLength(32);
    expect(connection.chunkRevision).toBeGreaterThan(before);

    connection.handleMessage(encode({ t: 'chunkDrop', cx: 1, cy: 2 }));
    expect(connection.chunks.has('1:2')).toBe(false);
  });

  it('ignores a chunk that is not the size the protocol promises', () => {
    join();
    connection.handleMessage(JSON.stringify({ t: 'chunk', cx: 0, cy: 0, rows: ['..'] }));
    expect(connection.chunks.size).toBe(0);
  });

  it('throws the map away when the connection closes', () => {
    join();
    connection.handleMessage(encode(chunk(0, 0)));
    connection.handleClose('you left');
    expect(connection.chunks.size).toBe(0);
  });

  it('refuses to send intents before it is playing', () => {
    connection.attach(socket, TICKET);
    connection.handleOpen();
    socket.sent.length = 0;

    connection.step('n');
    connection.walkTo({ x: 1, y: 1 });
    connection.stop();

    expect(socket.sent).toEqual([]);
  });

  it('sends a step intent and nothing more', () => {
    join();
    socket.sent.length = 0;

    connection.step('e');

    expect(socket.parsed()).toEqual([{ t: 'step', seq: 1, dir: 'e' }]);
  });

  it('numbers its intents so a rejection can be matched to one', () => {
    join();
    socket.sent.length = 0;

    connection.step('e');
    connection.step('e');
    connection.walkTo({ x: 1, y: 1 });

    expect(socket.parsed().map((m) => m['seq'])).toEqual([1, 2, 3]);
  });

  it('never moves the player on its own — only a snapshot does that', () => {
    join();
    connection.handleMessage(encode(snapshot(2, 2)));
    expect(connection.you).toMatchObject({ x: 2, y: 2 });

    connection.step('e');
    // The intent was sent, but the position has not changed: the server has
    // not spoken yet. This is the whole point of a server-authoritative game.
    expect(connection.you).toMatchObject({ x: 2, y: 2 });

    connection.handleMessage(encode(snapshot(3, 2)));
    expect(connection.you).toMatchObject({ x: 3, y: 2 });
  });

  it('snaps back when the server disagrees', () => {
    join();
    connection.handleMessage(encode(snapshot(5, 5)));
    expect(connection.you).toMatchObject({ x: 5, y: 5 });

    // The server refuses the move and repeats where the player really is.
    const onReject = vi.fn();
    const listening = new WorldConnection({ onReject }, () => clock);
    listening.attach(socket, TICKET);
    listening.handleOpen();
    listening.handleMessage(encode(WELCOME));
    listening.handleMessage(encode({ t: 'reject', seq: 1, reason: 'blocked' }));
    expect(onReject).toHaveBeenCalledWith('blocked');
  });

  it('ignores a message it cannot understand instead of acting on it', () => {
    join();
    connection.handleMessage(encode(snapshot(4, 4)));

    connection.handleMessage('not json');
    connection.handleMessage('{"t":"somethingNew","x":1}');
    connection.handleMessage('{"t":"snapshot","tick":-5}');

    expect(connection.you).toMatchObject({ x: 4, y: 4 });
    expect(connection.currentState).toBe('playing');
  });

  it('closes when the server says goodbye, and reports why', () => {
    const onClosed = vi.fn();
    const c = new WorldConnection({ onClosed }, () => clock);
    c.attach(socket, TICKET);
    c.handleOpen();
    c.handleMessage(encode(WELCOME));

    c.handleMessage(encode({ t: 'bye', reason: 'already-online' }));

    expect(c.currentState).toBe('closed');
    expect(onClosed).toHaveBeenCalledWith('already-online');
  });

  it('stops sending before the server would consider it flooding', () => {
    join();
    socket.sent.length = 0;

    for (let i = 0; i < 100; i += 1) {
      connection.step('e');
    }

    expect(socket.sent.length).toBe(MAX_INTENTS_PER_SECOND);
  });

  it('is allowed to send again in the next second', () => {
    join();
    socket.sent.length = 0;

    for (let i = 0; i < 100; i += 1) connection.step('e');
    const afterFirstSecond = socket.sent.length;

    clock += 1000;
    connection.step('e');

    expect(socket.sent.length).toBe(afterFirstSecond + 1);
  });

  it('tells the caller about every state it passes through', () => {
    const onStateChange = vi.fn();
    const c = new WorldConnection({ onStateChange }, () => clock);
    c.attach(socket, TICKET);
    c.handleOpen();
    c.handleMessage(encode(WELCOME));
    c.handleClose();

    expect(onStateChange.mock.calls.map((call) => call[0])).toEqual([
      'connecting',
      'joining',
      'playing',
      'closed',
    ]);
  });

  it('closes the socket when the player leaves on purpose', () => {
    join();
    connection.disconnect();
    expect(socket.closed).toBe(true);
    expect(connection.currentState).toBe('closed');
  });

  it('keeps the first reason it was given for closing', () => {
    // The server says goodbye and then closes the socket. Without care, the
    // socket's own close event overwrites the real reason and the player is
    // told "connection lost" instead of "that name is taken".
    const onClosed = vi.fn();
    const c = new WorldConnection({ onClosed }, () => clock);
    c.attach(socket, TICKET);
    c.handleOpen();
    c.handleMessage(encode(WELCOME));

    c.handleMessage(encode({ t: 'bye', reason: 'already-online' }));
    c.handleClose();

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledWith('already-online');
  });
});

describe('talking', () => {
  let socket: FakeSocket;
  let connection: WorldConnection;

  beforeEach(() => {
    socket = new FakeSocket();
    connection = new WorldConnection({});
    connection.attach(socket, TICKET);
    connection.handleOpen();
    connection.handleMessage(encode(WELCOME));
    socket.sent.length = 0;
  });

  it('sends what the player typed as an intent', () => {
    connection.say('Good evening');
    expect(socket.parsed()).toEqual([{ t: 'say', seq: 1, text: 'Good evening' }]);
  });

  it('does not send an empty remark, which would only be refused', () => {
    connection.say('   ');
    expect(socket.sent).toEqual([]);
  });

  it('trims what was typed before sending it', () => {
    connection.say('  hello  ');
    expect(socket.parsed()[0]).toMatchObject({ text: 'hello' });
  });

  it('keeps what other people say, newest last', () => {
    connection.handleMessage(encode(chatFrom('Bryn', 'first')));
    connection.handleMessage(encode(chatFrom('Bryn', 'second')));

    expect(connection.chatLog.map((entry) => entry.text)).toEqual(['first', 'second']);
    expect(connection.chatRevision).toBe(2);
  });

  it('forgets the oldest remarks rather than growing without end', () => {
    for (let i = 0; i < CHAT_HISTORY + 20; i += 1) {
      connection.handleMessage(encode(chatFrom('Bryn', `line ${i}`)));
    }
    expect(connection.chatLog).toHaveLength(CHAT_HISTORY);
    expect(connection.chatLog[0]?.text).toBe('line 20');
  });

  it('ignores a remark that is longer than the protocol allows', () => {
    connection.handleMessage(
      JSON.stringify({ t: 'chat', from: 'p2', name: 'Bryn', text: 'x'.repeat(5000), tick: 1 }),
    );
    expect(connection.chatLog).toHaveLength(0);
  });

  it('tells the interface why a remark was refused', () => {
    const reasons: string[] = [];
    const listening = new WorldConnection({ onReject: (reason) => reasons.push(reason) });
    listening.attach(new FakeSocket(), TICKET);
    listening.handleOpen();
    listening.handleMessage(encode(WELCOME));

    listening.handleMessage(encode({ t: 'reject', seq: 1, reason: 'muted' }));
    listening.handleMessage(encode({ t: 'reject', seq: 2, reason: 'too-chatty' }));

    expect(reasons).toEqual(['muted', 'too-chatty']);
  });
});
