/**
 * Money, in the database.
 *
 * `@atheriam/economy` decides what a movement of money *is*; this file writes
 * it down. The rules from `docs/SPEC.md` section 3.3 that show up here as
 * code:
 *
 *  - one database transaction per operation, always;
 *  - every operation carries an idempotency key, and repeating it moves money
 *    once;
 *  - a balance is the sum of ledger rows, never a column somebody edited;
 *  - no floating point anywhere near an amount.
 *
 * Two players spending the same Crown at the same moment is the thing this
 * file exists to make impossible. It takes an advisory lock on each account
 * involved, in a fixed order, so that a balance read inside a transaction
 * cannot go stale before the write.
 */
import { and, eq, sql } from 'drizzle-orm';
import { ledgerEntries, transfers, type Database } from '@atheriam/db';
import {
  checkMovement,
  playerAccount,
  rowsFor,
  type LedgerAccount,
  type Money,
  type Movement,
  type MovementProblem,
} from '@atheriam/economy';

export type TransferFailure = MovementProblem | 'not-enough-money';

export type TransferResult =
  { ok: true; transferId: string; alreadyDone: boolean } | { ok: false; reason: TransferFailure };

/** Any database handle: the pool, or a transaction already in progress. */
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Take a lock on an account for the rest of this transaction.
 *
 * PostgreSQL advisory locks are held until the transaction ends and cost no
 * table. Locking by name means two transfers involving the same purse queue
 * up, which is exactly what stops the same Crown being spent twice.
 */
async function lockAccounts(tx: Executor, accounts: readonly LedgerAccount[]): Promise<void> {
  // Always in the same order. Two transfers touching the same pair of accounts
  // from opposite directions would otherwise deadlock.
  for (const account of [...accounts].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${account}))`);
  }
}

/** What an account holds, worked out from the ledger. */
export async function balanceOf(db: Executor, account: LedgerAccount): Promise<Money> {
  const rows = await db
    .select({ total: sql<string>`COALESCE(SUM(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.account, account));
  return BigInt(rows[0]?.total ?? '0');
}

/** What a player holds. */
export async function purseOf(db: Executor, characterId: string): Promise<Money> {
  return balanceOf(db, playerAccount(characterId));
}

/**
 * Move money, once.
 *
 * The same idempotency key twice moves money once and reports the original
 * result. That is not a nicety: a player whose connection drops between asking
 * and being answered has no other safe way to ask again.
 *
 * A player may not go below zero. The mint may: how far negative it is *is*
 * how much money exists in the world.
 */
export async function move(db: Database, movement: Movement): Promise<TransferResult> {
  const check = checkMovement(movement);
  if (!check.ok) return { ok: false, reason: check.reason };
  return db.transaction((tx) => moveWithin(tx, movement));
}

/**
 * The same, inside a transaction somebody else opened.
 *
 * A trade moves money and items together and must be all or nothing, so it
 * opens one transaction and calls this. `move` above is the same operation for
 * callers who have nothing else to do.
 */
export async function moveWithin(tx: Executor, movement: Movement): Promise<TransferResult> {
  const check = checkMovement(movement);
  if (!check.ok) return { ok: false, reason: check.reason };

  return (async () => {
    // Has this exact request already been done? Asking first, inside the
    // transaction, means the answer cannot change under us.
    const existing = await tx
      .select({ id: transfers.id })
      .from(transfers)
      .where(eq(transfers.idempotencyKey, movement.idempotencyKey))
      .limit(1);

    const already = existing[0];
    if (already !== undefined) {
      return { ok: true as const, transferId: already.id, alreadyDone: true };
    }

    await lockAccounts(tx, [movement.from, movement.to]);

    // Only a player's purse has to stay above zero. `system:mint` going
    // negative is the point of it.
    if (movement.from.startsWith('player:') || movement.from.startsWith('escrow:')) {
      const available = await balanceOf(tx, movement.from);
      if (available < movement.amount) {
        return { ok: false as const, reason: 'not-enough-money' as const };
      }
    }

    const written = await tx
      .insert(transfers)
      .values({
        idempotencyKey: movement.idempotencyKey,
        fromAccount: movement.from,
        toAccount: movement.to,
        amount: movement.amount,
        reason: movement.reason,
      })
      .returning({ id: transfers.id });

    const transfer = written[0];
    if (transfer === undefined) throw new Error('The transfer was not written.');

    await tx.insert(ledgerEntries).values(
      rowsFor(movement).map((row) => ({
        transferId: transfer.id,
        account: row.account,
        amount: row.amount,
      })),
    );

    return { ok: true as const, transferId: transfer.id, alreadyDone: false };
  })();
}

/**
 * Are the books straight?
 *
 * Every row of the whole ledger, added together, must come to exactly zero.
 * If it does not, money has been created or destroyed outside the mint, which
 * is the most serious kind of bug this project can have.
 */
export async function ledgerSum(db: Executor): Promise<Money> {
  const rows = await db
    .select({ total: sql<string>`COALESCE(SUM(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries);
  return BigInt(rows[0]?.total ?? '0');
}

/** Every movement in or out of one purse, newest first. */
export async function historyOf(db: Executor, characterId: string, limit = 20) {
  const account = playerAccount(characterId);
  return db
    .select({
      amount: ledgerEntries.amount,
      reason: transfers.reason,
      at: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .innerJoin(transfers, eq(transfers.id, ledgerEntries.transferId))
    .where(and(eq(ledgerEntries.account, account)))
    .orderBy(sql`${ledgerEntries.createdAt} DESC`)
    .limit(limit);
}
