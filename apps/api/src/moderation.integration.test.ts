/**
 * Blocking, reporting and moderation, against a real database.
 *
 * These are the tests that can only be written here: that a mute and its
 * audit entry are written together, that a block cannot be created twice,
 * that a moderator route is invisible to somebody who is not one.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accounts, connect, moderationLog, type DatabaseHandle } from '@atheriam/db';
import { testDatabaseUrl, testRedisUrl } from '../../../test/integration-setup.js';
import { buildServer } from './server.js';
import { readConfig } from './config.js';
import { SESSION_COOKIE } from './routes.js';
import type { WorldLink } from './worldLink.js';

const handle: DatabaseHandle = connect(testDatabaseUrl(), 4);
const redis = new Redis(testRedisUrl());

const config = readConfig({
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: '3001',
  DATABASE_URL: testDatabaseUrl(),
  REDIS_URL: testRedisUrl(),
  PUBLIC_ORIGIN: 'http://localhost:5173',
  SESSION_SECRET: 'a'.repeat(64),
  GENERAL_RATE_LIMIT_PER_MINUTE: '10000',
  AUTH_RATE_LIMIT_PER_MINUTE: '10000',
});

/** A world link that remembers what it was told, instead of reaching Redis. */
function spyLink(): WorldLink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    kick: async (id, reason) => {
      calls.push(`kick:${id}:${reason}`);
      return Promise.resolve();
    },
    mute: async (id, untilMs) => {
      calls.push(`mute:${id}:${untilMs === null ? 'forever' : 'until'}`);
      return Promise.resolve();
    },
    block: async (blocker, blocked, on) => {
      calls.push(`block:${blocker}:${blocked}:${String(on)}`);
      return Promise.resolve();
    },
  };
}

let app: FastifyInstance;
let world: ReturnType<typeof spyLink>;

async function makePlayer(name: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: `${name.toLowerCase()}@example.com`,
      password: 'correct horse battery staple',
      dateOfBirth: '1990-05-04',
      characterName: name,
      confirmsAdult: true,
    },
  });
  expect(response.statusCode).toBe(201);
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (cookie === undefined) throw new Error('No session cookie came back.');
  return cookie.value;
}

/** Give the account behind this character the moderator badge. */
async function makeModerator(name: string): Promise<void> {
  await handle.db.execute(
    sql`UPDATE accounts SET is_moderator = true WHERE id = (
          SELECT account_id FROM characters WHERE name_normalised = ${name.toLowerCase()}
        )`,
  );
}

function as(cookie: string) {
  return { cookie: `${SESSION_COOKIE}=${cookie}` };
}

beforeEach(async () => {
  await handle.db.execute(
    sql`TRUNCATE TABLE moderation_log, reports, blocks, characters, accounts RESTART IDENTITY CASCADE`,
  );
  await redis.flushdb();
  await app?.close();
  world = spyLink();
  app = await buildServer({ config, db: handle.db, redis, world });
});

afterAll(async () => {
  await app?.close();
  redis.disconnect();
  await handle.close();
});

describe('blocking', () => {
  it('records the block and tells the world server at once', async () => {
    const aldric = await makePlayer('Aldric');
    await makePlayer('Bryn');

    const response = await app.inject({
      method: 'POST',
      url: '/api/players/block',
      headers: as(aldric),
      payload: { name: 'Bryn' },
    });

    expect(response.statusCode).toBe(200);
    expect(world.calls.some((call) => call.startsWith('block:'))).toBe(true);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/players/blocked',
      headers: as(aldric),
    });
    expect(listed.json()).toEqual({ names: ['Bryn'] });
  });

  it('is the same whether it is asked for once or twice', async () => {
    const aldric = await makePlayer('Aldric');
    await makePlayer('Bryn');

    for (let i = 0; i < 2; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/players/block',
        headers: as(aldric),
        payload: { name: 'Bryn' },
      });
      expect(response.statusCode).toBe(200);
    }

    const listed = await app.inject({
      method: 'GET',
      url: '/api/players/blocked',
      headers: as(aldric),
    });
    expect(listed.json()).toEqual({ names: ['Bryn'] });
  });

  it('can be undone', async () => {
    const aldric = await makePlayer('Aldric');
    await makePlayer('Bryn');

    await app.inject({
      method: 'POST',
      url: '/api/players/block',
      headers: as(aldric),
      payload: { name: 'Bryn' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/players/unblock',
      headers: as(aldric),
      payload: { name: 'Bryn' },
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/players/blocked',
      headers: as(aldric),
    });
    expect(listed.json()).toEqual({ names: [] });
  });

  it('refuses to let somebody block themselves', async () => {
    const aldric = await makePlayer('Aldric');
    const response = await app.inject({
      method: 'POST',
      url: '/api/players/block',
      headers: as(aldric),
      payload: { name: 'Aldric' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('not-yourself');
  });

  it('needs somebody to be logged in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/players/block',
      payload: { name: 'Bryn' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('reporting', () => {
  it('puts a report in the queue a moderator reads', async () => {
    const aldric = await makePlayer('Aldric');
    await makePlayer('Bryn');

    const sent = await app.inject({
      method: 'POST',
      url: '/api/players/report',
      headers: as(aldric),
      payload: { name: 'Bryn', reason: 'Would not stop shouting at me.' },
    });
    expect(sent.statusCode).toBe(201);

    await makeModerator('Aldric');
    const queue = await app.inject({
      method: 'GET',
      url: '/api/moderation/reports',
      headers: as(aldric),
    });

    const reports = queue.json().reports as Array<{ reported: string; reporter: string }>;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ reported: 'Bryn', reporter: 'Aldric' });
  });

  it('will not report somebody who does not exist', async () => {
    const aldric = await makePlayer('Aldric');
    const response = await app.inject({
      method: 'POST',
      url: '/api/players/report',
      headers: as(aldric),
      payload: { name: 'Nobody', reason: 'Made up entirely.' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('no-such-character');
  });
});

describe('moderators', () => {
  it('are invisible to somebody who is not one', async () => {
    const aldric = await makePlayer('Aldric');
    const response = await app.inject({
      method: 'GET',
      url: '/api/moderation/reports',
      headers: as(aldric),
    });
    // Not 403: telling somebody they are not allowed in also tells them there
    // is a door worth attacking.
    expect(response.statusCode).toBe(404);
  });

  it('mute a player, write it down, and silence them in the city now', async () => {
    const aldric = await makePlayer('Aldric');
    await makePlayer('Bryn');
    await makeModerator('Aldric');

    const response = await app.inject({
      method: 'POST',
      url: '/api/moderation/mute',
      headers: as(aldric),
      payload: { name: 'Bryn', reason: 'Shouting at people.', minutes: 60 },
    });
    expect(response.statusCode).toBe(200);

    const muted = await handle.db
      .select({ mutedUntil: accounts.mutedUntil })
      .from(accounts)
      .where(eq(accounts.emailNormalised, 'bryn@example.com'));
    expect(muted[0]?.mutedUntil).toBeInstanceOf(Date);

    const log = await handle.db.select().from(moderationLog);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'mute', reason: 'Shouting at people.' });

    expect(world.calls.some((call) => call.startsWith('mute:'))).toBe(true);
  });

  it('lift a mute again', async () => {
    const aldric = await makePlayer('Aldric');
    await makePlayer('Bryn');
    await makeModerator('Aldric');

    await app.inject({
      method: 'POST',
      url: '/api/moderation/mute',
      headers: as(aldric),
      payload: { name: 'Bryn', reason: 'Shouting at people.', minutes: 60 },
    });
    await app.inject({
      method: 'POST',
      url: '/api/moderation/unmute',
      headers: as(aldric),
      payload: { name: 'Bryn', reason: 'Said sorry.' },
    });

    const muted = await handle.db
      .select({ mutedUntil: accounts.mutedUntil })
      .from(accounts)
      .where(eq(accounts.emailNormalised, 'bryn@example.com'));
    expect(muted[0]?.mutedUntil).toBeNull();

    const log = await handle.db.select().from(moderationLog);
    expect(log.map((entry) => entry.action).sort()).toEqual(['mute', 'unmute']);
  });

  it('ban an account, which also throws them out of the city', async () => {
    const aldric = await makePlayer('Aldric');
    await makePlayer('Bryn');
    await makeModerator('Aldric');

    const response = await app.inject({
      method: 'POST',
      url: '/api/moderation/ban',
      headers: as(aldric),
      payload: { name: 'Bryn', reason: 'Threatened another player.' },
    });
    expect(response.statusCode).toBe(200);

    const banned = await handle.db
      .select({ status: accounts.status })
      .from(accounts)
      .where(eq(accounts.emailNormalised, 'bryn@example.com'));
    expect(banned[0]?.status).toBe('banned');
    expect(world.calls).toContain(`kick:${(await characterIdOf('Bryn')) ?? ''}:banned`);
  });

  it('cannot ban somebody who does not exist', async () => {
    const aldric = await makePlayer('Aldric');
    await makeModerator('Aldric');

    const response = await app.inject({
      method: 'POST',
      url: '/api/moderation/ban',
      headers: as(aldric),
      payload: { name: 'Nobody', reason: 'Made up entirely.' },
    });
    expect(response.statusCode).toBe(404);
    expect(await handle.db.select().from(moderationLog)).toHaveLength(0);
  });

  it('close the report they acted on, and leave the trail behind', async () => {
    const aldric = await makePlayer('Aldric');
    const bryn = await makePlayer('Bryn');
    await makeModerator('Aldric');

    await app.inject({
      method: 'POST',
      url: '/api/players/report',
      headers: as(bryn),
      payload: { name: 'Aldric', reason: 'Followed me around the square.' },
    });

    const queue = await app.inject({
      method: 'GET',
      url: '/api/moderation/reports',
      headers: as(aldric),
    });
    const reportId = (queue.json().reports as Array<{ id: string }>)[0]?.id;
    expect(reportId).toBeDefined();

    await app.inject({
      method: 'POST',
      url: '/api/moderation/dismiss',
      headers: as(aldric),
      payload: { reportId, reason: 'Nothing in it.' },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/moderation/reports',
      headers: as(aldric),
    });
    expect(after.json().reports).toHaveLength(0);

    const log = await handle.db.select().from(moderationLog);
    expect(log[0]).toMatchObject({ action: 'dismiss-report', reason: 'Nothing in it.' });
  });

  it('refuse an action with no reason given', async () => {
    const aldric = await makePlayer('Aldric');
    await makePlayer('Bryn');
    await makeModerator('Aldric');

    const response = await app.inject({
      method: 'POST',
      url: '/api/moderation/mute',
      headers: as(aldric),
      payload: { name: 'Bryn', reason: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(await handle.db.select().from(moderationLog)).toHaveLength(0);
  });
});

async function characterIdOf(name: string): Promise<string | null> {
  const rows = await handle.db.execute<{ id: string }>(
    sql`SELECT id FROM characters WHERE name_normalised = ${name.toLowerCase()}`,
  );
  return rows[0]?.id ?? null;
}
