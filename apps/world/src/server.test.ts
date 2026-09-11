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
