/**
 * The only two ways money comes into the world.
 *
 * `docs/SPEC.md` section 9 says money may only be created in `system:mint`,
 * and only by a named, audited operation. These are those operations, and
 * there are deliberately just two of them:
 *
 *  - a welcome purse, once per character;
 *  - a daily reward, once per character per day.
 *
 * Both are minted with an idempotency key that says who and when, so asking
 * twice is not a second payment — the key is unique in the database, and the
 * second attempt finds the first one and reports it.
 *
 * There is no shop and nothing here takes real money: Q-002 is still open and
 * no code assumes an answer to it.
 */
import { and, eq } from 'drizzle-orm';
import { itemInstances, type Database } from '@atheriam/db';
import { MINT, crowns, playerAccount, type Money } from '@atheriam/economy';
import { move } from './economy.js';
import { giveStarterItems } from './items.js';

/** What a new character is given to start with. */
export const WELCOME_CROWNS: Money = crowns(50);

/** What a character may collect once a day. */
export const DAILY_CROWNS: Money = crowns(10);

/**
 * Give a new character their purse and their few belongings.
 *
 * Safe to call again: the money is keyed on the character, and the items are
 * only given to somebody who owns nothing at all. That matters because this is
 * called on login as well as on registration — if the gift failed the first
 * time, the next login puts it right rather than leaving somebody with an
 * empty purse forever.
 */
export async function grantWelcome(db: Database, characterId: string): Promise<void> {
  await move(db, {
    from: MINT,
    to: playerAccount(characterId),
    amount: WELCOME_CROWNS,
    reason: 'welcome to the city',
    idempotencyKey: `welcome:${characterId}`,
  });

  await db.transaction(async (tx) => {
    // Two logins at the same moment would otherwise both find an empty
    // inventory and both fill it.
    const owned = await tx
      .select({ id: itemInstances.id })
      .from(itemInstances)
      .where(
        and(eq(itemInstances.holderKind, 'character'), eq(itemInstances.holderId, characterId)),
      )
      .limit(1)
      .for('update');

    if (owned.length > 0) return;
    await giveStarterItems(tx, characterId);
  });
}

export type DailyRewardResult =
  { ok: true; amount: Money; alreadyClaimed: boolean } | { ok: false; reason: string };

/**
 * Collect today's reward.
 *
 * "Today" is a date in UTC, so the day turns at the same moment for everybody
 * rather than at a time each player could choose by changing their clock.
 */
export async function grantDailyReward(
  db: Database,
  characterId: string,
  now = new Date(),
): Promise<DailyRewardResult> {
  const today = now.toISOString().slice(0, 10);

  const result = await move(db, {
    from: MINT,
    to: playerAccount(characterId),
    amount: DAILY_CROWNS,
    reason: `daily reward for ${today}`,
    idempotencyKey: `daily:${characterId}:${today}`,
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, amount: DAILY_CROWNS, alreadyClaimed: result.alreadyDone };
}
