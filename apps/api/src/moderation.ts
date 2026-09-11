/**
 * Blocking, reporting, and what a moderator may do about it.
 *
 * This is the durable half of safety. The world server decides who hears whom
 * right now, in memory; this file writes down the decisions that must survive
 * a restart — who has blocked whom, who reported what, and every action a
 * moderator has ever taken.
 *
 * Two rules shape everything here:
 *
 *  - every moderator action is written to `moderation_log` in the same
 *    transaction as the change it describes. A mute that is not in the log did
 *    not happen, and a log entry without the mute would be a lie;
 *  - nothing here trusts a character id from a browser. A player names the
 *    person they mean, and this file looks them up.
 */
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  accounts,
  blocks,
  characters,
  moderationLog,
  reports,
  type Character,
  type Database,
} from '@atheriam/db';
import { normaliseName } from './accounts.js';

/** The longest a reason may be. Long enough to explain, short enough to read. */
export const MAX_REASON_LENGTH = 500;

/** The longest a mute or a ban may last: about a year. */
export const MAX_DURATION_MINUTES = 525_600;

export type ModerationFailure =
  'no-such-character' | 'not-yourself' | 'not-a-moderator' | 'no-such-report';

export type ModerationResult<T> = { ok: true; data: T } | { ok: false; reason: ModerationFailure };

/** Find a character by the name a player typed, however they capitalised it. */
export async function findCharacterByName(db: Database, name: string): Promise<Character | null> {
  const found = await db
    .select()
    .from(characters)
    .where(eq(characters.nameNormalised, normaliseName(name)))
    .limit(1);
  return found[0] ?? null;
}

/**
 * "I do not want to hear from this person."
 *
 * Blocking yourself is refused, because it would silently break your own chat
 * and look like a bug in the game rather than something you did.
 */
export async function blockByName(
  db: Database,
  blocker: Character,
  name: string,
): Promise<ModerationResult<{ blockedId: string }>> {
  const target = await findCharacterByName(db, name);
  if (target === null) return { ok: false, reason: 'no-such-character' };
  if (target.id === blocker.id) return { ok: false, reason: 'not-yourself' };

  // Blocking twice is the same as blocking once. The unique index is what
  // makes that true even when two tabs ask at the same moment.
  await db
    .insert(blocks)
    .values({ blockerId: blocker.id, blockedId: target.id })
    .onConflictDoNothing();

  return { ok: true, data: { blockedId: target.id } };
}

/** Undo a block. Removing one that was never there is not an error. */
export async function unblockByName(
  db: Database,
  blocker: Character,
  name: string,
): Promise<ModerationResult<{ blockedId: string }>> {
  const target = await findCharacterByName(db, name);
  if (target === null) return { ok: false, reason: 'no-such-character' };

  await db
    .delete(blocks)
    .where(and(eq(blocks.blockerId, blocker.id), eq(blocks.blockedId, target.id)));

  return { ok: true, data: { blockedId: target.id } };
}

/** Everyone this character has blocked, as ids the world server can use. */
export async function blockedIds(db: Database, blockerId: string): Promise<string[]> {
  const rows = await db
    .select({ blockedId: blocks.blockedId })
    .from(blocks)
    .where(eq(blocks.blockerId, blockerId));
  return rows.map((row) => row.blockedId);
}

/** The same list, but by name, so the player can see who they have blocked. */
export async function blockedNames(db: Database, blockerId: string): Promise<string[]> {
  const rows = await db
    .select({ name: characters.name })
    .from(blocks)
    .innerJoin(characters, eq(characters.id, blocks.blockedId))
    .where(eq(blocks.blockerId, blockerId));
  return rows.map((row) => row.name);
}

/**
 * Report somebody to the moderators.
 *
 * The report is kept whatever is decided about it, so that a pattern across
 * many reports is still visible long after each one was dealt with.
 */
export async function reportByName(
  db: Database,
  reporter: Character,
  name: string,
  reason: string,
): Promise<ModerationResult<{ reportId: string }>> {
  const target = await findCharacterByName(db, name);
  if (target === null) return { ok: false, reason: 'no-such-character' };
  if (target.id === reporter.id) return { ok: false, reason: 'not-yourself' };

  const inserted = await db
    .insert(reports)
    .values({
      reporterId: reporter.id,
      reportedId: target.id,
      reason: reason.slice(0, MAX_REASON_LENGTH),
    })
    .returning({ id: reports.id });

  const row = inserted[0];
  if (row === undefined) throw new Error('The report was not written.');
  return { ok: true, data: { reportId: row.id } };
}

/** What a moderator sees when they open the queue. */
export interface ReportView {
  readonly id: string;
  readonly reporter: string;
  readonly reported: string;
  readonly reason: string;
  readonly status: string;
  readonly createdAt: Date;
}

/**
 * The open reports, oldest first, because the oldest has waited longest.
 *
 * Both the reporter and the reported are characters, so the same table is
 * joined twice under two names.
 */
export async function openReports(db: Database, limit = 50): Promise<ReportView[]> {
  const reported = alias(characters, 'reported_character');
  const reporter = alias(characters, 'reporter_character');

  const rows = await db
    .select({
      id: reports.id,
      reason: reports.reason,
      status: reports.status,
      createdAt: reports.createdAt,
      reportedName: reported.name,
      reporterName: reporter.name,
    })
    .from(reports)
    .innerJoin(reported, eq(reported.id, reports.reportedId))
    .innerJoin(reporter, eq(reporter.id, reports.reporterId))
    .where(eq(reports.status, 'open'))
    .orderBy(reports.createdAt)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    reporter: row.reporterName,
    reported: row.reportedName,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
  }));
}

/** What a moderator asked for, once it has been checked. */
export interface ModerationCommand {
  readonly moderatorAccountId: string;
  readonly targetName: string;
  readonly reason: string;
  /** How long a mute or a ban lasts. Left out means "until it is lifted". */
  readonly minutes?: number | undefined;
  /** The report this answers, when it answers one. */
  readonly reportId?: string | undefined;
}

export interface ModerationOutcome {
  readonly characterId: string;
  readonly accountId: string;
  readonly name: string;
  /** When the mute or ban runs out, when it is not permanent. */
  readonly until: Date | null;
}

/**
 * Silence a player.
 *
 * The mute is stored on the account, not the character, so that making a new
 * character cannot be used to escape it. Both the change and the log entry are
 * written in one transaction: a punishment that is not in the audit log must
 * not be possible.
 */
export async function mutePlayer(
  db: Database,
  command: ModerationCommand,
): Promise<ModerationResult<ModerationOutcome>> {
  const target = await findCharacterByName(db, command.targetName);
  if (target === null) return { ok: false, reason: 'no-such-character' };

  const until = endOf(command.minutes);

  await db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ mutedUntil: until, updatedAt: new Date() })
      .where(eq(accounts.id, target.accountId));

    await tx.insert(moderationLog).values({
      moderatorId: command.moderatorAccountId,
      targetAccountId: target.accountId,
      targetCharacterId: target.id,
      action: 'mute',
      reason: command.reason.slice(0, MAX_REASON_LENGTH),
      expiresAt: until,
      reportId: command.reportId ?? null,
    });

    await markReportActioned(tx, command.reportId, command.moderatorAccountId);
  });

  return {
    ok: true,
    data: { characterId: target.id, accountId: target.accountId, name: target.name, until },
  };
}

/** Let somebody speak again. */
export async function unmutePlayer(
  db: Database,
  command: ModerationCommand,
): Promise<ModerationResult<ModerationOutcome>> {
  const target = await findCharacterByName(db, command.targetName);
  if (target === null) return { ok: false, reason: 'no-such-character' };

  await db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ mutedUntil: null, updatedAt: new Date() })
      .where(eq(accounts.id, target.accountId));

    await tx.insert(moderationLog).values({
      moderatorId: command.moderatorAccountId,
      targetAccountId: target.accountId,
      targetCharacterId: target.id,
      action: 'unmute',
      reason: command.reason.slice(0, MAX_REASON_LENGTH),
    });
  });

  return {
    ok: true,
    data: { characterId: target.id, accountId: target.accountId, name: target.name, until: null },
  };
}

/** Throw somebody out of the city. They may come straight back in. */
export async function kickPlayer(
  db: Database,
  command: ModerationCommand,
): Promise<ModerationResult<ModerationOutcome>> {
  const target = await findCharacterByName(db, command.targetName);
  if (target === null) return { ok: false, reason: 'no-such-character' };

  await db.transaction(async (tx) => {
    await tx.insert(moderationLog).values({
      moderatorId: command.moderatorAccountId,
      targetAccountId: target.accountId,
      targetCharacterId: target.id,
      action: 'kick',
      reason: command.reason.slice(0, MAX_REASON_LENGTH),
      reportId: command.reportId ?? null,
    });
    await markReportActioned(tx, command.reportId, command.moderatorAccountId);
  });

  return {
    ok: true,
    data: { characterId: target.id, accountId: target.accountId, name: target.name, until: null },
  };
}

/** Shut an account out of the game entirely. */
export async function banPlayer(
  db: Database,
  command: ModerationCommand,
): Promise<ModerationResult<ModerationOutcome>> {
  const target = await findCharacterByName(db, command.targetName);
  if (target === null) return { ok: false, reason: 'no-such-character' };

  const until = endOf(command.minutes);

  await db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ status: 'banned', updatedAt: new Date() })
      .where(eq(accounts.id, target.accountId));

    await tx.insert(moderationLog).values({
      moderatorId: command.moderatorAccountId,
      targetAccountId: target.accountId,
      targetCharacterId: target.id,
      action: 'ban',
      reason: command.reason.slice(0, MAX_REASON_LENGTH),
      expiresAt: until,
      reportId: command.reportId ?? null,
    });

    await markReportActioned(tx, command.reportId, command.moderatorAccountId);
  });

  return {
    ok: true,
    data: { characterId: target.id, accountId: target.accountId, name: target.name, until },
  };
}

/** Let a banned account back in. */
export async function unbanPlayer(
  db: Database,
  command: ModerationCommand,
): Promise<ModerationResult<ModerationOutcome>> {
  const target = await findCharacterByName(db, command.targetName);
  if (target === null) return { ok: false, reason: 'no-such-character' };

  await db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(accounts.id, target.accountId));

    await tx.insert(moderationLog).values({
      moderatorId: command.moderatorAccountId,
      targetAccountId: target.accountId,
      targetCharacterId: target.id,
      action: 'unban',
      reason: command.reason.slice(0, MAX_REASON_LENGTH),
    });
  });

  return {
    ok: true,
    data: { characterId: target.id, accountId: target.accountId, name: target.name, until: null },
  };
}

/** Decide a report needs nothing done. Still written down. */
export async function dismissReport(
  db: Database,
  moderatorAccountId: string,
  reportId: string,
  reason: string,
): Promise<ModerationResult<{ reportId: string }>> {
  const found = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  const report = found[0];
  if (report === undefined) return { ok: false, reason: 'no-such-report' };

  await db.transaction(async (tx) => {
    await tx
      .update(reports)
      .set({ status: 'dismissed', reviewedBy: moderatorAccountId, reviewedAt: new Date() })
      .where(eq(reports.id, reportId));

    await tx.insert(moderationLog).values({
      moderatorId: moderatorAccountId,
      targetCharacterId: report.reportedId,
      action: 'dismiss-report',
      reason: reason.slice(0, MAX_REASON_LENGTH),
      reportId,
    });
  });

  return { ok: true, data: { reportId } };
}

/** The audit log, newest first. Read-only, for moderators. */
export async function recentModerationLog(db: Database, limit = 50) {
  return db.select().from(moderationLog).orderBy(desc(moderationLog.createdAt)).limit(limit);
}

/**
 * Is this account muted right now?
 *
 * Returns the moment the mute runs out, or null. The world server asks this
 * when a player joins, so that a mute set while they were offline still holds.
 */
export async function mutedUntil(db: Database, accountId: string): Promise<Date | null> {
  const rows = await db
    .select({ mutedUntil: accounts.mutedUntil })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        or(isNull(accounts.mutedUntil), gt(accounts.mutedUntil, new Date())),
      ),
    )
    .limit(1);
  return rows[0]?.mutedUntil ?? null;
}

function endOf(minutes: number | undefined): Date | null {
  if (minutes === undefined) return null;
  const capped = Math.min(Math.max(1, Math.floor(minutes)), MAX_DURATION_MINUTES);
  return new Date(Date.now() + capped * 60_000);
}

/** Close the report an action was taken from, if it came from one. */
async function markReportActioned(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  reportId: string | undefined,
  moderatorAccountId: string,
): Promise<void> {
  if (reportId === undefined) return;
  await tx
    .update(reports)
    .set({ status: 'actioned', reviewedBy: moderatorAccountId, reviewedAt: new Date() })
    .where(eq(reports.id, reportId));
}
