import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT,
  MINOR_UNITS_PER_CROWN,
  crowns,
  formatAmount,
  isMovableAmount,
  parseAmount,
} from './money.js';

describe('reading an amount somebody typed', () => {
  it('reads whole Crowns', () => {
    expect(parseAmount('12')).toBe(1200n);
    expect(parseAmount('0')).toBe(0n);
  });

  it('reads parts of a Crown exactly', () => {
    // The reason this package exists: 0.07 is seven minor units, not "about
    // seven". A float would make this 6.999999999999999.
    expect(parseAmount('0.07')).toBe(7n);
    expect(parseAmount('0.1')).toBe(10n);
    expect(parseAmount('12.34')).toBe(1234n);
  });

  it('reads a negative amount', () => {
    expect(parseAmount('-5.25')).toBe(-525n);
  });

  it('refuses more decimal places than a Crown has', () => {
    expect(parseAmount('1.234')).toBeNull();
  });

  it('refuses anything that is not an amount', () => {
    for (const input of ['', ' ', 'ten', '1e3', '1,5', '0x10', '1.', '.5', '1 2']) {
      expect(parseAmount(input), input).toBeNull();
    }
  });

  it('ignores spaces around the number', () => {
    expect(parseAmount('  3.50  ')).toBe(350n);
  });

  it('reads an amount far beyond what a number can hold exactly', () => {
    const huge = '99999999999999999999';
    expect(parseAmount(huge)).toBe(BigInt(huge) * MINOR_UNITS_PER_CROWN);
  });
});

describe('showing an amount to a player', () => {
  it('always shows two decimal places', () => {
    expect(formatAmount(0n)).toBe('0.00 c');
    expect(formatAmount(5n)).toBe('0.05 c');
    expect(formatAmount(50n)).toBe('0.50 c');
    expect(formatAmount(1234n)).toBe('12.34 c');
  });

  it('shows a negative amount with the sign in front', () => {
    expect(formatAmount(-525n)).toBe('-5.25 c');
    expect(formatAmount(-5n)).toBe('-0.05 c');
  });

  it('round-trips whatever a person types', () => {
    for (const input of ['0', '0.05', '1', '1.5', '12.34', '1000']) {
      const parsed = parseAmount(input);
      expect(parsed).not.toBeNull();
      expect(parseAmount(formatAmount(parsed ?? 0n).replace(' c', ''))).toBe(parsed);
    }
  });
});

describe('amounts that may be moved', () => {
  it('accepts an ordinary amount', () => {
    expect(isMovableAmount(crowns(5))).toBe(true);
  });

  it('refuses nothing, and refuses a negative amount', () => {
    expect(isMovableAmount(0n)).toBe(false);
    expect(isMovableAmount(-1n)).toBe(false);
  });

  it('refuses an amount nobody could have', () => {
    expect(isMovableAmount(MAX_AMOUNT)).toBe(true);
    expect(isMovableAmount(MAX_AMOUNT + 1n)).toBe(false);
  });
});
