import { and, eq } from 'drizzle-orm';
import { LOUNGE_ROOMS } from '@atheriam/shared';
import { loungeBookings, loungeInvitations } from './schema.js';
import type { Database } from './client.js';
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
export interface BookingAdmission {
  bookingId: string;
  roomId: string;
  capacity: number;
  endsAt: number;
}
/** A time-limited admission; the world must expire it even during a DB outage. */
export async function bookingAdmission(
  db: Executor,
  characterId: string,
  bookingId: string,
  nowMs = Date.now(),
): Promise<BookingAdmission | null> {
  const booking = (
    await db.select().from(loungeBookings).where(eq(loungeBookings.id, bookingId))
  )[0];
  if (
    !booking ||
    booking.cancelledAt ||
    nowMs < booking.startsAt.getTime() ||
    nowMs >= booking.endsAt.getTime()
  )
    return null;
  const room = LOUNGE_ROOMS.find((entry) => entry.id === booking.roomId);
  if (!room) return null;
  if (booking.hostId !== characterId) {
    const invitation = (
      await db
        .select({ id: loungeInvitations.id })
        .from(loungeInvitations)
        .where(
          and(
            eq(loungeInvitations.bookingId, bookingId),
            eq(loungeInvitations.characterId, characterId),
          ),
        )
    )[0];
    if (!invitation) return null;
  }
  return { bookingId, roomId: room.id, capacity: room.capacity, endsAt: booking.endsAt.getTime() };
}
