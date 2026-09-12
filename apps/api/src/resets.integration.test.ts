/**
 * Forgetting a password, and getting back in.
 *
 * The things worth proving here are mostly about what the server refuses to
 * say and what it refuses to leave behind: that the answer is the same for an
 * address that exists and one that does not, that a link works exactly once,
 * and that changing a password throws out every session — including whoever
 * else was logged in as that person.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { connect, type DatabaseHandle } from '@atheriam/db';
import { testDatabaseUrl, testRedisUrl } from '../../../test/integration-setup.js';
import { buildServer } from './server.js';
import { readConfig } from './config.js';
import { SESSION_COOKIE } from './routes.js';
import type { Mailer, Message } from './mail.js';

const handle: DatabaseHandle = connect(testDatabaseUrl(), 4);
const redis = new Redis(testRedisUrl());

const config = readConfig({
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: '3001',
  DATABASE_URL: testDatabaseUrl(),
  REDIS_URL: testRedisUrl(),
  PUBLIC_ORIGIN: 'https://atheriam.online',
  SESSION_SECRET: 'a'.repeat(64),
  GENERAL_RATE_LIMIT_PER_MINUTE: '10000',
  AUTH_RATE_LIMIT_PER_MINUTE: '10000',
});

/** A mailer that keeps what it was asked to send, instead of sending it. */
function spyMailer(): Mailer & { sent: Message[]; fail: boolean } {
  const state = {
    sent: [] as Message[],
    fail: false,
    configured: true,
    send: async (message: Message) => {
      if (state.fail) return Promise.resolve({ ok: false as const, reason: 'test' });
      state.sent.push(message);
      return Promise.resolve({ ok: true as const });
    },
  };
  return state;
}

let app: FastifyInstance;
let mailer: ReturnType<typeof spyMailer>;

const GOOD = {
  email: 'aldric@example.com',
  password: 'correct horse battery staple',
  dateOfBirth: '1990-05-04',
  characterName: 'Aldric',
  confirmsAdult: true as const,
};

async function registerPlayer(): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: GOOD });
  expect(response.statusCode).toBe(201);
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (cookie === undefined) throw new Error('No session cookie came back.');
  return cookie.value;
}

/** Pull the token out of the link in the email, the way a person clicking would. */
function tokenFromEmail(message: Message | undefined): string {
  const found = /[?&]reset=([A-Za-z0-9_-]+)/.exec(message?.text ?? '');
  if (found?.[1] === undefined) throw new Error(`No reset link in: ${message?.text ?? '(none)'}`);
  return found[1];
}

beforeEach(async () => {
  await handle.db.execute(sql`TRUNCATE TABLE characters, accounts RESTART IDENTITY CASCADE`);
  await redis.flushdb();
  await app?.close();
  mailer = spyMailer();
  app = await buildServer({ config, db: handle.db, redis, mailer });
});

afterAll(async () => {
  await app?.close();
  redis.disconnect();
  await handle.close();
});

describe('asking for a link', () => {
  it('sends one, with a link to this site', async () => {
    await registerPlayer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      payload: { email: GOOD.email },
    });

    expect(response.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(GOOD.email);
    expect(mailer.sent[0]?.text).toContain('https://atheriam.online/?reset=');
  });

  it('answers exactly the same for an address nobody has', async () => {
    await registerPlayer();

    const known = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      payload: { email: GOOD.email },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      payload: { email: 'nobody@example.com' },
    });

    // Same status and same body: this route must not become a way of asking
    // "does this person play?".
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.json()).toEqual(known.json());
    expect(mailer.sent).toHaveLength(1);
  });

  it('answers the same for an address that is not an address at all', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      payload: { email: 'not-an-address' },
    });
    expect(response.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });

  it('says so when the email could not be sent, rather than pretending', async () => {
    await registerPlayer();
    mailer.fail = true;

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      payload: { email: GOOD.email },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().message).toContain('could not send');
  });

  it('refuses when this server has no way to send email at all', async () => {
    const silent = await buildServer({
      config,
      db: handle.db,
      redis,
      mailer: {
        configured: false,
        send: async () => Promise.resolve({ ok: false as const, reason: 'not-configured' }),
      },
    });

    try {
      const response = await silent.inject({
        method: 'POST',
        url: '/api/auth/forgot',
        payload: { email: GOOD.email },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe('no-email');
    } finally {
      await silent.close();
    }
  });
});

describe('using the link', () => {
  it('changes the password, and the new one works', async () => {
    await registerPlayer();
    await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: GOOD.email } });
    const token = tokenFromEmail(mailer.sent[0]);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token, password: 'a completely different password' },
    });
    expect(reset.statusCode).toBe(200);

    const withNew = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD.email, password: 'a completely different password' },
    });
    expect(withNew.statusCode).toBe(200);

    const withOld = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD.email, password: GOOD.password },
    });
    expect(withOld.statusCode).toBe(401);
  });

  it('works exactly once', async () => {
    await registerPlayer();
    await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: GOOD.email } });
    const token = tokenFromEmail(mailer.sent[0]);

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token, password: 'a completely different password' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token, password: 'yet another password entirely' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('bad-reset-link');
  });

  it('throws out every session, including one somebody else was using', async () => {
    const mine = await registerPlayer();

    // A second session on the same account: the other person, or another
    // device. Resetting a password has to end this one too.
    const theirs = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD.email, password: GOOD.password },
    });
    const theirCookie = theirs.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';
    expect(theirCookie).not.toBe('');

    // Both work before the reset.
    for (const cookie of [mine, theirCookie]) {
      const who = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
      });
      expect(who.statusCode).toBe(200);
    }

    await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: GOOD.email } });
    await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token: tokenFromEmail(mailer.sent[0]), password: 'a completely new password' },
    });

    for (const cookie of [mine, theirCookie]) {
      const who = await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
      });
      expect(who.statusCode).toBe(401);
    }
  });

  it('refuses a token nobody issued', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token: 'a'.repeat(43), password: 'a completely different password' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad-reset-link');
  });

  it('refuses a new password that signing up would have refused', async () => {
    await registerPlayer();
    await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: GOOD.email } });
    const token = tokenFromEmail(mailer.sent[0]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token, password: 'short' },
    });
    expect(response.statusCode).toBe(400);

    // And the old password still works, because nothing was changed.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD.email, password: GOOD.password },
    });
    expect(login.statusCode).toBe(200);
  });

  it('does not send a link to an account that has been banned', async () => {
    await registerPlayer();
    await handle.db.execute(sql`UPDATE accounts SET status = 'banned'`);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      payload: { email: GOOD.email },
    });

    // The same answer as always — but nothing goes out.
    expect(response.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });
});
