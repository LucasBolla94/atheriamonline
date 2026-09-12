import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { characters, loungeBookings, loungeInvitations, type Database } from '@atheriam/db';
import { LOUNGE_ROOMS } from '@atheriam/shared';
export type BookingFailure =
  | 'bad-request'
  | 'key-reused'
  | 'booking-limit'
  | 'room-unavailable'
  | 'not-host'
  | 'no-such-booking'
  | 'no-such-character'
  | 'booking-ended';
export type BookingResult<T> = { ok: true; data: T } | { ok: false; reason: BookingFailure };
function fail(reason: BookingFailure): BookingResult<never> {
  return { ok: false, reason };
}
export interface BookingInput {
  roomId: string;
  title: string;
  startsAt: Date | null;
  durationMinutes: number;
  requestKey: string;
}
export async function reserveRoom(
  db: Database,
  hostId: string,
  input: BookingInput,
  nowMs = Date.now(),
): Promise<BookingResult<{ id: string; alreadyDone: boolean }>> {
  const title = input.title.trim();
  if (
    !LOUNGE_ROOMS.some((room) => room.id === input.roomId) ||
    ![30, 60].includes(input.durationMinutes) ||
    !title ||
    title.length > 64 ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey) ||
    (input.startsAt !== null && !Number.isFinite(input.startsAt.getTime()))
  )
    return fail('bad-request');
  return db.transaction(async (tx) => {
    // Host serialization enforces the booking limit across different rooms too.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`booking-host:${hostId}`}))`);
    const previous = (
      await tx
        .select()
        .from(loungeBookings)
        .where(
          and(eq(loungeBookings.hostId, hostId), eq(loungeBookings.requestKey, input.requestKey)),
        )
    )[0];
    if (previous) {
      if (
        previous.roomId !== input.roomId ||
        previous.title !== title ||
        previous.endsAt.getTime() - previous.startsAt.getTime() !==
          input.durationMinutes * 60_000 ||
        (previous.requestedStart?.getTime() ?? null) !== (input.startsAt?.getTime() ?? null)
      )
        return fail('key-reused');
      return { ok: true, data: { id: previous.id, alreadyDone: true } };
    }
    const startsAt = input.startsAt ?? new Date(nowMs);
    if (startsAt.getTime() < nowMs || startsAt.getTime() > nowMs + 7 * 86400_000)
      return fail('bad-request');
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    const upcoming = await tx
      .select({ id: loungeBookings.id })
      .from(loungeBookings)
      .where(
        and(
          eq(loungeBookings.hostId, hostId),
          isNull(loungeBookings.cancelledAt),
          gt(loungeBookings.endsAt, new Date(nowMs)),
        ),
      );
    if (upcoming.length >= 2) return fail('booking-limit');
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`booking-room:${input.roomId}`}))`,
    );
    const overlap = await tx
      .select({ id: loungeBookings.id })
      .from(loungeBookings)
      .where(
        and(
          eq(loungeBookings.roomId, input.roomId),
          isNull(loungeBookings.cancelledAt),
          lt(loungeBookings.startsAt, endsAt),
          gt(loungeBookings.endsAt, startsAt),
        ),
      )
      .limit(1);
    if (overlap.length) return fail('room-unavailable');
    const booking = (
      await tx
        .insert(loungeBookings)
        .values({
          hostId,
          roomId: input.roomId,
          title,
          startsAt,
          endsAt,
          requestedStart: input.startsAt,
          requestKey: input.requestKey,
        })
        .returning()
    )[0]!;
    return { ok: true, data: { id: booking.id, alreadyDone: false } };
  });
}
export async function cancelBooking(
  db: Database,
  hostId: string,
  id: string,
  nowMs = Date.now(),
): Promise<BookingResult<{ cancelled: true }>> {
  return db.transaction(async (tx) => {
    const booking = (
      await tx.select().from(loungeBookings).where(eq(loungeBookings.id, id)).for('update')
    )[0];
    if (!booking) return fail('no-such-booking');
    if (booking.hostId !== hostId) return fail('not-host');
    await tx
      .update(loungeBookings)
      .set({ cancelledAt: booking.cancelledAt ?? new Date(nowMs) })
      .where(eq(loungeBookings.id, id));
    return { ok: true, data: { cancelled: true } };
  });
}
export async function inviteToBooking(
  db: Database,
  hostId: string,
  id: string,
  guestId: string,
  invited: boolean,
  nowMs = Date.now(),
): Promise<BookingResult<{ invited: boolean }>> {
  return db.transaction(async (tx) => {
    const booking = (
      await tx.select().from(loungeBookings).where(eq(loungeBookings.id, id)).for('update')
    )[0];
    if (!booking) return fail('no-such-booking');
    if (booking.hostId !== hostId) return fail('not-host');
    if (booking.cancelledAt || booking.endsAt.getTime() <= nowMs) return fail('booking-ended');
    if (
      !(
        await tx.select({ id: characters.id }).from(characters).where(eq(characters.id, guestId))
      )[0]
    )
      return fail('no-such-character');
    if (invited)
      await tx
        .insert(loungeInvitations)
        .values({ bookingId: id, characterId: guestId })
        .onConflictDoNothing();
    else
      await tx
        .delete(loungeInvitations)
        .where(
          and(eq(loungeInvitations.bookingId, id), eq(loungeInvitations.characterId, guestId)),
        );
    return { ok: true, data: { invited } };
  });
}
/** Public availability has no meeting titles, host identities or guest lists. */
export async function loungeSchedule(db: Database, viewerId: string, nowMs = Date.now()) {
  const active = and(
    isNull(loungeBookings.cancelledAt),
    gt(loungeBookings.endsAt, new Date(nowMs)),
    lt(loungeBookings.startsAt, new Date(nowMs + 8 * 86400_000)),
  );
  const occupied = await db
    .select({
      roomId: loungeBookings.roomId,
      startsAt: loungeBookings.startsAt,
      endsAt: loungeBookings.endsAt,
    })
    .from(loungeBookings)
    .where(active)
    .orderBy(loungeBookings.startsAt);
  const mine = await db
    .select({ booking: loungeBookings })
    .from(loungeBookings)
    .leftJoin(
      loungeInvitations,
      and(
        eq(loungeInvitations.bookingId, loungeBookings.id),
        eq(loungeInvitations.characterId, viewerId),
      ),
    )
    .where(
      and(
        active,
        or(eq(loungeBookings.hostId, viewerId), eq(loungeInvitations.characterId, viewerId)),
      ),
    )
    .orderBy(loungeBookings.startsAt);
  const bookings = await Promise.all(
    mine.map(async ({ booking }) => ({
      id: booking.id,
      roomId: booking.roomId,
      title: booking.title,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      yours: booking.hostId === viewerId,
      guests:
        booking.hostId === viewerId
          ? (
              await db
                .select({ name: characters.name })
                .from(loungeInvitations)
                .innerJoin(characters, eq(characters.id, loungeInvitations.characterId))
                .where(eq(loungeInvitations.bookingId, booking.id))
                .orderBy(characters.name)
            ).map((entry) => entry.name)
          : [],
    })),
  );
  return { rooms: LOUNGE_ROOMS, occupied, bookings, now: new Date(nowMs) };
}
