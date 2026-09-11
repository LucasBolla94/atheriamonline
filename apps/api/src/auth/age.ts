/**
 * The 18+ rule.
 *
 * `docs/SPEC.md` section 8: the product is for adults, the date of birth is
 * recorded, and somebody under 18 cannot create an account.
 *
 * This file is pure arithmetic on dates so that the rule can be tested
 * exhaustively, including the awkward cases: a birthday today, a birthday
 * tomorrow, and someone born on 29 February.
 */

/** The age a person must have reached to hold an account. */
export const MINIMUM_AGE_YEARS = 18;

/** The oldest date of birth we will believe. Anything older is a typo. */
export const MAXIMUM_AGE_YEARS = 120;

export type AgeCheck =
  | { ok: true; age: number }
  | { ok: false; reason: 'not-a-date' | 'in-the-future' | 'too-old' | 'under-age' };

/**
 * Read a `YYYY-MM-DD` date of birth and say whether it belongs to an adult.
 *
 * The date is treated as a plain calendar date with no time zone, because a
 * birthday is a date and not a moment.
 */
export function checkAge(dateOfBirth: string, today: Date = new Date()): AgeCheck {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (match === null) return { ok: false, reason: 'not-a-date' };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // `Date.UTC` happily rolls 31 February over into March, so we check that the
  // date we get back is the date we asked for.
  const born = new Date(Date.UTC(year, month - 1, day));
  if (
    born.getUTCFullYear() !== year ||
    born.getUTCMonth() !== month - 1 ||
    born.getUTCDate() !== day
  ) {
    return { ok: false, reason: 'not-a-date' };
  }

  const age = yearsBetween(born, today);
  if (age < 0) return { ok: false, reason: 'in-the-future' };
  if (age > MAXIMUM_AGE_YEARS) return { ok: false, reason: 'too-old' };
  if (age < MINIMUM_AGE_YEARS) return { ok: false, reason: 'under-age' };
  return { ok: true, age };
}

/**
 * Whole years from `born` to `on`.
 *
 * Someone born on 29 February has their birthday on 1 March in a common year:
 * comparing month and day directly gives that for free, because 02-29 is
 * greater than 02-28 and the year simply has not reached 03-01 yet.
 */
export function yearsBetween(born: Date, on: Date): number {
  let age = on.getUTCFullYear() - born.getUTCFullYear();
  const monthDifference = on.getUTCMonth() - born.getUTCMonth();
  if (monthDifference < 0 || (monthDifference === 0 && on.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }
  return age;
}
