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
import { sql } from 'drizzle-orm';
import {
  bigint,
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
    appearance: integer('appearance').notNull().default(0),
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

/**
 * One movement of money: where from, where to, how much, and why.
 *
 * The two ledger rows that carry it out point at this. It exists so that the
 * idempotency key has somewhere to be unique: asking twice with the same key
 * fails the second insert, which is what makes a repeated request safe rather
 * than a second payment.
 */
export const transfers = pgTable(
  'transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Send the same key twice and the money moves once. The unique index is
     * what enforces that — not code, which could race with itself.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    fromAccount: text('from_account').notNull(),
    toAccount: text('to_account').notNull(),
    /**
     * Minor units. BIGINT, never a floating point number: see `docs/SPEC.md`
     * section 3.3. Read back as a string by the driver and turned into a
     * bigint, so no amount ever passes through a `number`.
     */
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('transfers_idempotency_key').on(table.idempotencyKey)],
);

/**
 * The ledger itself. Rows are only ever added, never changed or deleted.
 *
 * A balance is the sum of an account's rows. Every row of the whole table,
 * added together, must come to exactly zero — that is what proves no money has
 * been invented or lost.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => transfers.id, { onDelete: 'restrict' }),
    /** `player:<characterId>`, `system:mint`, `system:sink`, `escrow:trade:<id>`. */
    account: text('account').notNull(),
    /** Negative takes money out, positive puts it in. */
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_entries_account_idx').on(table.account),
    index('ledger_entries_transfer_idx').on(table.transferId),
  ],
);

/** Who may come into a house. */
export const houseAccess = pgEnum('house_access', ['nobody', 'welcomed', 'everyone']);

/** Where a trade has got to. */
export const tradeStatus = pgEnum('trade_status', ['open', 'completed', 'cancelled']);

/** Where an item instance can be. Exactly one of these, at any moment. */
export const itemHolder = pgEnum('item_holder', ['character', 'house', 'escrow']);

/**
 * A kind of thing: "an oak stool", not a particular oak stool.
 *
 * The id is a readable name rather than a number, because it appears in code,
 * in tests and in bug reports, and `oak-stool` is easier to argue about than
 * `47`.
 */
export const itemDefinitions = pgTable('item_definitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** What it is for: furniture goes in a house, a trinket is carried. */
  kind: text('kind').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One real object, owned by exactly one holder.
 *
 * The rule from `docs/SPEC.md` section 3.4 — an item is in exactly one place —
 * is enforced by the shape of this table. There is one holder column pair, so
 * being in two places at once is not something the database can express.
 * Moving an item changes those two columns; nothing is ever copied.
 */
export const itemInstances = pgTable(
  'item_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => itemDefinitions.id, { onDelete: 'restrict' }),
    holderKind: itemHolder('holder_kind').notNull(),
    /** A character id, a house id, or a trade id, depending on the kind. */
    holderId: uuid('holder_id').notNull(),
    /** Where it stands, once it has been placed in a house. Phase 7. */
    x: integer('x'),
    y: integer('y'),
    rotation: integer('rotation').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('item_instances_holder_idx').on(table.holderKind, table.holderId),
    index('item_instances_definition_idx').on(table.definitionId),
  ],
);

/**
 * Two people swapping things.
 *
 * While a trade is open, everything in it has already left its owner: items
 * are held by the trade, and money sits in `escrow:trade:<id>` in the ledger.
 * That is what makes a swap safe — nobody can spend or give away what they
 * have already put on the table.
 *
 * Both sides must confirm, and any change to what is on the table takes both
 * confirmations away again. Without that rule, the oldest trick in the book
 * works: confirm, then swap the good item for a worthless one while the other
 * person is reaching for the button.
 */
export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    initiatorId: uuid('initiator_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    status: tradeStatus('status').notNull().default('open'),
    initiatorConfirmed: boolean('initiator_confirmed').notNull().default(false),
    partnerConfirmed: boolean('partner_confirmed').notNull().default(false),
    /**
     * Money already moved into escrow by each side, in minor units.
     *
     * The default is written as raw SQL rather than as `0n`: the migration
     * tool turns the schema into JSON to compare it, and JSON has no bigint.
     */
    initiatorMoney: bigint('initiator_money', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    partnerMoney: bigint('partner_money', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('trades_initiator_idx').on(table.initiatorId, table.status),
    index('trades_partner_idx').on(table.partnerId, table.status),
  ],
);

/**
 * What each side has put on the table.
 *
 * The item itself has already moved: its holder is the trade. This row only
 * remembers whose it was, so that cancelling gives everything back to the
 * right person.
 */
export const tradeItems = pgTable(
  'trade_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => itemInstances.id, { onDelete: 'cascade' }),
    offeredBy: uuid('offered_by')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One item cannot be on two tables at once. The item's own holder column
    // says the same thing; this says it again where it is cheapest to enforce.
    uniqueIndex('trade_items_item_key').on(table.itemId),
    index('trade_items_trade_idx').on(table.tradeId),
  ],
);

/**
 * A player's own four walls.
 *
 * One per character. The inside is a small fixed room; what makes it theirs is
 * what they put in it, which is item instances whose holder is this house.
 *
 * Access is deliberately three plain settings rather than a system of
 * permissions. "welcomed" is a list the owner keeps by hand — see
 * `house_guests` — because a two-way friendship system is a feature of its
 * own and this does not need one to be useful.
 */
export const houses = pgTable(
  'houses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    access: houseAccess('access').notNull().default('welcomed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('houses_owner_key').on(table.ownerId)],
);

/** People the owner has said may come in. */
export const houseGuests = pgTable(
  'house_guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    houseId: uuid('house_id')
      .notNull()
      .references(() => houses.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('house_guests_pair_key').on(table.houseId, table.characterId),
    index('house_guests_house_idx').on(table.houseId),
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
export type Transfer = typeof transfers.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type ItemDefinition = typeof itemDefinitions.$inferSelect;
export type ItemInstance = typeof itemInstances.$inferSelect;
export type House = typeof houses.$inferSelect;
export type HouseGuest = typeof houseGuests.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type TradeItem = typeof tradeItems.$inferSelect;

/** Cities have persistent identities; the first release opens one. */
export const cities = pgTable('cities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Each public or commercial address has exactly one durable record/interior. */
export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    buildingId: text('building_id').notNull(),
    municipal: boolean('municipal').notNull(),
    ownerId: uuid('owner_id').references(() => characters.id, { onDelete: 'restrict' }),
    price: bigint('price', { mode: 'bigint' }).notNull(),
    businessName: text('business_name').notNull(),
    description: text('description').notNull().default(''),
    access: houseAccess('access').notNull().default('nobody'),
    published: boolean('published').notNull().default(false),
    floorStyle: text('floor_style').notNull().default('oak'),
    wallStyle: text('wall_style').notNull().default('cream'),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('properties_address_key').on(table.cityId, table.buildingId),
    index('properties_owner_idx').on(table.ownerId),
  ],
);

/** Successful purchase receipts bind a retry key to the original buyer/address. */
export const propertyPurchases = pgTable(
  'property_purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'restrict' }),
    requestKey: text('request_key').notNull(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => transfers.id, { onDelete: 'restrict' }),
    price: bigint('price', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('property_purchases_request_key').on(table.buyerId, table.requestKey),
    uniqueIndex('property_purchases_property_key').on(table.propertyId),
  ],
);

export type Property = typeof properties.$inferSelect;

/** Guests welcomed into a commercial interior by its current owner. */
export const propertyGuests = pgTable(
  'property_guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('property_guests_pair_key').on(table.propertyId, table.characterId)],
);

export const listingStatus = pgEnum('listing_status', ['open', 'sold', 'cancelled']);

/** One real item held in sale escrow, with an immutable advertised price. */
export const shopListings = pgTable(
  'shop_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => itemInstances.id, { onDelete: 'restrict' }),
    price: bigint('price', { mode: 'bigint' }).notNull(),
    requestKey: text('request_key').notNull(),
    status: listingStatus('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('shop_listings_seller_request_key').on(table.sellerId, table.requestKey),
    uniqueIndex('shop_listings_open_item_key')
      .on(table.itemId)
      .where(sql`${table.status} = 'open'`),
    index('shop_listings_property_idx').on(table.propertyId, table.status),
  ],
);

/** Durable receipts make retries safe, even after the shop closes its doors. */
export const shopSales = pgTable(
  'shop_sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => shopListings.id, { onDelete: 'restrict' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'restrict' }),
    requestKey: text('request_key').notNull(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => transfers.id, { onDelete: 'restrict' }),
    price: bigint('price', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('shop_sales_listing_key').on(table.listingId),
    uniqueIndex('shop_sales_buyer_request_key').on(table.buyerId, table.requestKey),
  ],
);
