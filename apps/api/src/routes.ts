/**
 * The HTTP surface.
 *
 * These handlers read a request, call one function, and turn its answer into a
 * status code. There are no game rules here and no SQL here — if a handler
 * starts making decisions, the decision belongs somewhere else.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { accounts } from '@atheriam/db';
import { DEFAULT_SPAWN_TILE } from '@atheriam/shared';
import { displayNameSchema } from '@atheriam/protocol';
import type { Database } from '@atheriam/db';
import {
  characterOf,
  login,
  register,
  type LoginFailure,
  type RegisterFailure,
} from './accounts.js';
import {
  MAX_DURATION_MINUTES,
  MAX_REASON_LENGTH,
  banPlayer,
  blockByName,
  blockedIds,
  blockedNames,
  dismissReport,
  kickPlayer,
  mutePlayer,
  openReports,
  recentModerationLog,
  reportByName,
  unbanPlayer,
  unblockByName,
  unmutePlayer,
  type ModerationFailure,
} from './moderation.js';
import type { WorldLink } from './worldLink.js';
import { emailSchema } from './auth/email.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './auth/password.js';
import { SESSION_TTL_SECONDS, type SessionStore } from './auth/sessions.js';

/** The name of the cookie holding the session token. */
export const SESSION_COOKIE = 'atheriam_session';

/**
 * Where a brand new character starts.
 *
 * Taken from `@atheriam/shared` rather than written here, so that this and the
 * world server's idea of the Crown Square cannot drift apart — the last time
 * they did, new players woke up in an orchard.
 */
export const DEFAULT_SPAWN = DEFAULT_SPAWN_TILE;

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
const MESSAGES: Record<RegisterFailure | LoginFailure | ModerationFailure, string> = {
  'no-such-character': 'Nobody in the city goes by that name.',
  'not-yourself': 'You cannot do that to yourself.',
  'not-a-moderator': 'Only a moderator may do that.',
  'no-such-report': 'That report no longer exists.',
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

const nameBody = z.object({ name: displayNameSchema });

const reportBody = z.object({
  name: displayNameSchema,
  reason: z.string().trim().min(3).max(MAX_REASON_LENGTH),
});

const moderationBody = z.object({
  name: displayNameSchema,
  reason: z.string().trim().min(3).max(MAX_REASON_LENGTH),
  /** How long a mute or a ban lasts. Left out means "until it is lifted". */
  minutes: z.number().int().min(1).max(MAX_DURATION_MINUTES).optional(),
  /** The report this answers, when it answers one. */
  reportId: z.string().uuid().optional(),
});

const dismissBody = z.object({
  reportId: z.string().uuid(),
  reason: z.string().trim().min(3).max(MAX_REASON_LENGTH),
});

export interface RouteOptions {
  readonly db: Database;
  readonly sessions: SessionStore;
  readonly secureCookies: boolean;
  /** Requests a minute, per IP, allowed on login and registration. */
  readonly authRateLimitPerMinute: number;
  /**
   * How the API reaches the live city. Without it a ban would only take effect
   * the next time the player logged in, which is when it matters least.
   */
  readonly world: WorldLink;
}

export async function registerRoutes(app: FastifyInstance, options: RouteOptions): Promise<void> {
  const { db, sessions, secureCookies, authRateLimitPerMinute, world } = options;

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

  // ---------------------------------------------------------------------
  // Keeping yourself safe: blocking and reporting.
  // ---------------------------------------------------------------------

  /**
   * "I do not want to hear from this person."
   *
   * The block is written down, and the world server is told at once so that it
   * takes effect in the middle of a conversation rather than at next login.
   * The person blocked is never told: telling them is how a block becomes an
   * argument.
   */
  app.post('/api/players/block', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = nameBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid-request', message: MESSAGES['no-such-character'] });
    }

    const result = await blockByName(db, who.character, parsed.data.name);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    await world.block(who.character.id, result.data.blockedId, true);
    return reply.send({ ok: true });
  });

  app.post('/api/players/unblock', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = nameBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid-request', message: MESSAGES['no-such-character'] });
    }

    const result = await unblockByName(db, who.character, parsed.data.name);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    await world.block(who.character.id, result.data.blockedId, false);
    return reply.send({ ok: true });
  });

  app.get('/api/players/blocked', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    return reply.send({ names: await blockedNames(db, who.character.id) });
  });

  /** The world server asks for this when a player joins. */
  app.get('/api/players/blocked-ids', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    return reply.send({ ids: await blockedIds(db, who.character.id) });
  });

  /**
   * Report somebody to the moderators.
   *
   * Reporting does not silence anybody by itself. It puts a row in a queue a
   * person reads, which is the only kind of moderation that can be argued with
   * later.
   */
  app.post('/api/players/report', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = reportBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid-request',
        message: 'Please say what happened, in a sentence or two.',
      });
    }

    const result = await reportByName(db, who.character, parsed.data.name, parsed.data.reason);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    return reply.code(201).send({ ok: true });
  });

  // ---------------------------------------------------------------------
  // Moderators. Every one of these writes to the audit log.
  // ---------------------------------------------------------------------

  app.get('/api/moderation/reports', async (request, reply) => {
    const moderator = await requireModerator(request, reply);
    if (moderator === null) return reply;
    return reply.send({ reports: await openReports(db) });
  });

  app.get('/api/moderation/log', async (request, reply) => {
    const moderator = await requireModerator(request, reply);
    if (moderator === null) return reply;
    return reply.send({ entries: await recentModerationLog(db) });
  });

  app.post('/api/moderation/mute', async (request, reply) => {
    const moderator = await requireModerator(request, reply);
    if (moderator === null) return reply;

    const parsed = moderationBody.safeParse(request.body);
    if (!parsed.success) return badModerationRequest(reply);

    const result = await mutePlayer(db, {
      moderatorAccountId: moderator.accountId,
      targetName: parsed.data.name,
      reason: parsed.data.reason,
      minutes: parsed.data.minutes,
      reportId: parsed.data.reportId,
    });
    if (!result.ok) {
      return reply.code(404).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    await world.mute(result.data.characterId, result.data.until?.getTime() ?? null);
    return reply.send({ ok: true, until: result.data.until });
  });

  app.post('/api/moderation/unmute', async (request, reply) => {
    const moderator = await requireModerator(request, reply);
    if (moderator === null) return reply;

    const parsed = moderationBody.safeParse(request.body);
    if (!parsed.success) return badModerationRequest(reply);

    const result = await unmutePlayer(db, {
      moderatorAccountId: moderator.accountId,
      targetName: parsed.data.name,
      reason: parsed.data.reason,
    });
    if (!result.ok) {
      return reply.code(404).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    await world.mute(result.data.characterId, null);
    return reply.send({ ok: true });
  });

  app.post('/api/moderation/kick', async (request, reply) => {
    const moderator = await requireModerator(request, reply);
    if (moderator === null) return reply;

    const parsed = moderationBody.safeParse(request.body);
    if (!parsed.success) return badModerationRequest(reply);

    const result = await kickPlayer(db, {
      moderatorAccountId: moderator.accountId,
      targetName: parsed.data.name,
      reason: parsed.data.reason,
      reportId: parsed.data.reportId,
    });
    if (!result.ok) {
      return reply.code(404).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    await world.kick(result.data.characterId, 'kicked');
    return reply.send({ ok: true });
  });

  app.post('/api/moderation/ban', async (request, reply) => {
    const moderator = await requireModerator(request, reply);
    if (moderator === null) return reply;

    const parsed = moderationBody.safeParse(request.body);
    if (!parsed.success) return badModerationRequest(reply);

    const result = await banPlayer(db, {
      moderatorAccountId: moderator.accountId,
      targetName: parsed.data.name,
      reason: parsed.data.reason,
      minutes: parsed.data.minutes,
      reportId: parsed.data.reportId,
    });
    if (!result.ok) {
      return reply.code(404).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    // Out of the city now, not at next login.
    await world.kick(result.data.characterId, 'banned');
    return reply.send({ ok: true });
  });

  app.post('/api/moderation/unban', async (request, reply) => {
    const moderator = await requireModerator(request, reply);
    if (moderator === null) return reply;

    const parsed = moderationBody.safeParse(request.body);
    if (!parsed.success) return badModerationRequest(reply);

    const result = await unbanPlayer(db, {
      moderatorAccountId: moderator.accountId,
      targetName: parsed.data.name,
      reason: parsed.data.reason,
    });
    if (!result.ok) {
      return reply.code(404).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    return reply.send({ ok: true });
  });

  app.post('/api/moderation/dismiss', async (request, reply) => {
    const moderator = await requireModerator(request, reply);
    if (moderator === null) return reply;

    const parsed = dismissBody.safeParse(request.body);
    if (!parsed.success) return badModerationRequest(reply);

    const result = await dismissReport(
      db,
      moderator.accountId,
      parsed.data.reportId,
      parsed.data.reason,
    );
    if (!result.ok) {
      return reply.code(404).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------------

  function badModerationRequest(reply: FastifyReply) {
    return reply.code(400).send({
      error: 'invalid-request',
      message: 'Please give a name and a reason of at least three characters.',
    });
  }

  async function currentSession(token: string | undefined) {
    if (token === undefined) return null;
    return sessions.read(token);
  }

  /** The logged-in player, or a 401 already written into the reply. */
  async function requirePlayer(request: FastifyRequest, reply: FastifyReply) {
    const session = await currentSession(request.cookies[SESSION_COOKIE]);
    if (session === null) {
      void reply.code(401).send({ error: 'not-logged-in', message: 'Please log in.' });
      return null;
    }

    const character = await characterOf(db, session.accountId);
    if (character === null) {
      void reply.code(404).send({ error: 'no-character', message: MESSAGES['no-character'] });
      return null;
    }

    return { accountId: session.accountId, character };
  }

  /**
   * The same, but the account must be a moderator.
   *
   * Being a moderator is read from the database on every request rather than
   * kept in the session, so that taking the badge away takes effect at once
   * instead of whenever they next log in.
   */
  async function requireModerator(request: FastifyRequest, reply: FastifyReply) {
    const session = await currentSession(request.cookies[SESSION_COOKIE]);
    if (session === null) {
      void reply.code(401).send({ error: 'not-logged-in', message: 'Please log in.' });
      return null;
    }

    const found = await db
      .select({ isModerator: accounts.isModerator })
      .from(accounts)
      .where(eq(accounts.id, session.accountId))
      .limit(1);

    if (found[0]?.isModerator !== true) {
      // 404, not 403: a page that says "you are not allowed here" also says
      // "here is a thing worth attacking".
      void reply.code(404).send({ error: 'not-found', message: 'Not found.' });
      return null;
    }

    return { accountId: session.accountId };
  }
}
