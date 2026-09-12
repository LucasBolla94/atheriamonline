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

/**
 * Going indoors.
 *
 * A house is its own world: its own map, its own crowd, its own chat. These
 * check that moving between them takes nothing along that should not come,
 * and leaves nothing behind that should.
 */
describe('houses', () => {
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

  it('takes a player indoors and tells them where they are', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 10, 10);

    expect(server.enterHouse('c-aldric', 'house-1')).toBe(true);

    const realm = await client.waitFor('realm');
    expect(realm.realm).toBe('house');
    expect(realm.houseId).toBe('house-1');
    // A house is a small room, not the city.
    expect(realm.world.width).toBeLessThan(field.width);

    // And they are no longer standing in the city.
    expect(world.playerCount).toBe(0);
    expect(server.occupiedHouses).toBe(1);
  });

  it('puts them back where they were standing when they come out', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 12, 14);

    server.enterHouse('c-aldric', 'house-1');
    await client.waitFor('realm');
    client.clear();

    expect(server.leaveHouse('c-aldric')).toBe(true);
    const back = await client.waitFor('realm');

    expect(back.realm).toBe('city');
    expect(back.spawn).toEqual({ x: 12, y: 14 });
    expect(world.playerCount).toBe(1);
  });

  it('forgets a house once the last person leaves it', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 10, 10);
    server.enterHouse('c-aldric', 'house-1');
    await client.waitFor('realm');
    expect(server.occupiedHouses).toBe(1);

    server.leaveHouse('c-aldric');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.occupiedHouses).toBe(0);
  });

  it('hides the people in a house from the people in the street', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    const bryn = await joinAt('c-bryn', 'Bryn', 11, 10);
    await new Promise((resolve) => setTimeout(resolve, 350));

    server.enterHouse('c-aldric', 'house-1');
    await aldric.waitFor('realm');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const gone = bryn.received
      .filter(
        (message): message is Extract<ServerMessage, { t: 'snapshot' }> => message.t === 'snapshot',
      )
      .flatMap((snapshot) => snapshot.gone);
    expect(gone).toContain('c-aldric');
  });

  it('does not carry a remark from indoors out into the street', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    const bryn = await joinAt('c-bryn', 'Bryn', 11, 10);

    server.enterHouse('c-aldric', 'house-1');
    await aldric.waitFor('realm');
    bryn.clear();

    aldric.send({ t: 'say', seq: 1, text: 'anybody home?' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(bryn.latest('chat')).toBeUndefined();
  });

  it('lets two people in the same house hear each other', async () => {
    const aldric = await joinAt('c-aldric', 'Aldric', 10, 10);
    const bryn = await joinAt('c-bryn', 'Bryn', 30, 30);

    server.enterHouse('c-aldric', 'house-1');
    server.enterHouse('c-bryn', 'house-1');
    await aldric.waitFor('realm');
    await bryn.waitFor('realm');

    aldric.send({ t: 'say', seq: 1, text: 'come in' });
    const heard = await bryn.waitFor('chat');
    expect(heard.text).toBe('come in');
  });

  it('does not let a mute be escaped by going indoors', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 10, 10);
    server.mute('c-aldric', Date.now() + 60_000);

    server.enterHouse('c-aldric', 'house-1');
    await client.waitFor('realm');
    client.clear();

    client.send({ t: 'say', seq: 2, text: 'let me out' });
    const reject = await client.waitFor('reject');
    expect(reject.reason).toBe('muted');
  });

  it('refuses to take somebody indoors twice', async () => {
    const client = await joinAt('c-aldric', 'Aldric', 10, 10);
    expect(server.enterHouse('c-aldric', 'house-1')).toBe(true);
    await client.waitFor('realm');
    expect(server.enterHouse('c-aldric', 'house-2')).toBe(false);
  });

  it('says so when there is nobody to take indoors', () => {
    expect(server.enterHouse('c-nobody', 'house-1')).toBe(false);
    expect(server.leaveHouse('c-nobody')).toBe(false);
  });
});

/**
 * Leaving from indoors.
 *
 * A tile inside a house means nothing in the city, so somebody who closes the
 * tab in their kitchen must not come back standing in whatever the city has at
 * those coordinates.
 */
describe('logging out from inside a house', () => {
  const field = new GameMap(Array.from({ length: 60 }, () => '.'.repeat(60)));
  let server: WorldServer;
  let tickets: FakeTickets;
  let port: number;

  beforeEach(async () => {
    tickets = new FakeTickets();
    server = new WorldServer({
      host: '127.0.0.1',
      port: 0,
      world: new World(field),
      resolveTicket: tickets.spend,
      savePosition: tickets.save,
    });
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    port = server.port;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('writes down the doorstep, not the spot on the floorboards', async () => {
    const client = await TestClient.connect(port);
    client.send({ t: 'join', ticket: tickets.issue(character('c-aldric', 'Aldric', 30, 40)) });
    await client.waitFor('snapshot');

    server.enterHouse('c-aldric', 'house-1');
    await client.waitFor('realm');

    client.close();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(tickets.saved).toHaveLength(1);
    expect(tickets.saved[0]).toMatchObject({ id: 'c-aldric', x: 30, y: 40 });
  });
});

describe('commercial interiors over real sockets', () => {
  const propertyId = '10000000-0000-4000-8000-000000000001';
  const otherPropertyId = '10000000-0000-4000-8000-000000000002';
  let server: WorldServer;
  let world: World;
  let tickets: FakeTickets;
  let nowMs: number;
  let allow: (id: string, property: string) => Promise<boolean>;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    tickets = new FakeTickets();
    nowMs = Date.now();
    world = new World(openField, { maxPlayers: 3 });
    allow = async () => true;
    server = new WorldServer({
      now: () => nowMs,
      host: '127.0.0.1',
      port: 0,
      world,
      resolveTicket: tickets.spend,
      savePosition: tickets.save,
      canEnterProperty: (id, property) => allow(id, property),
    });
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  afterEach(async () => {
    clients.forEach((client) => client.close());
    clients.length = 0;
    await server.stop();
  });
  async function connect(id: string): Promise<TestClient> {
    const client = await TestClient.connect(server.port);
    clients.push(client);
    client.send({ t: 'join', ticket: tickets.issue(character(id, id, 12, 14)) });
    return client;
  }
  async function join(id: string): Promise<TestClient> {
    const client = await connect(id);
    await client.waitFor('snapshot');
    return client;
  }

  it('streams the correct interior and returns to the saved outdoor position', async () => {
    const client = await join('owner');
    expect(await server.enterProperty('owner', propertyId)).toBe(true);
    expect(await client.waitFor('realm')).toMatchObject({
      realm: 'property',
      propertyId,
      houseId: null,
      world: { width: 20, height: 16 },
    });
    expect(world.playerCount).toBe(0);
    client.clear();
    expect(server.leaveHouse('owner')).toBe(true);
    expect(await client.waitFor('realm')).toMatchObject({ realm: 'city', spawn: { x: 12, y: 14 } });
  });
  it('refuses private access and database failures without moving the player', async () => {
    const client = await join('visitor');
    allow = async () => false;
    expect(await server.enterProperty('visitor', propertyId)).toBe(false);
    allow = async () => {
      throw new Error('database unavailable');
    };
    expect(await server.enterProperty('visitor', propertyId)).toBe(false);
    expect(world.playerCount).toBe(1);
    expect(client.latest('realm')).toBeUndefined();
  });
  it('removes a guest after permission is revoked', async () => {
    const client = await join('guest');
    await server.enterProperty('guest', propertyId);
    await client.waitFor('realm');
    client.clear();
    allow = async () => false;
    server.recheckProperty(propertyId);
    expect(await client.waitFor('realm')).toMatchObject({ realm: 'city', spawn: { x: 12, y: 14 } });
    expect(world.playerCount).toBe(1);
  });
  it('rechecks permissions periodically even if a live nudge is lost', async () => {
    const client = await join('guest');
    await server.enterProperty('guest', propertyId);
    await client.waitFor('realm');
    client.clear();
    allow = async () => false;
    nowMs += 6000;
    expect(await client.waitFor('realm')).toMatchObject({ realm: 'city' });
  });

  it('keeps conversations inside their own business', async () => {
    const owner = await join('owner');
    const guest = await join('guest');
    const other = await join('other');
    await server.enterProperty('owner', propertyId);
    await server.enterProperty('guest', propertyId);
    await server.enterProperty('other', otherPropertyId);
    await Promise.all([owner.waitFor('realm'), guest.waitFor('realm'), other.waitFor('realm')]);
    other.clear();
    owner.send({ t: 'say', seq: 1, text: 'Private business conversation' });
    expect((await guest.waitFor('chat')).text).toBe('Private business conversation');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(other.latest('chat')).toBeUndefined();
  });
  it('rejects a second login while the same player is indoors', async () => {
    await join('owner');
    await server.enterProperty('owner', propertyId);
    const duplicate = await connect('owner');
    expect((await duplicate.waitFor('bye')).reason).toBe('already-online');
    expect(server.leaveHouse('owner')).toBe(true);
    expect(world.playerCount).toBe(1);
  });
  it('reserves city capacity so an indoor guest can always leave', async () => {
    await join('owner');
    await server.enterProperty('owner', propertyId);
    await join('two');
    await join('three');
    const extra = await connect('four');
    expect((await extra.waitFor('bye')).reason).toBe('server-full');
    expect(server.leaveHouse('owner')).toBe(true);
    expect(world.playerCount).toBe(3);
  });
  it('does not move a disconnected player after a slow permission response', async () => {
    const client = await join('visitor');
    let resolve!: (allowed: boolean) => void;
    allow = () =>
      new Promise<boolean>((done) => {
        resolve = done;
      });
    const entering = server.enterProperty('visitor', propertyId);
    client.close();
    await new Promise((done) => setTimeout(done, 100));
    resolve(true);
    expect(await entering).toBe(false);
    expect(world.playerCount).toBe(0);
    expect(server.occupiedHouses).toBe(0);
  });
});

describe('quiet social sessions', () => {
  let server: WorldServer;
  let nowMs: number;
  let tickets: FakeTickets;
  const clients: TestClient[] = [];
  beforeEach(async () => {
    nowMs = Date.now();
    tickets = new FakeTickets();
    server = new WorldServer({
      host: '127.0.0.1',
      port: 0,
      world: new World(openField),
      resolveTicket: tickets.spend,
      savePosition: tickets.save,
      now: () => nowMs,
      heartbeatIntervalMs: 25,
    });
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  afterEach(async () => {
    clients.forEach((client) => client.close());
    clients.length = 0;
    await server.stop();
  });
  it('keeps a healthy joined reader connected beyond a minute without game intents', async () => {
    const client = await TestClient.connect(server.port);
    clients.push(client);
    client.send({ t: 'join', ticket: tickets.issue(character('reader', 'Reader')) });
    await client.waitFor('snapshot');
    for (let step = 0; step < 8; step++) {
      nowMs += 10_000;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    expect(client.latest('bye')).toBeUndefined();
    client.send({ t: 'say', seq: 1, text: 'I was reading' });
    expect((await client.waitFor('chat')).text).toBe('I was reading');
  });
  it('still closes a socket that never presents its join ticket', async () => {
    const client = await TestClient.connect(server.port);
    clients.push(client);
    nowMs += 70_000;
    expect((await client.waitFor('bye')).reason).toBe('idle');
  });
});

describe('private lounge meetings over real sockets', () => {
  const lounge = '20000000-0000-4000-8000-000000000001';
  const elsewhere = '20000000-0000-4000-8000-000000000002';
  const booking = '30000000-0000-4000-8000-000000000001';
  const otherBooking = '30000000-0000-4000-8000-000000000002';
  let server: WorldServer;
  let tickets: FakeTickets;
  let world: World;
  let nowMs: number;
  let endsAt: number;
  let admission: NonNullable<import('./server.js').WorldServerOptions['bookingAdmission']>;
  const clients: TestClient[] = [];

  function permit(id: string) {
    return { bookingId: id, roomId: 'studio', capacity: 8, endsAt, loungePropertyId: lounge };
  }
  beforeEach(async () => {
    tickets = new FakeTickets();
    nowMs = Date.now();
    endsAt = nowMs + 30_000;
    admission = async (_character, id) => permit(id);
    world = new World(openField, { maxPlayers: 50 });
    server = new WorldServer({
      host: '127.0.0.1',
      port: 0,
      world,
      now: () => nowMs,
      resolveTicket: tickets.spend,
      savePosition: tickets.save,
      canEnterProperty: async () => true,
      bookingAdmission: (characterId, id, time) => admission(characterId, id, time),
    });
    server.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  afterEach(async () => {
    clients.forEach((client) => client.close());
    clients.length = 0;
    await server.stop();
  });
  async function join(id: string, property: string | null = lounge): Promise<TestClient> {
    const client = await TestClient.connect(server.port);
    clients.push(client);
    client.send({ t: 'join', ticket: tickets.issue(character(id, id, 12, 14)) });
    await client.waitFor('snapshot');
    if (property) {
      expect(await server.enterProperty(id, property)).toBe(true);
      await client.waitFor('realm');
    }
    client.clear();
    return client;
  }
  async function enter(id: string, reservation = booking): Promise<TestClient> {
    const client = await join(id);
    expect(await server.enterBooking(id, reservation)).toBe(true);
    await client.waitFor('realm');
    client.clear();
    return client;
  }

  it('enters only through the lounge and preserves the outdoor return position', async () => {
    const client = await join('host', null);
    expect(await server.enterBooking('host', booking)).toBe(false);
    await server.enterProperty('host', elsewhere);
    expect(await server.enterBooking('host', booking)).toBe(false);
    server.leaveHouse('host');
    await server.enterProperty('host', lounge);
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.clear();
    expect(await server.enterBooking('host', booking)).toBe(true);
    expect(await client.waitFor('realm')).toMatchObject({
      realm: 'booking',
      booking: { id: booking, roomId: 'studio', endsAt },
      houseId: null,
      world: { width: 20, height: 16 },
    });
    client.clear();
    expect(server.leaveHouse('host')).toBe(true);
    expect(await client.waitFor('realm')).toMatchObject({ realm: 'property', propertyId: lounge });
    client.clear();
    expect(server.leaveHouse('host')).toBe(true);
    expect(await client.waitFor('realm')).toMatchObject({ realm: 'city', spawn: { x: 12, y: 14 } });
  });

  it('refuses missing permission, failed reads, mismatched reservations and expired admission', async () => {
    const client = await join('visitor');
    admission = async () => null;
    expect(await server.enterBooking('visitor', booking)).toBe(false);
    admission = async () => {
      throw new Error('DB down');
    };
    expect(await server.enterBooking('visitor', booking)).toBe(false);
    admission = async () => permit(otherBooking);
    expect(await server.enterBooking('visitor', booking)).toBe(false);
    admission = async () => ({ ...permit(booking), capacity: 100 });
    expect(await server.enterBooking('visitor', booking)).toBe(false);
    admission = async () => ({ ...permit(booking), endsAt: nowMs });
    expect(await server.enterBooking('visitor', booking)).toBe(false);
    expect(client.latest('realm')).toBeUndefined();
  });

  it('enforces eight places including the host when admissions race', async () => {
    await Promise.all(Array.from({ length: 9 }, (_, index) => join(`guest${index}`)));
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, index) => server.enterBooking(`guest${index}`, booking)),
    );
    expect(results.filter(Boolean)).toHaveLength(8);
    const rejected = results.indexOf(false);
    expect(server.leaveHouse(`guest${rejected}`)).toBe(true);
    expect(world.playerCount).toBe(1); // Rejected visitor remained in the lounge.
  });

  it.each([
    { roomId: 'terrace', capacity: 12 },
    { roomId: 'boardroom', capacity: 16 },
  ])('uses the actual $capacity-place capacity for $roomId', async ({ roomId, capacity }) => {
    admission = async (_character, id) => ({ ...permit(id), roomId, capacity });
    await Promise.all(Array.from({ length: capacity + 1 }, (_, index) => join(`guest${index}`)));
    const results = await Promise.all(
      Array.from({ length: capacity + 1 }, (_, index) =>
        server.enterBooking(`guest${index}`, booking),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(capacity);
  });

  it('keeps speech inside a reservation, away from other bookings and the lounge', async () => {
    const host = await enter('host');
    const guest = await enter('guest');
    const other = await enter('other', otherBooking);
    const publicGuest = await join('public');
    host.send({ t: 'say', seq: 1, text: 'Our meeting' });
    expect((await guest.waitFor('chat')).text).toBe('Our meeting');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(other.latest('chat')).toBeUndefined();
    expect(publicGuest.latest('chat')).toBeUndefined();
  });

  it('revokes one guest immediately while the host remains inside', async () => {
    const host = await enter('host');
    const guest = await enter('guest');
    admission = async (id, reservation) => (id === 'guest' ? null : permit(reservation));
    server.recheckBooking(booking);
    expect(await guest.waitFor('realm')).toMatchObject({ realm: 'property', propertyId: lounge });
    expect(host.latest('realm')).toBeUndefined();
  });

  it('rechecks without Redis nudges and fails closed when the database is unavailable', async () => {
    const guest = await enter('guest');
    admission = async () => {
      throw new Error('DB down');
    };
    nowMs += 6000;
    expect(await guest.waitFor('realm')).toMatchObject({ realm: 'property', propertyId: lounge });
  });

  it('expires locally at the exact deadline even while authorization is stalled', async () => {
    const guest = await enter('guest');
    admission = () => new Promise(() => {});
    server.recheckBooking(booking);
    nowMs = endsAt;
    expect(await guest.waitFor('realm', 1000)).toMatchObject({
      realm: 'property',
      propertyId: lounge,
    });
  });

  it('bounds a stalled authorization check before the booking deadline', async () => {
    const guest = await enter('guest');
    admission = () => new Promise(() => {});
    server.recheckBooking(booking);
    expect(await guest.waitFor('realm', 2800)).toMatchObject({
      realm: 'property',
      propertyId: lounge,
    });
  });

  it('returns to the city if all forty lounge places are occupied at expiry', async () => {
    const guest = await enter('guest');
    await Promise.all(Array.from({ length: 40 }, (_, index) => join(`public${index}`)));
    nowMs = endsAt;
    expect(await guest.waitFor('realm')).toMatchObject({ realm: 'city', spawn: { x: 12, y: 14 } });
    expect(world.playerCount).toBe(1);
  });

  it('does not admit a disconnected player after a delayed authorization response', async () => {
    const guest = await join('guest');
    let resolve!: (value: ReturnType<typeof permit>) => void;
    admission = () =>
      new Promise((done) => {
        resolve = done;
      });
    const entering = server.enterBooking('guest', booking);
    guest.close();
    await new Promise((done) => setTimeout(done, 100));
    resolve(permit(booking));
    expect(await entering).toBe(false);
    expect(server.occupiedHouses).toBe(0);
  });

  it('ignores a stale revocation response after leaving and re-entering', async () => {
    const guest = await enter('guest');
    let resolve!: (value: null) => void;
    admission = () =>
      new Promise((done) => {
        resolve = done;
      });
    server.recheckBooking(booking);
    server.leaveHouse('guest');
    await guest.waitFor('realm');
    admission = async (_id, reservation) => permit(reservation);
    expect(await server.enterBooking('guest', booking)).toBe(true);
    await new Promise((done) => setTimeout(done, 30));
    guest.clear();
    resolve(null);
    await new Promise((done) => setTimeout(done, 150));
    expect(guest.latest('realm')).toBeUndefined();
    expect(server.leaveHouse('guest')).toBe(true);
    expect(await guest.waitFor('realm')).toMatchObject({ realm: 'property', propertyId: lounge });
  });
});
