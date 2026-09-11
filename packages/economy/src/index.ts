/**
 * The economy package holds money, the double-entry ledger and idempotency.
 *
 * Rules from `docs/SPEC.md` that this package exists to enforce:
 *  - money is BIGINT minor units, never a floating point number;
 *  - every movement of money is two rows that sum to zero;
 *  - one database transaction per operation;
 *  - every operation carries an idempotency key.
 *
 * Filled in during Phase 5.
 */

/** How many minor units make one Crown. See D-005. */
export const MINOR_UNITS_PER_CROWN = 100n;

/** The name of the in-game currency, for display. */
export const CURRENCY_NAME = 'Crown';
