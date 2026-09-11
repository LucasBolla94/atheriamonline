import { describe, expect, it } from 'vitest';
import { MINIMUM_AGE_YEARS, checkAge, yearsBetween } from './age.js';

/** A fixed "today" so these tests mean the same thing in ten years' time. */
const TODAY = new Date(Date.UTC(2026, 8, 11)); // 2026-09-11

describe('checkAge', () => {
  it('accepts somebody comfortably over 18', () => {
    const result = checkAge('1990-01-01', TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.age).toBe(36);
  });

  it('accepts somebody whose 18th birthday is today', () => {
    const result = checkAge('2008-09-11', TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.age).toBe(MINIMUM_AGE_YEARS);
  });

  it('refuses somebody whose 18th birthday is tomorrow', () => {
    const result = checkAge('2008-09-12', TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('under-age');
  });

  it('refuses a child', () => {
    const result = checkAge('2020-01-01', TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('under-age');
  });

  it('refuses a date in the future', () => {
    const result = checkAge('2030-01-01', TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('in-the-future');
  });

  it('refuses an impossible age', () => {
    const result = checkAge('1800-01-01', TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-old');
  });

  it('refuses anything that is not a date', () => {
    for (const value of ['', 'yesterday', '11/09/2008', '2008-9-11', '2008-09-11T00:00:00Z']) {
      const result = checkAge(value, TODAY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not-a-date');
    }
  });

  it('refuses a date that does not exist, rather than rolling it over', () => {
    // Without care, 31 February quietly becomes 3 March and the person gets an
    // account with a birthday they never had.
    for (const value of ['2008-02-31', '2008-13-01', '2008-00-10', '2007-02-29']) {
      const result = checkAge(value, TODAY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not-a-date');
    }
  });

  it('accepts 29 February in a leap year', () => {
    expect(checkAge('2008-02-29', TODAY).ok).toBe(true);
  });
});

describe('yearsBetween', () => {
  it('does not count a birthday that has not happened yet this year', () => {
    const born = new Date(Date.UTC(2000, 11, 31)); // 31 December
    const on = new Date(Date.UTC(2026, 0, 1)); // 1 January
    expect(yearsBetween(born, on)).toBe(25);
  });

  it('counts a birthday on the day itself', () => {
    const born = new Date(Date.UTC(2000, 5, 15));
    const on = new Date(Date.UTC(2026, 5, 15));
    expect(yearsBetween(born, on)).toBe(26);
  });

  it('treats a 29 February birthday as 1 March in a common year', () => {
    const born = new Date(Date.UTC(2008, 1, 29));
    // 2026 is not a leap year, so 28 February is still the day before.
    expect(yearsBetween(born, new Date(Date.UTC(2026, 1, 28)))).toBe(17);
    expect(yearsBetween(born, new Date(Date.UTC(2026, 2, 1)))).toBe(18);
  });
});
