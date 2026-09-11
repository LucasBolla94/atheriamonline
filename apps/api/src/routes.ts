/**
 * The HTTP surface.
 *
 * These handlers read a request, call one function, and turn its answer into a
 * status code. There are no game rules here and no SQL here — if a handler
 * starts making decisions, the decision belongs somewhere else.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { displayNameSchema } from '@atheriam/protocol';
import type { Database } from '@atheriam/db';
import {
  characterOf,
  login,
  register,
  type LoginFailure,
  type RegisterFailure,
} from './accounts.js';
import { emailSchema } from './auth/email.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './auth/password.js';
import { SESSION_TTL_SECONDS, type SessionStore } from './auth/sessions.js';

/** The name of the cookie holding the session token. */
export const SESSION_COOKIE = 'atheriam_session';

/** Where a brand new character starts. Matches the world server's spawn. */
export const DEFAULT_SPAWN = { x: 20, y: 12 } as const;

const registerBody = z.object({
  email: emailSchema,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the form YYYY-MM-DD.'),
  characterName: displayNameSchema,
  /** The person must tick a box saying they are an adult. */
  confirmsAdult: z.literal(true),
});

const loginBody = z.object({
  email: emailSchema,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/** What the player is told when something is refused. */
const MESSAGES: Record<RegisterFailure | LoginFailure, string> = {
  'under-age': 'Atheriam is for adults. You must be 18 or over to play.',
  'bad-date-of-birth': 'That date of birth does not look right.',
  'password-too-short': `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  'password-too-long': `Your password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
  'password-same-as-email': 'Your password cannot be your email address.',
  'email-taken': 'There is already an account with that email address.',
  'name-taken': 'Somebody already uses that name in the city. Try another.',
  'wrong-credentials': 'That email address and password do not match.',
  suspended: 'This account is suspended.',
  banned: 'This account is banned.',
  'no-character': 'This account has no character. Please contact support.',
};

export interface RouteOptions {
  readonly db: Database;
  readonly sessions: SessionStore;
  readonly secureCookies: boolean;
  /** Requests a minute, per IP, allowed on login and registration. */
  readonly authRateLimitPerMinute: number;
}

export async function registerRoutes(app: FastifyInstance, options: RouteOptions): Promise<void> {
  const { db, sessions, secureCookies, authRateLimitPerMinute } = options;

  /**
   * The routes where somebody guesses. Everything else runs on the general
   * limit, which has to stay generous: many real players share one IP address
   * behind a home router or a mobile network.
   */
  const guessable = {
    config: {
      rateLimit: { max: authRateLimitPerMinute, timeWindow: '1 minute' },
    },
  };

  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };

  /** Is the database awake? Used by Docker, by Caddy and by us. */
  app.get('/api/health', async () => {
    return { ok: true, service: 'api' };
  });

  app.post('/api/auth/register', guessable, async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid-request',
        message: parsed.error.issues[0]?.message ?? 'Please check the form and try again.',
      });
    }

    const result = await register(db, {
      email: parsed.data.email,
      password: parsed.data.password,
      dateOfBirth: parsed.data.dateOfBirth,
      characterName: parsed.data.characterName,
      spawn: DEFAULT_SPAWN,
    });

    if (!result.ok) {
      // 409 for "somebody already has that", 400 for "what you sent is wrong".
      const conflict = result.reason === 'email-taken' || result.reason === 'name-taken';
      return reply
        .code(conflict ? 409 : 400)
        .send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    const token = await sessions.create({
      accountId: result.account.id,
      characterId: result.character.id,
    });

    return reply
      .setCookie(SESSION_COOKIE, token, cookieOptions)
      .code(201)
      .send({ character: { name: result.character.name } });
  });

  app.post('/api/auth/login', guessable, async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) {
      // Deliberately vague: a precise message here tells someone which half of
      // a guess was right.
      return reply
        .code(401)
        .send({ error: 'wrong-credentials', message: MESSAGES['wrong-credentials'] });
    }

    const result = await login(db, parsed.data.email, parsed.data.password);
    if (!result.ok) {
      const code = result.reason === 'wrong-credentials' ? 401 : 403;
      return reply.code(code).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    const token = await sessions.create({
      accountId: result.account.id,
      characterId: result.character.id,
    });

    return reply
      .setCookie(SESSION_COOKIE, token, cookieOptions)
      .send({ character: { name: result.character.name } });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined) await sessions.destroy(token);
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
  });

  app.get('/api/me', async (request, reply) => {
    const session = await currentSession(request.cookies[SESSION_COOKIE]);
    if (session === null) {
      return reply.code(401).send({ error: 'not-logged-in', message: 'Please log in.' });
    }

    const character = await characterOf(db, session.accountId);
    if (character === null) {
      return reply.code(404).send({ error: 'no-character', message: MESSAGES['no-character'] });
    }

    return reply.send({
      character: { name: character.name, x: character.x, y: character.y },
    });
  });

  /**
   * Hand out a ticket for opening the WebSocket.
   *
   * The session cookie is never used as a WebSocket credential: a ticket that
   * expires in thirty seconds and works once is far less useful to anyone who
   * manages to steal it.
   */
  app.post('/api/world/ticket', async (request, reply) => {
    const session = await currentSession(request.cookies[SESSION_COOKIE]);
    if (session === null) {
      return reply.code(401).send({ error: 'not-logged-in', message: 'Please log in.' });
    }

    const character = await characterOf(db, session.accountId);
    if (character === null) {
      return reply.code(404).send({ error: 'no-character', message: MESSAGES['no-character'] });
    }

    const ticket = await sessions.issueTicket({
      accountId: session.accountId,
      characterId: character.id,
      characterName: character.name,
    });

    return reply.send({ ticket });
  });

  async function currentSession(token: string | undefined) {
    if (token === undefined) return null;
    return sessions.read(token);
  }
}
