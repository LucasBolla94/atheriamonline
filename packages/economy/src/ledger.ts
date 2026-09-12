/**
 * The double-entry ledger.
 *
 * Every movement of money is **two rows that sum to zero**: one account loses
 * what another gains. Nothing is ever edited; rows are only added. A balance
 * is the sum of an account's rows, never a number somebody wrote down.
 *
 * That is more work than a `balance` column, and it buys one thing: the books
 * can be checked. If every row of the whole ledger sums to zero, no money has
 * been invented or lost, whatever bugs there have been. A balance column can
 * be wrong quietly forever.
 *
 * There is no database in this file. It decides what rows a movement produces;
 * writing them, in one transaction, is the caller's job.
 */
import { isMovableAmount, type Money } from './money.js';

/**
 * Where money can sit.
 *
 * These are ledger accounts, not player accounts. `system:mint` is where new
 * money comes from and goes permanently negative, which is correct: it is a
 * record of how much has been created. `system:sink` is where money goes to
 * be destroyed.
 */
export type LedgerAccount =
  `player:${string}` | `city:${string}` | 'system:mint' | 'system:sink' | `escrow:trade:${string}`;

export const MINT: LedgerAccount = 'system:mint';
export const SINK: LedgerAccount = 'system:sink';

export function playerAccount(characterId: string): LedgerAccount {
  return `player:${characterId}`;
}

export function tradeEscrow(tradeId: string): LedgerAccount {
  return `escrow:trade:${tradeId}`;
}

/** One row of the ledger. */
export interface LedgerRow {
  readonly account: LedgerAccount;
  /** Negative takes money out of the account, positive puts it in. */
  readonly amount: Money;
}

/** A movement of money: where from, where to, how much, and why. */
export interface Movement {
  readonly from: LedgerAccount;
  readonly to: LedgerAccount;
  readonly amount: Money;
  /** Why this happened, in words a moderator can read later. */
  readonly reason: string;
  /**
   * A string that makes repeating this request safe.
   *
   * Send the same key twice and the money moves once. Without this, a player
   * whose connection drops between asking and being answered has no safe way
   * to ask again.
   */
  readonly idempotencyKey: string;
}

export type MovementProblem =
  'amount-not-positive' | 'amount-too-large' | 'same-account' | 'no-reason' | 'no-idempotency-key';

export type MovementCheck = { ok: true } | { ok: false; reason: MovementProblem };

/** Is this a movement we are willing to write down? */
export function checkMovement(movement: Movement): MovementCheck {
  if (movement.amount <= 0n) return { ok: false, reason: 'amount-not-positive' };
  if (!isMovableAmount(movement.amount)) return { ok: false, reason: 'amount-too-large' };
  if (movement.from === movement.to) return { ok: false, reason: 'same-account' };
  if (movement.reason.trim().length === 0) return { ok: false, reason: 'no-reason' };
  if (movement.idempotencyKey.trim().length === 0) {
    return { ok: false, reason: 'no-idempotency-key' };
  }
  return { ok: true };
}

/**
 * The two rows a movement produces.
 *
 * They are returned together, and they must be written together. A single row
 * of a pair is a hole in the books.
 */
export function rowsFor(movement: Movement): readonly [LedgerRow, LedgerRow] {
  return [
    { account: movement.from, amount: -movement.amount },
    { account: movement.to, amount: movement.amount },
  ];
}

/** Add up rows. Used to work out a balance, and to check the books. */
export function sum(rows: readonly LedgerRow[]): Money {
  let total = 0n;
  for (const row of rows) total += row.amount;
  return total;
}

/**
 * Do these rows account for themselves?
 *
 * Every row in the ledger, added together, must come to exactly zero. If it
 * does not, money has been created or destroyed somewhere outside `MINT` and
 * `SINK`, and that is the most serious kind of bug this project can have.
 */
export function isBalanced(rows: readonly LedgerRow[]): boolean {
  return sum(rows) === 0n;
}

/** The balance of one account, from its rows. */
export function balanceOf(rows: readonly LedgerRow[], account: LedgerAccount): Money {
  return sum(rows.filter((row) => row.account === account));
}
