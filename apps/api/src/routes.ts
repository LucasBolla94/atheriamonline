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
import { accounts, characters } from '@atheriam/db';
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
  findCharacterByName,
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
import { formatAmount } from '@atheriam/economy';
import { historyOf, purseOf } from './economy.js';
import { inventoryOf } from './items.js';
import { DAILY_CROWNS, grantDailyReward, grantWelcome } from './gifts.js';
import {
  cancel as cancelTrade,
  cancelTradesOf,
  confirm as confirmTrade,
  expireStaleTrades,
  offerItem,
  offerMoney,
  openTradeOf,
  startTrade,
  tradeById,
  viewOf,
  withdrawItem,
  type TradeFailure,
} from './trading.js';
import { parseAmount } from '@atheriam/economy';
import {
  contentsOf,
  houseById,
  houseOf,
  mayEnter,
  place,
  rotate,
  setAccess,
  takeBack,
  unwelcome,
  welcome,
  welcomedNames,
  type HouseFailure,
} from './houses.js';
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
  appearance: z.number().int().min(0).max(5).default(0),
  /** The person must tick a box saying they are an adult. */
  confirmsAdult: z.literal(true),
});

const loginBody = z.object({
  email: emailSchema,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/** What the player is told when something is refused. */
const MESSAGES: Record<
  | RegisterFailure
  | LoginFailure
  | ModerationFailure
  | TradeFailure
  | HouseFailure
  | 'unknown-problem',
  string
> = {
  'no-such-house': 'There is no house there.',
  'not-your-house': 'That is not your house.',
  'not-welcome': 'The door is shut. They have not welcomed you in.',
  'not-furniture': 'That is not something you can put down.',
  'tile-taken': 'Something is already standing there.',
  'bad-place': 'Nothing can stand there.',
  'bad-rotation': 'Furniture turns in quarters.',
  'unknown-problem': 'Something went wrong. Please try again.',
  'already-trading': 'One of you is already trading with somebody else.',
  'no-such-trade': 'That trade is no longer open.',
  'not-your-trade': 'That trade is not yours.',
  'trade-is-over': 'That trade has already finished.',
  'not-your-item': 'You are not holding that.',
  'too-many-items': 'That is as much as you can put on the table at once.',
  'not-enough-money': 'You do not have that much.',
  'not-confirmed-by-both': 'You both have to agree first.',
  'changed-since-you-confirmed': 'Something changed. Have another look before agreeing.',
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
      appearance: parsed.data.appearance,
      spawn: DEFAULT_SPAWN,
    });

    if (!result.ok) {
      // 409 for "somebody already has that", 400 for "what you sent is wrong".
      const conflict = result.reason === 'email-taken' || result.reason === 'name-taken';
      return reply
        .code(conflict ? 409 : 400)
        .send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    // The purse and the few starter belongings. Done after the account, and
    // again on every login, so that a failure here is put right next time
    // rather than leaving somebody with nothing forever.
    await grantWelcome(db, result.character.id);

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

    // Cheap, and it repairs an account whose welcome gift never landed.
    await grantWelcome(db, result.character.id);

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
    // Leaving must never cost anybody anything: whatever was on the table goes
    // back before the session is thrown away.
    const session = token === undefined ? null : await sessions.read(token);
    if (session !== null) {
      const character = await characterOf(db, session.accountId);
      if (character !== null) await cancelTradesOf(db, character.id);
    }
    if (token !== undefined) await sessions.destroy(token);
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
  });

  app.post('/api/me/appearance', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    const parsed = z.object({ appearance: z.number().int().min(0).max(5) }).safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: 'invalid-appearance', message: 'Choose one of the available looks.' });
    await db
      .update(characters)
      .set({ appearance: parsed.data.appearance })
      .where(eq(characters.id, who.character.id));
    await world.appearance(who.character.id, parsed.data.appearance);
    return { appearance: parsed.data.appearance };
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
      character: {
        name: character.name,
        x: character.x,
        y: character.y,
        appearance: character.appearance,
      },
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
  // What you own: your purse and your belongings.
  // ---------------------------------------------------------------------

  /**
   * What is in your purse, and how it got there.
   *
   * The amount is sent as a string, not a number. JSON has no integers big
   * enough to be trusted with money, and a `number` is exactly what the whole
   * economy is built to avoid.
   */
  app.get('/api/me/purse', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const balance = await purseOf(db, who.character.id);
    const history = await historyOf(db, who.character.id);

    return reply.send({
      amount: balance.toString(),
      display: formatAmount(balance),
      history: history.map((entry) => ({
        amount: entry.amount.toString(),
        display: formatAmount(entry.amount),
        reason: entry.reason,
        at: entry.at,
      })),
    });
  });

  /** Everything you are carrying. */
  app.get('/api/me/inventory', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    return reply.send({ items: await inventoryOf(db, who.character.id) });
  });

  /**
   * Collect today's reward.
   *
   * Asking twice on the same day is not an error and is not a second payment:
   * the answer says it was already collected.
   */
  app.post('/api/me/daily-reward', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const result = await grantDailyReward(db, who.character.id);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES['unknown-problem'] });
    }

    const balance = await purseOf(db, who.character.id);
    return reply.send({
      claimed: !result.alreadyClaimed,
      amount: DAILY_CROWNS.toString(),
      display: formatAmount(DAILY_CROWNS),
      purse: formatAmount(balance),
    });
  });

  // ---------------------------------------------------------------------
  // Houses.
  //
  // The API owns the house: who may come in, and what is standing in it. The
  // world server owns where people are, so "let me in" ends with a command to
  // it rather than with this server moving anybody.
  // ---------------------------------------------------------------------

  /** Anything addressed by its own id: a house, a trade. */
  const idParams = z.object({ id: z.string().uuid() });

  const accessBody = z.object({ access: z.enum(['nobody', 'welcomed', 'everyone']) });
  const placeBody = z.object({
    itemId: z.string().uuid(),
    x: z.number().int().min(0).max(64),
    y: z.number().int().min(0).max(64),
    rotation: z.number().int().min(0).max(359),
  });
  const rotateBody = z.object({
    itemId: z.string().uuid(),
    rotation: z.number().int().min(0).max(359),
  });
  const takeBackBody = z.object({ itemId: z.string().uuid() });

  /** Your own house: who may come in, and what is in it. */
  app.get('/api/houses/mine', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const house = await houseOf(db, who.character.id);
    return reply.send({
      id: house.id,
      access: house.access,
      welcomed: await welcomedNames(db, house.id),
      contents: await contentsOf(db, house.id),
      yours: true,
    });
  });

  /** What is in a house you are standing in, or about to walk into. */
  app.get('/api/houses/:id', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const id = idParams.safeParse(request.params);
    if (!id.success) return badRequest(reply);

    const house = await houseById(db, id.data.id);
    if (house === null) {
      return reply.code(404).send({ error: 'no-such-house', message: MESSAGES['no-such-house'] });
    }
    if (!(await mayEnter(db, house, who.character.id))) {
      return reply.code(403).send({ error: 'not-welcome', message: MESSAGES['not-welcome'] });
    }

    return reply.send({
      id: house.id,
      access: house.access,
      welcomed: [],
      contents: await contentsOf(db, house.id),
      yours: house.ownerId === who.character.id,
    });
  });

  /** Go home. */
  app.post('/api/houses/mine/enter', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const house = await houseOf(db, who.character.id);
    await world.enterHouse(who.character.id, house.id);
    return reply.send({ id: house.id });
  });

  /** Call on somebody. */
  app.post('/api/houses/visit', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = nameBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid-request', message: MESSAGES['no-such-character'] });
    }

    const them = await findCharacterByName(db, parsed.data.name);
    if (them === null) {
      return reply
        .code(404)
        .send({ error: 'no-such-character', message: MESSAGES['no-such-character'] });
    }

    const house = await houseOf(db, them.id);
    if (!(await mayEnter(db, house, who.character.id))) {
      return reply.code(403).send({ error: 'not-welcome', message: MESSAGES['not-welcome'] });
    }

    await world.enterHouse(who.character.id, house.id);
    return reply.send({ id: house.id });
  });

  /** Back out into the street. */
  app.post('/api/houses/leave', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    await world.leaveHouse(who.character.id);
    return reply.send({ ok: true });
  });

  /** Change who may come in. */
  app.post('/api/houses/mine/access', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = accessBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);

    const house = await setAccess(db, who.character.id, parsed.data.access);
    return reply.send({ access: house.access });
  });

  /** Welcome somebody in, or stop doing so. */
  app.post('/api/houses/mine/welcome', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = nameBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);

    const them = await findCharacterByName(db, parsed.data.name);
    if (them === null) {
      return reply
        .code(404)
        .send({ error: 'no-such-character', message: MESSAGES['no-such-character'] });
    }

    const result = await welcome(db, who.character.id, them.id);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    return reply.send({ welcomed: await welcomedNames(db, result.data.id) });
  });

  app.post('/api/houses/mine/unwelcome', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = nameBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);

    const them = await findCharacterByName(db, parsed.data.name);
    if (them === null) {
      return reply
        .code(404)
        .send({ error: 'no-such-character', message: MESSAGES['no-such-character'] });
    }

    const result = await unwelcome(db, who.character.id, them.id);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    return reply.send({ welcomed: await welcomedNames(db, result.data.id) });
  });

  /** Put a piece of furniture down. It leaves your inventory. */
  app.post('/api/houses/mine/place', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = placeBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);

    const result = await place(
      db,
      who.character.id,
      parsed.data.itemId,
      parsed.data.x,
      parsed.data.y,
      parsed.data.rotation,
    );
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    return reply.send({ contents: result.data });
  });

  /** Turn a piece of furniture on the spot. */
  app.post('/api/houses/mine/rotate', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = rotateBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);

    const result = await rotate(db, who.character.id, parsed.data.itemId, parsed.data.rotation);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    return reply.send({ contents: result.data });
  });

  /** Pick a piece of furniture back up. */
  app.post('/api/houses/mine/take-back', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = takeBackBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);

    const result = await takeBack(db, who.character.id, parsed.data.itemId);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    return reply.send({ contents: result.data });
  });

  // ---------------------------------------------------------------------
  // Trading.
  //
  // Every one of these ends the same way: the other person is nudged, and
  // both sides are sent the trade as they should now see it. The browser is
  // never told what changed — it is told to look, and it asks.
  // ---------------------------------------------------------------------

  const itemBody = z.object({ itemId: z.string().uuid() });
  const moneyBody = z.object({ amount: z.string().min(1).max(24) });

  /** Send the trade back to whoever asked, and nudge the other side. */
  async function afterTradeChange(
    reply: FastifyReply,
    tradeId: string,
    meId: string,
    themId: string,
  ) {
    await world.notify(themId, 'trade');
    const trade = await tradeById(db, tradeId);
    if (trade === null) return reply.send({ trade: null });
    return reply.send({ trade: await viewOf(db, trade, meId) });
  }

  /** The trade you are in, or nothing. */
  app.get('/api/trades/current', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    await expireStaleTrades(db);
    const trade = await openTradeOf(db, who.character.id);
    if (trade === null) return reply.send({ trade: null });
    return reply.send({ trade: await viewOf(db, trade, who.character.id) });
  });

  /** Ask somebody to trade. Both of you are then in it. */
  app.post('/api/trades', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const parsed = nameBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid-request', message: MESSAGES['no-such-character'] });
    }

    const them = await findCharacterByName(db, parsed.data.name);
    if (them === null) {
      return reply
        .code(404)
        .send({ error: 'no-such-character', message: MESSAGES['no-such-character'] });
    }

    await expireStaleTrades(db);
    const started = await startTrade(db, who.character.id, them.id);
    if (!started.ok) {
      return reply.code(409).send({ error: started.reason, message: MESSAGES[started.reason] });
    }

    return afterTradeChange(reply, started.data.id, who.character.id, them.id);
  });

  app.post('/api/trades/:id/offer-item', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const id = idParams.safeParse(request.params);
    const body = itemBody.safeParse(request.body);
    if (!id.success || !body.success) return badRequest(reply);

    const result = await offerItem(db, id.data.id, who.character.id, body.data.itemId);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    const them =
      result.data.initiatorId === who.character.id
        ? result.data.partnerId
        : result.data.initiatorId;
    return afterTradeChange(reply, id.data.id, who.character.id, them);
  });

  app.post('/api/trades/:id/withdraw-item', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const id = idParams.safeParse(request.params);
    const body = itemBody.safeParse(request.body);
    if (!id.success || !body.success) return badRequest(reply);

    const result = await withdrawItem(db, id.data.id, who.character.id, body.data.itemId);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    const them =
      result.data.initiatorId === who.character.id
        ? result.data.partnerId
        : result.data.initiatorId;
    return afterTradeChange(reply, id.data.id, who.character.id, them);
  });

  /** Say how much money is on your side of the table. A total, not a change. */
  app.post('/api/trades/:id/money', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const id = idParams.safeParse(request.params);
    const body = moneyBody.safeParse(request.body);
    if (!id.success || !body.success) return badRequest(reply);

    // Read by the economy package, which does not use floating point.
    const amount = parseAmount(body.data.amount);
    if (amount === null || amount < 0n) {
      return reply
        .code(400)
        .send({ error: 'invalid-request', message: 'That is not an amount of Crowns.' });
    }

    const result = await offerMoney(db, id.data.id, who.character.id, amount);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    const them =
      result.data.initiatorId === who.character.id
        ? result.data.partnerId
        : result.data.initiatorId;
    return afterTradeChange(reply, id.data.id, who.character.id, them);
  });

  /** "I am happy with this." When both have said it, the swap happens. */
  app.post('/api/trades/:id/confirm', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const id = idParams.safeParse(request.params);
    if (!id.success) return badRequest(reply);

    const result = await confirmTrade(db, id.data.id, who.character.id);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    const trade = result.data.trade;
    const them = trade.initiatorId === who.character.id ? trade.partnerId : trade.initiatorId;
    await world.notify(them, 'trade');

    if (result.data.completed) {
      return reply.send({ trade: null, completed: true });
    }

    const current = await tradeById(db, id.data.id);
    return reply.send({
      trade: current === null ? null : await viewOf(db, current, who.character.id),
      completed: false,
    });
  });

  /** Call it off. Everything goes back to whoever put it on the table. */
  app.post('/api/trades/:id/cancel', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;

    const id = idParams.safeParse(request.params);
    if (!id.success) return badRequest(reply);

    const result = await cancelTrade(db, id.data.id, who.character.id);
    if (!result.ok) {
      return reply.code(400).send({ error: result.reason, message: MESSAGES[result.reason] });
    }

    const them =
      result.data.initiatorId === who.character.id
        ? result.data.partnerId
        : result.data.initiatorId;
    await world.notify(them, 'trade');
    return reply.send({ trade: null });
  });

  function badRequest(reply: FastifyReply) {
    return reply
      .code(400)
      .send({ error: 'invalid-request', message: 'That request did not make sense.' });
  }

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
