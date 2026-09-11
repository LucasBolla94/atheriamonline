import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { connect, type DatabaseHandle } from '@atheriam/db';
import { testDatabaseUrl, testRedisUrl } from '../../../test/integration-setup.js';
import { buildServer } from './server.js';
import { readConfig } from './config.js';
import { SESSION_COOKIE } from './routes.js';
import { SessionStore, TICKET_TTL_SECONDS } from './auth/sessions.js';

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
  // High enough that the ordinary tests never trip it; the limit itself is
  // tested below with a server built specially for it.
  GENERAL_RATE_LIMIT_PER_MINUTE: '10000',
  AUTH_RATE_LIMIT_PER_MINUTE: '10000',
});

let app: FastifyInstance;

const GOOD = {
  email: 'aldric@example.com',
  password: 'correct horse battery staple',
  dateOfBirth: '1990-05-04',
  characterName: 'Aldric',
  confirmsAdult: true as const,
};

/** Pull the session cookie out of a response, the way a browser would. */
function sessionCookie(response: {
  cookies: Array<{ name: string; value: string }>;
}): string | null {
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  return cookie?.value ?? null;
}

beforeEach(async () => {
  await handle.db.execute(sql`TRUNCATE TABLE characters, accounts RESTART IDENTITY CASCADE`);
  await redis.flushdb();
  await app?.close();
  app = await buildServer({ config, db: handle.db, redis });
});

afterAll(async () => {
  await app?.close();
  redis.disconnect();
  await handle.close();
});

describe('GET /api/health', () => {
  it('answers while the server is up', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: 'api' });
  });
});

describe('POST /api/auth/register', () => {
  it('creates the account and logs the person straight in', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: GOOD });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ character: { name: 'Aldric' } });
    expect(sessionCookie(response)).not.toBeNull();
  });

  it('sets a cookie the page cannot read', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: GOOD });
    const raw = response.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw.join(';') : String(raw);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
  });

  it('refuses somebody under 18', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...GOOD, dateOfBirth: '2015-01-01' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()['error']).toBe('under-age');
  });

  it('refuses a registration that does not confirm adulthood', async () => {
    const { confirmsAdult: _ignored, ...withoutTheBox } = GOOD;
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: withoutTheBox,
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a short password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...GOOD, password: 'short' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a name with markup in it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...GOOD, characterName: '<b>Aldric</b>' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reports a taken email as a conflict', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: GOOD });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { ...GOOD, characterName: 'Bryn' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()['error']).toBe('email-taken');
  });

  it('never sends the password back', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: GOOD });
    expect(response.body).not.toContain('correct horse');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: GOOD });
  });

  it('logs a known person in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD.email, password: GOOD.password },
    });
    expect(response.statusCode).toBe(200);
    expect(sessionCookie(response)).not.toBeNull();
  });

  it('refuses the wrong password without saying which half was wrong', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD.email, password: 'not the password' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: GOOD.password },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });
});

describe('GET /api/me', () => {
  it('refuses somebody with no session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a made-up session token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: 'this-is-not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('describes the character of somebody logged in', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: GOOD,
    });
    const token = sessionCookie(registered);
    expect(token).not.toBeNull();

    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: token ?? '' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()['character']).toMatchObject({ name: 'Aldric' });
  });
});

describe('POST /api/auth/logout', () => {
  it('makes the session stop working', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: GOOD,
    });
    const token = sessionCookie(registered) ?? '';

    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: token },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(after.statusCode).toBe(401);
  });

  it('does not fall over when nobody was logged in', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(response.statusCode).toBe(200);
  });
});

describe('POST /api/world/ticket', () => {
  it('refuses somebody who is not logged in', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/world/ticket' });
    expect(response.statusCode).toBe(401);
  });

  it('gives a logged-in player a ticket', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: GOOD,
    });
    const token = sessionCookie(registered) ?? '';

    const response = await app.inject({
      method: 'POST',
      url: '/api/world/ticket',
      cookies: { [SESSION_COOKIE]: token },
    });

    expect(response.statusCode).toBe(200);
    const ticket = response.json()['ticket'] as string;
    expect(typeof ticket).toBe('string');
    expect(ticket.length).toBeGreaterThan(20);
  });

  it('issues a ticket that expires on its own', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: GOOD,
    });
    const token = sessionCookie(registered) ?? '';
    const response = await app.inject({
      method: 'POST',
      url: '/api/world/ticket',
      cookies: { [SESSION_COOKIE]: token },
    });
    const ticket = response.json()['ticket'] as string;

    const secondsLeft = await redis.ttl(`ticket:${ticket}`);
    expect(secondsLeft).toBeGreaterThan(0);
    expect(secondsLeft).toBeLessThanOrEqual(TICKET_TTL_SECONDS);
  });
});

describe('the session store', () => {
  it('spends a ticket exactly once', async () => {
    const sessions = new SessionStore(redis);
    const ticket = await sessions.issueTicket({
      accountId: 'a',
      characterId: 'c',
      characterName: 'Aldric',
    });

    const first = await sessions.spendTicket(ticket);
    const second = await sessions.spendTicket(ticket);

    expect(first).toMatchObject({ characterName: 'Aldric' });
    expect(second).toBeNull();
  });

  it('lets only one of two connections race for the same ticket', async () => {
    const sessions = new SessionStore(redis);
    const ticket = await sessions.issueTicket({
      accountId: 'a',
      characterId: 'c',
      characterName: 'Aldric',
    });

    const [a, b] = await Promise.all([sessions.spendTicket(ticket), sessions.spendTicket(ticket)]);
    const winners = [a, b].filter((result) => result !== null);
    expect(winners).toHaveLength(1);
  });

  it('has nothing to say about a token it never issued', async () => {
    const sessions = new SessionStore(redis);
    expect(await sessions.read('made-up')).toBeNull();
    expect(await sessions.spendTicket('made-up')).toBeNull();
    expect(await sessions.read('')).toBeNull();
  });
});

describe('rate limiting', () => {
  it('cuts off repeated guesses at the login door', async () => {
    // Three tries a minute, so the test does not need to send a hundred.
    const strict = await buildServer({
      config: { ...config, authRateLimitPerMinute: 3 },
      db: handle.db,
      redis,
    });

    try {
      const codes: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await strict.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'guess@example.com', password: 'guessing again' },
        });
        codes.push(response.statusCode);
      }

      // The first few are refused because the password is wrong; the rest are
      // refused because the guesser has run out of tries.
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3)).toEqual([429, 429, 429]);
    } finally {
      await strict.close();
    }
  });

  it('does not hold ordinary requests to the login limit', async () => {
    // Many players share one IP address behind a home router or a mobile
    // network. A limit tight enough for password guessing would lock them out.
    const strict = await buildServer({
      config: { ...config, authRateLimitPerMinute: 3 },
      db: handle.db,
      redis,
    });

    try {
      const codes: number[] = [];
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await strict.inject({ method: 'GET', url: '/api/health' });
        codes.push(response.statusCode);
      }
      expect(codes.every((code) => code === 200)).toBe(true);
    } finally {
      await strict.close();
    }
  });
});
