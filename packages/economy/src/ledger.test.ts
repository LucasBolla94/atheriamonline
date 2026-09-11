import { describe, expect, it } from 'vitest';
import { crowns } from './money.js';
import {
  MINT,
  SINK,
  balanceOf,
  checkMovement,
  isBalanced,
  playerAccount,
  rowsFor,
  sum,
  tradeEscrow,
  type LedgerRow,
  type Movement,
} from './ledger.js';

function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    from: MINT,
    to: playerAccount('aldric'),
    amount: crowns(10),
    reason: 'daily reward',
    idempotencyKey: 'key-1',
    ...overrides,
  };
}

describe('the rows a movement produces', () => {
  it('makes exactly two, which sum to zero', () => {
    const rows = rowsFor(movement());
    expect(rows).toHaveLength(2);
    expect(sum(rows)).toBe(0n);
  });

  it('takes from one account and gives to the other', () => {
    const [debit, credit] = rowsFor(movement());
    expect(debit.account).toBe(MINT);
    expect(debit.amount).toBe(-crowns(10));
    expect(credit.account).toBe('player:aldric');
    expect(credit.amount).toBe(crowns(10));
  });
});

describe('movements we refuse to write down', () => {
  it('accepts an ordinary one', () => {
    expect(checkMovement(movement())).toEqual({ ok: true });
  });

  it('refuses nothing, and refuses a negative amount', () => {
    expect(checkMovement(movement({ amount: 0n }))).toEqual({
      ok: false,
      reason: 'amount-not-positive',
    });
    expect(checkMovement(movement({ amount: -1n }))).toEqual({
      ok: false,
      reason: 'amount-not-positive',
    });
  });

  it('refuses an amount nobody could have', () => {
    expect(checkMovement(movement({ amount: crowns(999_999_999_999) }))).toEqual({
      ok: false,
      reason: 'amount-too-large',
    });
  });

  it('refuses a movement from an account to itself', () => {
    const self = playerAccount('aldric');
    expect(checkMovement(movement({ from: self, to: self }))).toEqual({
      ok: false,
      reason: 'same-account',
    });
  });

  it('refuses a movement with no reason and no key', () => {
    expect(checkMovement(movement({ reason: '  ' })).ok).toBe(false);
    expect(checkMovement(movement({ idempotencyKey: '' })).ok).toBe(false);
  });
});

describe('the books', () => {
  /** Every movement in one imaginary evening in the city. */
  const evening: LedgerRow[] = [
    ...rowsFor(movement({ to: playerAccount('aldric'), amount: crowns(100) })),
    ...rowsFor(movement({ to: playerAccount('bryn'), amount: crowns(100) })),
    ...rowsFor({
      from: playerAccount('aldric'),
      to: playerAccount('bryn'),
      amount: crowns(25),
      reason: 'bought a stool',
      idempotencyKey: 'key-2',
    }),
    ...rowsFor({
      from: playerAccount('bryn'),
      to: SINK,
      amount: crowns(1),
      reason: 'market fee',
      idempotencyKey: 'key-3',
    }),
  ];

  it('always sum to zero, however much has happened', () => {
    expect(isBalanced(evening)).toBe(true);
  });

  it('give each player the balance you would work out by hand', () => {
    expect(balanceOf(evening, playerAccount('aldric'))).toBe(crowns(75));
    expect(balanceOf(evening, playerAccount('bryn'))).toBe(crowns(124));
  });

  it('leave the mint as far negative as there is money in the world', () => {
    expect(balanceOf(evening, MINT)).toBe(-crowns(200));
  });

  it('notice a row that lost its pair', () => {
    expect(isBalanced(evening.slice(0, -1))).toBe(false);
  });

  it('name an escrow after its trade, so two trades cannot share one', () => {
    expect(tradeEscrow('t1')).not.toBe(tradeEscrow('t2'));
    expect(balanceOf(evening, tradeEscrow('t1'))).toBe(0n);
  });
});
