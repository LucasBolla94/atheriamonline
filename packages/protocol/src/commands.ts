/**
 * Messages between our own two servers, carried on Redis.
 *
 * The API owns everything durable: it is where a mute is written down and
 * where a ban is decided. The world server owns what is live: who is in the
 * city right now and who can hear whom. When the API changes something that
 * must take effect immediately — a mute, a kick, a block — it says so on this
 * channel and the world server acts on it.
 *
 * Without this, a moderator's ban would only take effect the next time the
 * player logged in, which is precisely when it matters least.
 *
 * These are validated exactly like anything else. Redis is inside our own
 * network, but a message we cannot parse is still a message we must not act
 * on half way through.
 */
import { z } from 'zod';

/** The Redis channel the API publishes to and the world server listens on. */
export const WORLD_COMMAND_CHANNEL = 'atheriam:world-commands';

const characterIdSchema = z.string().min(1).max(64);

/** Throw a player out now, because a moderator kicked or banned them. */
export const kickCommandSchema = z.object({
  t: z.literal('kick'),
  characterId: characterIdSchema,
  reason: z.enum(['kicked', 'banned']),
});

/** Silence a player now, or let them speak again with `untilMs: null`. */
export const muteCommandSchema = z.object({
  t: z.literal('mute'),
  characterId: characterIdSchema,
  untilMs: z.number().int().nonnegative().nullable(),
});

/** One player has blocked, or unblocked, another. */
export const blockCommandSchema = z.object({
  t: z.literal('block'),
  blockerId: characterIdSchema,
  blockedId: characterIdSchema,
  blocked: z.boolean(),
});

/**
 * Tell one player that something they are involved in has changed.
 *
 * The API knows a trade has moved on; only the world server has a socket open
 * to the people in it. This is a nudge and carries no detail: the browser asks
 * the API for the new state, which keeps one place in charge of what is true.
 */
export const notifyCommandSchema = z.object({
  t: z.literal('notify'),
  characterId: characterIdSchema,
  about: z.enum(['trade']),
});

/**
 * Take a player indoors, or bring them back out.
 *
 * Whether they are allowed in was decided by the API, which owns the house and
 * its list of who may come in. The world server only moves them.
 */
export const enterHouseCommandSchema = z.object({
  t: z.literal('enter-house'),
  characterId: characterIdSchema,
  houseId: z.string().min(1).max(64),
});

export const leaveHouseCommandSchema = z.object({
  t: z.literal('leave-house'),
  characterId: characterIdSchema,
});

export const worldCommandSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('appearance'),
    characterId: characterIdSchema,
    appearance: z.number().int().min(0).max(5),
  }),
  kickCommandSchema,
  muteCommandSchema,
  blockCommandSchema,
  notifyCommandSchema,
  z.object({
    t: z.literal('enter-property'),
    characterId: characterIdSchema,
    propertyId: z.string().uuid(),
  }),
  z.object({ t: z.literal('recheck-property'), propertyId: z.string().uuid() }),
  enterHouseCommandSchema,
  leaveHouseCommandSchema,
]);

export type WorldCommand = z.infer<typeof worldCommandSchema>;

/** Read a command off the channel. Nothing throws; a bad message is ignored. */
export function decodeWorldCommand(raw: string): WorldCommand | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = worldCommandSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
