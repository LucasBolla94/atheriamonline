/**
 * Money.
 *
 * One rule shapes this whole file, and it comes from `docs/SPEC.md` section
 * 3.3: **there is no floating point anywhere in the economy**. An amount is a
 * `bigint` of minor units — the smallest indivisible piece of a Crown, the way
 * a cent is the smallest piece of a euro. A hundred minor units are one Crown.
 *
 * Floating point would not be wrong most of the time. It would be wrong
 * rarely, quietly, and in a way that adds up: 0.1 + 0.2 is not 0.3, and an
 * economy built on that slowly invents or loses money that nobody can account
 * for. `bigint` has no such surprises and no upper limit worth worrying about.
 */

/** How many minor units make one Crown. See D-005. */
export const MINOR_UNITS_PER_CROWN = 100n;

/** The name of the in-game currency, for display. */
export const CURRENCY_NAME = 'Crown';

/**
 * An amount of money, in minor units.
 *
 * It is a plain `bigint` rather than a class: the whole point is that it
 * behaves like a number, and a wrapper would only tempt somebody to unwrap it.
 * What stops mistakes is that there is nowhere in the codebase a `number` of
 * money can come from.
 */
export type Money = bigint;

export const ZERO: Money = 0n;

/** The largest amount we will accept in one operation: a hundred million Crowns. */
export const MAX_AMOUNT: Money = 10_000_000_000n;

/** Turn a whole number of Crowns into minor units. */
export function crowns(whole: number | bigint): Money {
  return BigInt(whole) * MINOR_UNITS_PER_CROWN;
}

/**
 * Read an amount a person typed, like `12`, `12.5` or `12.34`.
 *
 * Returns `null` for anything that is not an amount, including more decimal
 * places than a Crown has. Nothing here goes through `parseFloat`: the string
 * is split on the dot and both halves are read as whole numbers, so `0.07`
 * means seven minor units and not "about seven".
 */
export function parseAmount(input: string): Money | null {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = trimmed.replace('-', '').split('.');
  const minor = BigInt(whole) * MINOR_UNITS_PER_CROWN + BigInt(fraction.padEnd(2, '0'));
  return negative ? -minor : minor;
}

/**
 * Write an amount the way a player should see it: `12.34 c`.
 *
 * Always two decimal places, because money with a varying number of decimals
 * is money people misread.
 */
export function formatAmount(amount: Money): string {
  const negative = amount < ZERO;
  const absolute = negative ? -amount : amount;
  const whole = absolute / MINOR_UNITS_PER_CROWN;
  const fraction = absolute % MINOR_UNITS_PER_CROWN;
  return `${negative ? '-' : ''}${whole.toString()}.${fraction.toString().padStart(2, '0')} c`;
}

/** True when this is an amount somebody may move: positive and not absurd. */
export function isMovableAmount(amount: Money): boolean {
  return amount > ZERO && amount <= MAX_AMOUNT;
}
