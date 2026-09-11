/**
 * The shape of the database.
 *
 * Nothing outside this package writes SQL. Everything else asks this package,
 * so this file is the only place that knows what a table looks like.
 *
 * Two rules from `docs/SPEC.md` show up here as column types:
 *  - money is BIGINT in minor units, never a floating point number. There is
 *    no money table yet (Phase 5), but when there is, it will be `bigint`;
 *  - a player's position is written rarely, not per step, so `x` and `y` live
 *    on the character row and are updated on logout and by a slow job.
 */
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** What may be true of an account. */
export const accountStatus = pgEnum('account_status', ['active', 'suspended', 'banned']);

/** The eight directions, matching the game protocol. */
export const facingDirection = pgEnum('facing_direction', [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
]);

/**
 * A person's account.
 *
 * `emailNormalised` is the lower-cased email and carries the unique index, so
 * "Aldric@example.com" and "aldric@example.com" cannot both sign up. The
 * original spelling is kept in `email` because it is theirs to spell.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    emailNormalised: text('email_normalised').notNull(),
    /** An argon2id hash. Never a password, never reversible. See D-004. */
    passwordHash: text('password_hash').notNull(),
    /**
     * Stored so the 18+ rule can be checked again later, not only at sign-up.
     * A date, not a timestamp: a birthday has no time of day.
     */
    dateOfBirth: date('date_of_birth').notNull(),
    status: accountStatus('status').notNull().default('active'),
    isModerator: boolean('is_moderator').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('accounts_email_normalised_key').on(table.emailNormalised)],
);

/**
 * The person you are in the city. One per account, for now.
 *
 * `nameNormalised` carries the unique index for the same reason as the email:
 * two players must not be able to pick names that only differ by case.
 */
export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameNormalised: text('name_normalised').notNull(),
    /** The tile the character was standing on when last saved. */
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    facing: facingDirection('facing').notNull().default('s'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('characters_name_normalised_key').on(table.nameNormalised),
    // One character per account today. Dropping this index is how we would
    // allow more than one later, which is why it is named rather than implied.
    uniqueIndex('characters_account_id_key').on(table.accountId),
    index('characters_last_seen_at_idx').on(table.lastSeenAt),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
