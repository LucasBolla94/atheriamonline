import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  decodeServerMessage,
  encode,
  type ClientMessage,
  type ServerMessage,
} from '@atheriam/protocol';
import { GameMap } from './map.js';
import { World, type JoiningCharacter } from './world.js';
import { WorldServer } from './server.js';

/**
 * A stand-in for the API's ticket store.
 *
 * It behaves the way the real one must: a ticket works exactly once, and an
 * unknown ticket is simply unknown.
 */
class FakeTickets {
  private readonly tickets = new Map<string, JoiningCharacter>();
  /** Positions written down by the server, so a test can check they were. */
  readonly saved: Array<{ id: string; x: number; y: number }> = [];

  issue(character: JoiningCharacter): string {
    const ticket = `ticket-${character.id}-${this.tickets.size}-padding`;
    this.tickets.set(ticket, character);
    return ticket;
  }

  spend = async (ticket: string): Promise<JoiningCharacter | null> => {
    const character = this.tickets.get(ticket) ?? null;
    this.tickets.delete(ticket);
    return Promise.resolve(character);
  };

  save = async (character: { id: string; x: number; y: number }): Promise<void> => {
    this.saved.push({ id: character.id, x: character.x, y: character.y });
    return Promise.resolve();
  };
}

function character(id: string, name: string, x = 10, y = 10): JoiningCharacter {
  return { id, name, x, y, facing: 's' };
}

/** A wide open field, so the tests are about the server and not about walls. */
const openField = new GameMap(Array.from({ length: 21 }, () => '.'.repeat(21)));

/**
 * A tiny test client. It keeps every message the server sent so a test can
 * wait for the one it cares about.
 */
class TestClient {
  private readonly socket: WebSocket;
  readonly received: ServerMessage[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.on('message', (data) => {
      const decoded = decodeServerMessage(String(data));
      if (decoded.ok) this.received.push(decoded.message);
    });
  }

  static async connect(port: number): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return new TestClient(socket);
  }

  send(message: ClientMessage): void {
    this.socket.send(encode(message));
  }

  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  /** Wait until a message of this kind arrives, or fail the test. */
  async waitFor<K extends ServerMessage['t']>(
    kind: K,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { t: K }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.find((m): m is Extract<ServerMessage, { t: K }> => m.t === kind);
      if (found !== undefined) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `Waited ${timeoutMs}ms for a "${kind}" message. Got: ` +
            JSON.stringify(this.received.map((m) => m.t)),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** The most recent message of a kind, for checking state after movement. */
  latest<K extends ServerMessage['t']>(kind: K): Extract<ServerMessage, { t: K }> | undefined {
    const matches = this.received.filter(
      (m): m is Extract<ServerMessage, { t: K }> => m.t === kind,
    );
    return matches[matches.length - 1];
  }

  clear(): void {
    this.received.length = 0;
  }

  close(): void {
    this.socket.close();
  }
}

describe('the world server over a real socket', () => {
  let server: WorldServer;
  let world: World;
  let tickets: FakeTickets;
  let port: number;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    world = new World(openField);
    tickets = new FakeTickets();
    server = new WorldServer({
      host: '127.0.0.1',
      port: 0,
      world,
      resolveTicket: tickets.spend,
      savePosition: tickets.save,
    });
    server.start();
    // The port is only known once the socket is actually bound.
    await new Promise((resolve) => setTimeout(resolve, 50));
    port = server.port;
    expect(port).toBeGreaterThan(0);
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    await server.stop();
  });

  async function connect(): Promise<TestClient> {
    const client = await TestClient.connect(port);
    clients.push(client);
    return client;
  }

  it('welcomes a player and streams them the ground under their feet', async () => {
    const client = await connect();
    client.send({ t: 'join', ticket: tickets.issue(character('c-aldric', 'Aldric')) });

    const welcome = await client.waitFor('welcome');
    expect(welcome.world.width).toBe(openField.width);
    expect(welcome.world.height).toBe(openField.height);
    expect(welcome.tickMs).toBeGreaterThan(0);

    const chunk = await client.waitFor('chunk');
    expect(chunk.rows).toHaveLength(32);

    const snapshot = await client.waitFor('snapshot');
    expect(snapshot.you.name).toBe('Aldric');
  });

  it('refuses to let two players share a name', async () => {
    const first = await connect();
    first.send({ t: 'join', ticket: tickets.issue(character('c-aldric', 'Aldric')) });
    await first.waitFor('welcome');

    const second = await connect();
    second.send({ t: 'join', ticket: tickets.issue(character('c-aldric-2', 'Aldric')) });
    const bye = await second.waitFor('bye');
    expect(bye.reason).toBe('already-online');
  });

  it('turns away a connection with no valid ticket', async () => {
    const client = await connect();
    client.send({ t: 'join', ticket: 'a-ticket-nobody-ever-issued' });
    const bye = await client.waitFor('bye');
    expect(bye.reason).toBe('bad-ticket');
    expect(world.playerCount).toBe(0);
  });

  it('lets a ticket be used only once', async () => {
    const ticket = tickets.issue(character('c-aldric', 'Aldric'));

    const first = await connect();
    first.send({ t: 'join', ticket });
    await first.waitFor('welcome');

    const second = await connect();
    second.send({ t: 'join', ticket });
    const bye = await second.waitFor('bye');
    expect(bye.reason).toBe('bad-ticket');
  });

  it('will not act on an intent from someone who has not joined', async () => {
    const client = await connect();
    client.send({ t: 'step', seq: 1, dir: 'n' });
    const reject = await client.waitFor('reject');
    expect(reject.reason).toBe('not-joined');
    expect(world.playerCount).toBe(0);
  });

  it('moves the player when the step is legal', async () => {
    const client = await connect();
    client.send({ t: 'join', ticket: tickets.issue(character('c-aldric', 'Aldric')) });
    const start = await client.waitFor('snapshot');
    client.clear();

    client.send({ t: 'step', seq: 1, dir: 'e' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const after = client.latest('snapshot');
    expect(after?.you.x).toBe(start.you.x + 1);
    expect(after?.you.facing).toBe('e');
  });

  it('answers rubbish with a rejection instead of crashing', async () => {
    const client = await connect();
    client.send({ t: 'join', ticket: tickets.issue(character('c-aldric', 'Aldric')) });
    await client.waitFor('welcome');
    client.clear();

    client.sendRaw('this is not json at all');
    const reject = await client.waitFor('reject');
    expect(reject.reason).toBe('malformed');
    // The server is still serving.
    expect(world.playerCount).toBe(1);
  });

  it('disconnects a client that floods it', async () => {
    const client = await connect();
    client.send({ t: 'join', ticket: tickets.issue(character('c-aldric', 'Aldric')) });
    await client.waitFor('welcome');
    client.clear();

    for (let i = 0; i < 200; i += 1) {
      client.send({ t: 'ping', ts: i });
    }

    const bye = await client.waitFor('bye');
    expect(bye.reason).toBe('protocol-error');
  });

  it('answers a ping with the server tick', async () => {
    const client = await connect();
    client.send({ t: 'ping', ts: 12345 });
    const pong = await client.waitFor('pong');
    expect(pong.ts).toBe(12345);
    expect(pong.serverTick).toBeGreaterThanOrEqual(0);
  });

  it('lets two players see each other', async () => {
    const one = await connect();
    one.send({ t: 'join', ticket: tickets.issue(character('c-aldric', 'Aldric')) });
    await one.waitFor('welcome');

    const two = await connect();
    two.send({ t: 'join', ticket: tickets.issue(character('c-bryn', 'Bryn', 12, 10)) });
    await two.waitFor('welcome');

    await new Promise((resolve) => setTimeout(resolve, 200));
    const view = one.latest('snapshot');
    expect(view?.players.map((p) => p.name)).toContain('Bryn');
  });

  it('takes a player out of the world when their connection closes', async () => {
    const client = await connect();
    client.send({ t: 'join', ticket: tickets.issue(character('c-aldric', 'Aldric')) });
    await client.waitFor('welcome');
    expect(world.playerCount).toBe(1);

    client.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(world.playerCount).toBe(0);
  });

  it('writes down where a player was standing when they leave', async () => {
    const client = await connect();
    client.send({ t: 'join', ticket: tickets.issue(character('c-aldric', 'Aldric')) });
    await client.waitFor('welcome');

    client.send({ t: 'step', seq: 1, dir: 'e' });
    await new Promise((resolve) => setTimeout(resolve, 150));

    client.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Exactly one write, on the way out — not one per step.
    expect(tickets.saved).toHaveLength(1);
    expect(tickets.saved[0]).toMatchObject({ id: 'c-aldric', x: 11, y: 10 });
  });
});

/**
 * The map arrives in pieces, and each player gets only their own pieces.
 *
 * These run on a city-sized map, because the whole point of streaming is what
 * happens when the world is bigger than one screen.
 */
describe('streaming the map over a real socket', () => {
  const bigCity = new GameMap(Array.from({ length: 128 }, () => '.'.repeat(128)));
  let server: WorldServer;
  let world: World;
  let tickets: FakeTickets;
  let port: number;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    world = new World(bigCity);
    tickets = new FakeTickets();
    server = new WorldServer({
      host: '127.0.0.1',
      port: 0,
      world,
      resolveTicket: tickets.spend,
      savePosition: tickets.save,
    });
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    port = server.port;
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    await server.stop();
  });

  async function joinAt(id: string, name: string, x: number, y: number): Promise<TestClient> {
    const client = await TestClient.connect(port);
    clients.push(client);
    client.send({ t: 'join', ticket: tickets.issue(character(id, name, x, y)) });
    await client.waitFor('snapshot');
    return client;
  }

  function chunksReceived(client: TestClient): string[] {
    return client.received
      .filter((message): message is Extract<ServerMessage, { t: 'chunk' }> => message.t === 'chunk')
      .map((message) => `${message.cx}:${message.cy}`);
  }

  it('sends a player the ground around them and not the whole city', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 16, 16);
    const chunks = chunksReceived(client);

    expect(chunks).toContain('0:0');
    // Sixteen chunks exist; nobody standing in a corner is given all of them.
    expect(chunks.length).toBeLessThan(16);
    expect(chunks).not.toContain('3:3');
  });

  it('gives two players in different quarters different ground', async () => {
    const north = await joinAt('c-aldric', 'Aldric', 16, 16);
    const south = await joinAt('c-bryn', 'Bryn', 112, 112);

    expect(chunksReceived(north)).not.toContain('3:3');
    expect(chunksReceived(south)).toContain('3:3');
    expect(chunksReceived(south)).not.toContain('0:0');
  });

  it('never sends the same chunk to one player twice', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 64, 64);
    // Walk a few tiles, which re-checks what they can see on every snapshot.
    client.send({ t: 'walkTo', seq: 1, to: { x: 70, y: 64 } });
    await new Promise((resolve) => setTimeout(resolve, 800));

    const chunks = chunksReceived(client);
    expect(new Set(chunks).size).toBe(chunks.length);
  });
});

/**
 * Talking, over a real socket.
 *
 * The world decides who hears what; these check that the socket layer then
 * delivers it to exactly those people and to nobody else.
 */
describe('talking over a real socket', () => {
  const field = new GameMap(Array.from({ length: 60 }, () => '.'.repeat(60)));
  let server: WorldServer;
  let world: World;
  let tickets: FakeTickets;
  let port: number;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    world = new World(field);
    tickets = new FakeTickets();
    server = new WorldServer({
      host: '127.0.0.1',
      port: 0,
      world,
      resolveTicket: tickets.spend,
      savePosition: tickets.save,
    });
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    port = server.port;
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    await server.stop();
  });

  async function joinAt(
    id: string,
    name: string,
    x: number,
    y: number,
    extra: Partial<JoiningCharacter> = {},
  ): Promise<TestClient> {
    const client = await TestClient.connect(port);
    clients.push(client);
    client.send({ t: 'join', ticket: tickets.issue({ ...character(id, name, x, y), ...extra }) });
    await client.waitFor('snapshot');
    return client;
  }

  it('sends a remark back to the person who made it', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 10, 10);
    client.send({ t: 'say', seq: 1, text: 'Good evening' });

    const chat = await client.waitFor('chat');
    expect(chat.text).toBe('Good evening');
    expect(chat.name).toBe('Aldric');
  });

  it('delivers it to somebody standing nearby', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    const bryn = await joinAt('c-bryn', 'Bryn', 12, 11);

    aldric.send({ t: 'say', seq: 1, text: 'Good evening' });

    const heard = await bryn.waitFor('chat');
    expect(heard.text).toBe('Good evening');
    expect(heard.from).toBe('c-aldric');
  });

  it('does not deliver it across the city', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    const far = await joinAt('c-bryn', 'Bryn', 50, 50);
    far.clear();

    aldric.send({ t: 'say', seq: 1, text: 'Good evening' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(far.latest('chat')).toBeUndefined();
  });

  it('does not deliver it to somebody who blocked the speaker', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    const bryn = await joinAt('c-bryn', 'Bryn', 11, 10, { blocked: ['c-aldric'] });
    bryn.clear();

    aldric.send({ t: 'say', seq: 1, text: 'Good evening' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(bryn.latest('chat')).toBeUndefined();
  });

  it('refuses a muted player and says why', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 10, 10);
    server.mute('c-aldric', Date.now() + 60_000);

    client.send({ t: 'say', seq: 7, text: 'Good evening' });

    const reject = await client.waitFor('reject');
    expect(reject.reason).toBe('muted');
    expect(reject.seq).toBe(7);
  });

  it('refuses a flood of talk without disconnecting anybody', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 10, 10);

    for (let i = 0; i < 12; i += 1) {
      client.send({ t: 'say', seq: i, text: `message ${i}` });
    }

    const reject = await client.waitFor('reject');
    expect(reject.reason).toBe('too-chatty');
    expect(world.playerCount).toBe(1);
  });

  it('throws a player out when a moderator says so', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 10, 10);

    expect(server.kick('c-aldric', 'banned')).toBe(true);

    const bye = await client.waitFor('bye');
    expect(bye.reason).toBe('banned');
    expect(world.playerCount).toBe(0);
  });

  it('says so when there was nobody to throw out', () => {
    expect(server.kick('c-nobody', 'kicked')).toBe(false);
  });

  it('applies a block that arrives in the middle of a conversation', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    const bryn = await joinAt('c-bryn', 'Bryn', 11, 10);

    aldric.send({ t: 'say', seq: 1, text: 'first' });
    await bryn.waitFor('chat');

    server.setBlock('c-bryn', 'c-aldric', true);
    bryn.clear();

    aldric.send({ t: 'say', seq: 2, text: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(bryn.latest('chat')).toBeUndefined();
  });
});

/**
 * A snapshot is a difference, not a picture.
 *
 * This is what keeps a crowded square affordable. A load test of 150 players
 * standing in one place measured 144 kB a second each, almost all of it
 * repeating that nobody had moved. These tests are what stop that coming back.
 */
describe('snapshots only carry what changed', () => {
  const field = new GameMap(Array.from({ length: 60 }, () => '.'.repeat(60)));
  let server: WorldServer;
  let world: World;
  let tickets: FakeTickets;
  let port: number;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    world = new World(field);
    tickets = new FakeTickets();
    server = new WorldServer({
      host: '127.0.0.1',
      port: 0,
      world,
      resolveTicket: tickets.spend,
      savePosition: tickets.save,
    });
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    port = server.port;
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    await server.stop();
  });

  async function joinAt(id: string, name: string, x: number, y: number): Promise<TestClient> {
    const client = await TestClient.connect(port);
    clients.push(client);
    client.send({ t: 'join', ticket: tickets.issue(character(id, name, x, y)) });
    await client.waitFor('snapshot');
    return client;
  }

  function snapshots(client: TestClient): Array<Extract<ServerMessage, { t: 'snapshot' }>> {
    return client.received.filter(
      (message): message is Extract<ServerMessage, { t: 'snapshot' }> => message.t === 'snapshot',
    );
  }

  /**
   * Wait for the city to stop changing.
   *
   * Somebody else joining reaches the other players on the next tick, not on
   * the one they arrived in. Without this pause a test clears its inbox
   * half-way through being told about the person who just walked in, and then
   * blames the difference for containing them.
   */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  it('tells a new player about everybody already standing there', async () => {
    await joinAt('c-bryn', 'Bryn', 10, 11);
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);

    const first = snapshots(aldric)[0];
    expect(first?.players.map((player) => player.name)).toEqual(['Bryn']);
  });

  it('says nothing at all while a crowd stands still', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    await joinAt('c-bryn', 'Bryn', 11, 10);
    await joinAt('c-cara', 'Cara', 12, 10);

    // Let several ticks go by with nobody moving.
    await settle();
    aldric.clear();
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(snapshots(aldric)).toHaveLength(0);
  });

  it('names only the person who moved', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    await joinAt('c-bryn', 'Bryn', 11, 10);
    const cara = await joinAt('c-cara', 'Cara', 12, 10);
    await settle();
    aldric.clear();

    cara.send({ t: 'step', seq: 1, dir: 'e' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const heard = snapshots(aldric);
    expect(heard.length).toBeGreaterThan(0);
    for (const snapshot of heard) {
      expect(snapshot.players.map((player) => player.name)).toEqual(['Cara']);
    }
  });

  it('says who has gone when somebody leaves the city', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    const bryn = await joinAt('c-bryn', 'Bryn', 11, 10);
    await settle();
    aldric.clear();

    bryn.close();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const gone = snapshots(aldric).flatMap((snapshot) => snapshot.gone);
    expect(gone).toContain('c-bryn');
  });

  it('never puts the player themselves in the list of people who have gone', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);

    aldric.send({ t: 'step', seq: 1, dir: 'e' });
    await new Promise((resolve) => setTimeout(resolve, 500));

    for (const snapshot of snapshots(aldric)) {
      expect(snapshot.gone).not.toContain('c-aldric');
    }
  });

  it('still corrects a player about themselves when they move', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    const start = snapshots(aldric)[0]?.you.x ?? 0;
    await settle();
    aldric.clear();

    aldric.send({ t: 'step', seq: 1, dir: 'e' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const latest = aldric.latest('snapshot');
    expect(latest?.you.x).toBe(start + 1);
  });
});
