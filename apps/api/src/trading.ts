/**
 * Two people swapping things.
 *
 * The shape of a safe trade, from `docs/SPEC.md` section 9:
 *
 *  - everything on the table has **already left its owner**. Items are held by
 *    the trade; money sits in `escrow:trade:<id>` in the ledger. Nobody can
 *    spend or give away what they have already offered;
 *  - **both sides confirm**, and any change to what is on the table takes both
 *    confirmations away. Without that rule the oldest trick in the book works:
 *    confirm, then swap the good item for a worthless one while the other
 *    person is reaching for the button;
 *  - the swap happens in **one transaction**. If anything fails, everything is
 *    where it started;
 *  - cancelling — or simply walking away — gives everything back.
 *
 * Nothing here trusts an item id from a browser. Every offer is checked
 * against who actually holds the item, in the same statement that moves it.
 */
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { itemInstances, tradeItems, trades, type Database, type Trade } from '@atheriam/db';
import { formatAmount, playerAccount, tradeEscrow, type Money } from '@atheriam/economy';
import { moveWithin, purseOf } from './economy.js';
import { moveItem } from './items.js';

/** Any database handle: the pool, or a transaction already in progress. */
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/** The most things one person may put on the table at once. */
export const MAX_ITEMS_PER_SIDE = 12;

/**
 * How long a trade may sit untouched before it is called off.
 *
 * Somebody who closes the tab half way through a trade would otherwise leave
 * both people locked out of trading with anybody else, and their things on a
 * table nobody is at. Ten minutes is long enough for a real conversation and
 * short enough that nobody waits about.
 */
export const TRADE_IDLE_LIMIT_MS = 10 * 60 * 1000;

export type TradeFailure =
  | 'no-such-character'
  | 'not-yourself'
  | 'already-trading'
  | 'no-such-trade'
  | 'not-your-trade'
  | 'trade-is-over'
  | 'not-your-item'
  | 'too-many-items'
  | 'not-enough-money'
  | 'not-confirmed-by-both'
  | 'changed-since-you-confirmed';

export type TradeResult<T> = { ok: true; data: T } | { ok: false; reason: TradeFailure };

/** Is this person one of the two in the trade? */
function sideOf(trade: Trade, characterId: string): 'initiator' | 'partner' | null {
  if (trade.initiatorId === characterId) return 'initiator';
  if (trade.partnerId === characterId) return 'partner';
  return null;
}

/**
 * Call off any trade that has been sitting untouched too long.
 *
 * Called before anybody is told what trade they are in, so a stale one never
 * blocks a new one and nothing is left on a table nobody is at.
 */
export async function expireStaleTrades(db: Database): Promise<void> {
  const cutoff = new Date(Date.now() - TRADE_IDLE_LIMIT_MS);
  const stale = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.status, 'open'), lt(trades.updatedAt, cutoff)));

  for (const row of stale) {
    await cancel(db, row.id, null);
  }
}

/** The trade somebody is in right now, if any. */
export async function openTradeOf(db: Executor, characterId: string): Promise<Trade | null> {
  const found = await db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.status, 'open'),
        or(eq(trades.initiatorId, characterId), eq(trades.partnerId, characterId)),
      ),
    )
    .limit(1);
  return found[0] ?? null;
}

/**
 * Start a trade with somebody.
 *
 * One open trade per person. Two at once would let somebody offer the same
 * item to two people and complete whichever went through first, which is
 * confusing at best and a way to waste people's time at worst.
 */
export async function startTrade(
  db: Database,
  meId: string,
  themId: string,
): Promise<TradeResult<Trade>> {
  if (meId === themId) return { ok: false, reason: 'not-yourself' };

  return db.transaction(async (tx) => {
    // Lock both people, in a fixed order, so two invitations crossing in the
    // post cannot both create a trade.
    for (const id of [meId, themId].sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`trade:${id}`}))`);
    }

    for (const id of [meId, themId]) {
      if ((await openTradeOf(tx, id)) !== null) {
        return { ok: false as const, reason: 'already-trading' as const };
      }
    }

    const written = await tx
      .insert(trades)
      .values({ initiatorId: meId, partnerId: themId })
      .returning();

    const trade = written[0];
    if (trade === undefined) throw new Error('The trade was not written.');
    return { ok: true as const, data: trade };
  });
}

/** Find a trade and check the person asking is in it and it is still open. */
async function openTradeFor(
  tx: Executor,
  tradeId: string,
  characterId: string,
): Promise<TradeResult<Trade>> {
  const found = await tx.select().from(trades).where(eq(trades.id, tradeId)).limit(1).for('update');
  const trade = found[0];
  if (trade === undefined) return { ok: false, reason: 'no-such-trade' };
  if (sideOf(trade, characterId) === null) return { ok: false, reason: 'not-your-trade' };
  if (trade.status !== 'open') return { ok: false, reason: 'trade-is-over' };
  return { ok: true, data: trade };
}

/**
 * Any change to what is on the table takes both confirmations away.
 *
 * This is the single most important line in the file. It is what stops
 * somebody confirming a trade and then changing what they are giving.
 */
async function unconfirmBoth(tx: Executor, tradeId: string): Promise<void> {
  await tx
    .update(trades)
    .set({ initiatorConfirmed: false, partnerConfirmed: false, updatedAt: new Date() })
    .where(eq(trades.id, tradeId));
}

/** Put one of your things on the table. */
export async function offerItem(
  db: Database,
  tradeId: string,
  characterId: string,
  itemId: string,
): Promise<TradeResult<Trade>> {
  return db.transaction(async (tx) => {
    const found = await openTradeFor(tx, tradeId, characterId);
    if (!found.ok) return found;

    const alreadyOffered = await tx
      .select({ id: tradeItems.id })
      .from(tradeItems)
      .where(and(eq(tradeItems.tradeId, tradeId), eq(tradeItems.offeredBy, characterId)));
    if (alreadyOffered.length >= MAX_ITEMS_PER_SIDE) {
      return { ok: false as const, reason: 'too-many-items' as const };
    }

    // The move carries the check: if this item is not in their hands, nothing
    // is updated and the offer is refused. There is no separate "do they own
    // it?" query that could go stale between asking and moving.
    const moved = await moveItem(
      tx,
      itemId,
      { kind: 'character', id: characterId },
      { kind: 'escrow', id: tradeId },
    );
    if (!moved) return { ok: false as const, reason: 'not-your-item' as const };

    await tx.insert(tradeItems).values({ tradeId, itemId, offeredBy: characterId });
    await unconfirmBoth(tx, tradeId);

    return { ok: true as const, data: found.data };
  });
}

/** Take one of your things back off the table. */
export async function withdrawItem(
  db: Database,
  tradeId: string,
  characterId: string,
  itemId: string,
): Promise<TradeResult<Trade>> {
  return db.transaction(async (tx) => {
    const found = await openTradeFor(tx, tradeId, characterId);
    if (!found.ok) return found;

    const removed = await tx
      .delete(tradeItems)
      .where(
        and(
          eq(tradeItems.tradeId, tradeId),
          eq(tradeItems.itemId, itemId),
          eq(tradeItems.offeredBy, characterId),
        ),
      )
      .returning({ id: tradeItems.id });

    if (removed.length === 0) return { ok: false as const, reason: 'not-your-item' as const };

    await moveItem(
      tx,
      itemId,
      { kind: 'escrow', id: tradeId },
      { kind: 'character', id: characterId },
    );
    await unconfirmBoth(tx, tradeId);

    return { ok: true as const, data: found.data };
  });
}

/**
 * Say how much money you are putting on the table.
 *
 * The amount is the total, not a change: asking for 5 when 3 is already on the
 * table moves 2 more. That means a browser that sends the same request twice
 * cannot stack up money by accident.
 */
export async function offerMoney(
  db: Database,
  tradeId: string,
  characterId: string,
  total: Money,
): Promise<TradeResult<Trade>> {
  if (total < 0n) return { ok: false, reason: 'not-enough-money' };

  return db.transaction(async (tx) => {
    const found = await openTradeFor(tx, tradeId, characterId);
    if (!found.ok) return found;

    const trade = found.data;
    const side = sideOf(trade, characterId);
    const already = side === 'initiator' ? trade.initiatorMoney : trade.partnerMoney;
    const difference = total - already;

    if (difference > 0n) {
      const moved = await moveWithin(tx, {
        from: playerAccount(characterId),
        to: tradeEscrow(tradeId),
        amount: difference,
        reason: `put ${formatAmount(difference)} on the table`,
        idempotencyKey: `trade:${tradeId}:${characterId}:to:${total.toString()}`,
      });
      if (!moved.ok) return { ok: false as const, reason: 'not-enough-money' as const };
    } else if (difference < 0n) {
      const moved = await moveWithin(tx, {
        from: tradeEscrow(tradeId),
        to: playerAccount(characterId),
        amount: -difference,
        reason: `took ${formatAmount(-difference)} back off the table`,
        idempotencyKey: `trade:${tradeId}:${characterId}:to:${total.toString()}`,
      });
      if (!moved.ok) return { ok: false as const, reason: 'not-enough-money' as const };
    }

    await tx
      .update(trades)
      .set({
        ...(side === 'initiator' ? { initiatorMoney: total } : { partnerMoney: total }),
        initiatorConfirmed: false,
        partnerConfirmed: false,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    return { ok: true as const, data: trade };
  });
}

/**
 * "I am happy with this."
 *
 * When both sides have said it, the swap happens here and now, in the same
 * transaction as the second confirmation — so there is no moment in which
 * both have agreed and nothing has happened.
 */
export async function confirm(
  db: Database,
  tradeId: string,
  characterId: string,
): Promise<TradeResult<{ trade: Trade; completed: boolean }>> {
  return db.transaction(async (tx) => {
    const found = await openTradeFor(tx, tradeId, characterId);
    if (!found.ok) return found;

    const trade = found.data;
    const side = sideOf(trade, characterId);
    const bothConfirmed = side === 'initiator' ? trade.partnerConfirmed : trade.initiatorConfirmed;

    await tx
      .update(trades)
      .set({
        ...(side === 'initiator' ? { initiatorConfirmed: true } : { partnerConfirmed: true }),
        updatedAt: new Date(),
      })
      .where(eq(trades.id, tradeId));

    if (!bothConfirmed) {
      return { ok: true as const, data: { trade, completed: false } };
    }

    await settle(tx, trade);
    return { ok: true as const, data: { trade, completed: true } };
  });
}

/**
 * Carry out the swap.
 *
 * Everything in here is inside one transaction that the caller opened. If any
 * single step throws, the whole thing is undone and both people still have
 * exactly what they started with.
 */
async function settle(tx: Executor, trade: Trade): Promise<void> {
  const offered = await tx.select().from(tradeItems).where(eq(tradeItems.tradeId, trade.id));

  for (const row of offered) {
    const receiver = row.offeredBy === trade.initiatorId ? trade.partnerId : trade.initiatorId;
    const moved = await moveItem(
      tx,
      row.itemId,
      { kind: 'escrow', id: trade.id },
      { kind: 'character', id: receiver },
    );
    // The item was put here by this trade and locked since. If it is not here,
    // something is badly wrong and the whole swap must be undone.
    if (!moved)
      throw new Error(`Item ${row.itemId} was not in the trade it was supposed to be in.`);
  }

  if (trade.initiatorMoney > 0n) {
    const paid = await moveWithin(tx, {
      from: tradeEscrow(trade.id),
      to: playerAccount(trade.partnerId),
      amount: trade.initiatorMoney,
      reason: 'a trade',
      idempotencyKey: `trade:${trade.id}:settle:initiator`,
    });
    if (!paid.ok) throw new Error(`The escrow could not pay out: ${paid.reason}`);
  }

  if (trade.partnerMoney > 0n) {
    const paid = await moveWithin(tx, {
      from: tradeEscrow(trade.id),
      to: playerAccount(trade.initiatorId),
      amount: trade.partnerMoney,
      reason: 'a trade',
      idempotencyKey: `trade:${trade.id}:settle:partner`,
    });
    if (!paid.ok) throw new Error(`The escrow could not pay out: ${paid.reason}`);
  }

  await tx
    .update(trades)
    .set({ status: 'completed', finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(trades.id, trade.id));
}

/**
 * Call the whole thing off, and give everything back.
 *
 * Also used when somebody logs out with a trade open: walking away must never
 * cost anybody anything.
 */
export async function cancel(
  db: Database,
  tradeId: string,
  characterId: string | null,
): Promise<TradeResult<Trade>> {
  return db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .limit(1)
      .for('update');

    const trade = found[0];
    if (trade === undefined) return { ok: false as const, reason: 'no-such-trade' as const };
    if (characterId !== null && sideOf(trade, characterId) === null) {
      return { ok: false as const, reason: 'not-your-trade' as const };
    }
    if (trade.status !== 'open') return { ok: false as const, reason: 'trade-is-over' as const };

    await returnEverything(tx, trade);

    await tx
      .update(trades)
      .set({ status: 'cancelled', finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(trades.id, trade.id));

    return { ok: true as const, data: trade };
  });
}

/** Give every item and every Crown back to whoever put it on the table. */
async function returnEverything(tx: Executor, trade: Trade): Promise<void> {
  const offered = await tx.select().from(tradeItems).where(eq(tradeItems.tradeId, trade.id));
  for (const row of offered) {
    await moveItem(
      tx,
      row.itemId,
      { kind: 'escrow', id: trade.id },
      { kind: 'character', id: row.offeredBy },
    );
  }

  for (const [who, amount] of [
    [trade.initiatorId, trade.initiatorMoney],
    [trade.partnerId, trade.partnerMoney],
  ] as const) {
    if (amount <= 0n) continue;
    const refunded = await moveWithin(tx, {
      from: tradeEscrow(trade.id),
      to: playerAccount(who),
      amount,
      reason: 'a trade that did not happen',
      idempotencyKey: `trade:${trade.id}:refund:${who}`,
    });
    if (!refunded.ok) throw new Error(`The escrow could not be returned: ${refunded.reason}`);
  }
}

/** Everything a player needs to draw the trade window. */
export interface TradeView {
  readonly id: string;
  readonly them: { id: string; name: string };
  readonly yourItems: Array<{ id: string; name: string }>;
  readonly theirItems: Array<{ id: string; name: string }>;
  readonly yourMoney: string;
  readonly theirMoney: string;
  readonly yourMoneyDisplay: string;
  readonly theirMoneyDisplay: string;
  readonly youConfirmed: boolean;
  readonly theyConfirmed: boolean;
  readonly status: string;
  readonly purse: string;
}

/** The trade as one of the two people sees it. */
export async function viewOf(
  db: Executor,
  trade: Trade,
  characterId: string,
): Promise<TradeView | null> {
  const side = sideOf(trade, characterId);
  if (side === null) return null;

  const themId = side === 'initiator' ? trade.partnerId : trade.initiatorId;

  const rows = await db
    .select({
      itemId: tradeItems.itemId,
      offeredBy: tradeItems.offeredBy,
      definitionId: itemInstances.definitionId,
    })
    .from(tradeItems)
    .innerJoin(itemInstances, eq(itemInstances.id, tradeItems.itemId))
    .where(eq(tradeItems.tradeId, trade.id));

  const names = await namesFor(db, [themId]);
  const definitions = await definitionNames(
    db,
    rows.map((row) => row.definitionId),
  );

  const yourMoney = side === 'initiator' ? trade.initiatorMoney : trade.partnerMoney;
  const theirMoney = side === 'initiator' ? trade.partnerMoney : trade.initiatorMoney;

  return {
    id: trade.id,
    them: { id: themId, name: names.get(themId) ?? 'Somebody' },
    yourItems: rows
      .filter((row) => row.offeredBy === characterId)
      .map((row) => ({
        id: row.itemId,
        name: definitions.get(row.definitionId) ?? row.definitionId,
      })),
    theirItems: rows
      .filter((row) => row.offeredBy !== characterId)
      .map((row) => ({
        id: row.itemId,
        name: definitions.get(row.definitionId) ?? row.definitionId,
      })),
    yourMoney: yourMoney.toString(),
    theirMoney: theirMoney.toString(),
    yourMoneyDisplay: formatAmount(yourMoney),
    theirMoneyDisplay: formatAmount(theirMoney),
    youConfirmed: side === 'initiator' ? trade.initiatorConfirmed : trade.partnerConfirmed,
    theyConfirmed: side === 'initiator' ? trade.partnerConfirmed : trade.initiatorConfirmed,
    status: trade.status,
    purse: formatAmount(await purseOf(db, characterId)),
  };
}

async function namesFor(db: Executor, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM characters WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function definitionNames(db: Executor, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM item_definitions WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Everything not used above, exported so the routes can name a trade's parts. */
export { sideOf };

/** The ids of items a trade is holding, for tests. */
export async function itemsInTrade(db: Executor, tradeId: string): Promise<string[]> {
  const rows = await db
    .select({ id: itemInstances.id })
    .from(itemInstances)
    .where(and(eq(itemInstances.holderKind, 'escrow'), eq(itemInstances.holderId, tradeId)));
  return rows.map((row) => row.id);
}

/** Used when a trade's items must be checked against a list. */
export async function itemsOwnedBy(db: Executor, characterId: string): Promise<string[]> {
  const rows = await db
    .select({ id: itemInstances.id })
    .from(itemInstances)
    .where(and(eq(itemInstances.holderKind, 'character'), eq(itemInstances.holderId, characterId)));
  return rows.map((row) => row.id);
}

/** Cancel every open trade somebody is in. Called when they leave. */
export async function cancelTradesOf(db: Database, characterId: string): Promise<void> {
  const open = await db
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        eq(trades.status, 'open'),
        or(eq(trades.initiatorId, characterId), eq(trades.partnerId, characterId)),
      ),
    );

  for (const row of open) {
    await cancel(db, row.id, null);
  }
}

/** Used by the tests to look at a trade directly. */
export async function tradeById(db: Executor, tradeId: string): Promise<Trade | null> {
  const found = await db.select().from(trades).where(eq(trades.id, tradeId)).limit(1);
  return found[0] ?? null;
}

/** Items on the table, by trade, for the tests. */
export async function offeredItemIds(db: Executor, tradeId: string): Promise<string[]> {
  const rows = await db
    .select({ itemId: tradeItems.itemId })
    .from(tradeItems)
    .where(eq(tradeItems.tradeId, tradeId));
  return rows.map((row) => row.itemId);
}

/** True when these item ids are all held by this character. */
export async function allHeldBy(
  db: Executor,
  characterId: string,
  itemIds: readonly string[],
): Promise<boolean> {
  if (itemIds.length === 0) return true;
  const rows = await db
    .select({ id: itemInstances.id })
    .from(itemInstances)
    .where(
      and(
        inArray(itemInstances.id, [...itemIds]),
        eq(itemInstances.holderKind, 'character'),
        eq(itemInstances.holderId, characterId),
      ),
    );
  return rows.length === itemIds.length;
}
