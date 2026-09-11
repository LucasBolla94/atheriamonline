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

/** What a moderator did. Every one of these is written to the audit log. */
export const moderationAction = pgEnum('moderation_action', [
  'warn',
  'mute',
  'unmute',
  'kick',
  'ban',
  'unban',
  'dismiss-report',
]);

/** Where a report has got to. */
export const reportStatus = pgEnum('report_status', ['open', 'actioned', 'dismissed']);

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
    /**
     * When a mute runs out. Null means this account is not muted.
     *
     * It lives on the account rather than on the character so that a mute
     * cannot be escaped by making a new character later.
     */
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
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

/**
 * "I do not want to hear from this person."
 *
 * Blocking is personal and one-way: it hides somebody from you, and tells them
 * nothing. Both sides are characters rather than accounts, because a player
 * blocks the person they met in the city, not a login they never see.
 */
export const blocks = pgTable(
  'blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Blocking twice is the same as blocking once, and the database is what
    // makes that true even when two tabs ask at the same moment.
    uniqueIndex('blocks_pair_key').on(table.blockerId, table.blockedId),
    index('blocks_blocker_idx').on(table.blockerId),
  ],
);

/**
 * "This person did something wrong."
 *
 * A report is kept whatever a moderator decides, so that a pattern across many
 * reports is still visible after each one was dealt with.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    reportedId: uuid('reported_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    status: reportStatus('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid('reviewed_by').references(() => accounts.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    index('reports_status_idx').on(table.status, table.createdAt),
    index('reports_reported_idx').on(table.reportedId),
  ],
);

/**
 * Everything a moderator has ever done, and why.
 *
 * Rows are only ever added. A moderation system nobody can audit is a
 * moderation system nobody should trust, including the moderators themselves.
 */
export const moderationLog = pgTable(
  'moderation_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The moderator. Kept even if their account is later deleted. */
    moderatorId: uuid('moderator_id').references(() => accounts.id, { onDelete: 'set null' }),
    targetAccountId: uuid('target_account_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    /** The character the moderator was actually looking at, when there was one. */
    targetCharacterId: uuid('target_character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    action: moderationAction('action').notNull(),
    reason: text('reason').notNull(),
    /** When a mute or a ban runs out, when it is not permanent. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('moderation_log_created_idx').on(table.createdAt),
    index('moderation_log_target_idx').on(table.targetAccountId),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type Block = typeof blocks.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ModerationEntry = typeof moderationLog.$inferSelect;
export type NewModerationEntry = typeof moderationLog.$inferInsert;
