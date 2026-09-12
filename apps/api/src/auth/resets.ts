/**
 * "I have forgotten my password."
 *
 * A reset is a single-use token with a short life, kept in Redis. Three
 * decisions matter here, and all three are about what happens when something
 * goes wrong:
 *
 *  - **Only a hash of the token is stored.** Somebody who reads the Redis
 *    database — a backup, a log, a mistake — finds hashes, not working links.
 *    The token itself exists only in the email and in the player's browser.
 *  - **It works once.** Reading it deletes it, in a single Redis command, so
 *    two people racing on a forwarded link cannot both use it.
 *  - **It expires in an hour.** Long enough to find the email, short enough
 *    that an old message in a mailbox is not a key to the account.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/** How long a reset link works for. */
export const RESET_TTL_SECONDS = 60 * 60;

/** What a spent token tells us. */
export interface ResetData {
  readonly accountId: string;
}

/**
 * The key a token is stored under: the hash of the token, never the token.
 *
 * SHA-256 rather than a password hash on purpose. This is a 32-byte random
 * string, not something a person chose, so there is nothing to guess and
 * nothing for a slow hash to protect against — and a reset link should not
 * take a second of CPU to check.
 */
function keyFor(token: string): string {
  return `reset:${createHash('sha256').update(token).digest('hex')}`;
}

/** Make a link's token and remember who it belongs to. */
export async function createReset(redis: Redis, accountId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const data: ResetData = { accountId };
  await redis.set(keyFor(token), JSON.stringify(data), 'EX', RESET_TTL_SECONDS);
  return token;
}

/**
 * Spend a token.
 *
 * Reading and deleting happen in one command, so a link that is used twice —
 * by a double click, or by somebody who was forwarded the email — works
 * exactly once.
 */
export async function spendReset(redis: Redis, token: string): Promise<ResetData | null> {
  if (token.length === 0 || token.length > 512) return null;

  const raw = await redis.getdel(keyFor(token));
  if (raw === null) return null;

  try {
    const data = JSON.parse(raw) as ResetData;
    return typeof data.accountId === 'string' ? data : null;
  } catch {
    return null;
  }
}
