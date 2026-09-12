import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  accounts,
  characters,
  connect,
  bookingAdmission,
  loungeBookings,
  loungeInvitations,
} from '@atheriam/db';
import { testDatabaseUrl } from '../../../test/integration-setup.js';
import {
  cancelBooking,
  inviteToBooking,
  loungeSchedule,
  reserveRoom,
  type BookingInput,
} from './bookings.js';
const handle = connect(testDatabaseUrl(), 8),
  db = handle.db;
const now = Date.UTC(2030, 0, 1, 12);
const minute = 60_000;
async function player(name: string) {
  const account = (
    await db
      .insert(accounts)
      .values({
        email: `${name}@example.com`,
        emailNormalised: `${name}@example.com`,
        passwordHash: 'test-only',
        dateOfBirth: '1990-01-01',
      })
      .returning()
  )[0]!;
  return (
    await db
      .insert(characters)
      .values({ accountId: account.id, name, nameNormalised: name.toLowerCase(), x: 80, y: 85 })
      .returning()
  )[0]!.id;
}
function input(extra: Partial<BookingInput> = {}): BookingInput {
  return {
    roomId: 'studio',
    title: 'Private planning meeting',
    startsAt: null,
    durationMinutes: 30,
    requestKey: 'booking-key',
    ...extra,
  };
}
async function reserve(host: string, details = input()) {
  const result = await reserveRoom(db, host, details, now);
  if (!result.ok) throw new Error(result.reason);
  return result.data.id;
}
beforeEach(async () => {
  await db.execute(sql`TRUNCATE accounts, characters CASCADE`);
});
afterAll(async () => handle.close());

describe('lounge reservations', () => {
  it('allows only one overlapping reservation under concurrent requests', async () => {
    const hosts = await Promise.all(Array.from({ length: 6 }, (_, i) => player(`Host${i}`)));
    const results = await Promise.all(hosts.map((host) => reserveRoom(db, host, input(), now)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual(
      Array.from({ length: 5 }, () => ({ ok: false, reason: 'room-unavailable' })),
    );
    expect(await db.select().from(loungeBookings)).toHaveLength(1);
  });
  it('enforces the host limit across concurrent reservations in different rooms', async () => {
    const host = await player('Host');
    const results = await Promise.all(
      ['studio', 'terrace', 'boardroom'].map((roomId) =>
        reserveRoom(db, host, input({ roomId, requestKey: `room-${roomId}` }), now),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'booking-limit' }]);
  });
  it('allows adjacent meetings but rejects a partial overlap', async () => {
    const host = await player('Host'),
      next = await player('Next'),
      third = await player('Third');
    await reserve(host);
    expect(
      (await reserveRoom(db, next, input({ startsAt: new Date(now + 30 * minute) }), now)).ok,
    ).toBe(true);
    expect(
      await reserveRoom(db, third, input({ startsAt: new Date(now + 15 * minute) }), now),
    ).toEqual({ ok: false, reason: 'room-unavailable' });
  });
  it('retries reserve-now once, even after cancellation or time has passed', async () => {
    const host = await player('Host');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserveRoom(db, host, input(), now)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.data.alreadyDone)).toHaveLength(1);
    const id = (await db.select().from(loungeBookings))[0]!.id;
    await cancelBooking(db, host, id, now);
    expect(await reserveRoom(db, host, input(), now + 86400_000)).toEqual({
      ok: true,
      data: { id, alreadyDone: true },
    });
    expect(await db.select().from(loungeBookings)).toHaveLength(1);
    expect(await reserveRoom(db, host, input({ durationMinutes: 60 }), now)).toEqual({
      ok: false,
      reason: 'key-reused',
    });
    expect(await reserveRoom(db, host, input({ roomId: 'terrace' }), now)).toEqual({
      ok: false,
      reason: 'key-reused',
    });
  });
  it('validates duration, room, time window and title', async () => {
    const host = await player('Host');
    for (const extra of [
      { durationMinutes: 15 },
      { roomId: 'unknown' },
      { title: ' ' },
      { startsAt: new Date(now - 1) },
      { startsAt: new Date(now + 8 * 86400_000) },
      { startsAt: new Date('invalid') },
      { requestKey: 'bad' },
    ])
      expect(await reserveRoom(db, host, input(extra), now)).toEqual({
        ok: false,
        reason: 'bad-request',
      });
    expect(
      (
        await reserveRoom(
          db,
          host,
          input({ startsAt: new Date(now + 7 * 86400_000), durationMinutes: 60 }),
          now,
        )
      ).ok,
    ).toBe(true);
  });
  it('admits the host and invited guests only within the reservation interval', async () => {
    const host = await player('Host'),
      guest = await player('Guest');
    const id = await reserve(host, input({ startsAt: new Date(now + 10 * minute) }));
    expect(await bookingAdmission(db, host, id, now)).toBeNull();
    expect(await bookingAdmission(db, guest, id, now + 10 * minute)).toBeNull();
    await inviteToBooking(db, host, id, guest, true, now);
    await inviteToBooking(db, host, id, guest, true, now);
    expect(await db.select().from(loungeInvitations)).toHaveLength(1);
    expect(await bookingAdmission(db, guest, id, now + 10 * minute)).toEqual({
      bookingId: id,
      roomId: 'studio',
      capacity: 8,
      endsAt: now + 40 * minute,
    });
    expect(await bookingAdmission(db, host, id, now + 40 * minute)).toBeNull();
    expect(await bookingAdmission(db, guest, id, now + 40 * minute)).toBeNull();
    await inviteToBooking(db, host, id, guest, false, now);
    expect(await bookingAdmission(db, guest, id, now + 10 * minute)).toBeNull();
  });
  it('allows only the host to invite, revoke or cancel', async () => {
    const host = await player('Host'),
      guest = await player('Guest');
    const id = await reserve(host);
    expect(await inviteToBooking(db, guest, id, guest, true, now)).toEqual({
      ok: false,
      reason: 'not-host',
    });
    expect(await cancelBooking(db, guest, id, now)).toEqual({ ok: false, reason: 'not-host' });
    await inviteToBooking(db, host, id, guest, true, now);
    await cancelBooking(db, host, id, now);
    expect(await bookingAdmission(db, host, id, now)).toBeNull();
    expect(await bookingAdmission(db, guest, id, now)).toBeNull();
    expect(await inviteToBooking(db, host, id, guest, true, now)).toEqual({
      ok: false,
      reason: 'booking-ended',
    });
    expect((await cancelBooking(db, host, id, now)).ok).toBe(true);
    expect((await reserveRoom(db, guest, input({ requestKey: 'replacement-key' }), now)).ok).toBe(
      true,
    );
  });
  it('exposes only occupied intervals to strangers and hides guest lists from invitees', async () => {
    const host = await player('Host'),
      guest = await player('Guest'),
      stranger = await player('Stranger');
    const id = await reserve(host);
    await inviteToBooking(db, host, id, guest, true, now);
    const publicView = await loungeSchedule(db, stranger, now);
    expect(publicView.bookings).toEqual([]);
    expect(publicView.occupied).toHaveLength(1);
    expect(JSON.stringify(publicView)).not.toContain('Private planning');
    expect(JSON.stringify(publicView)).not.toContain(host);
    const guestView = await loungeSchedule(db, guest, now);
    expect(guestView.bookings).toMatchObject([{ id, yours: false, guests: [] }]);
    expect((await loungeSchedule(db, host, now)).bookings).toMatchObject([
      { id, yours: true, guests: ['Guest'] },
    ]);
    await inviteToBooking(db, host, id, guest, false, now);
    expect((await loungeSchedule(db, guest, now)).bookings).toEqual([]);
  });
});
