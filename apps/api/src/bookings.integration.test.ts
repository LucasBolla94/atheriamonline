import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { readConfig } from './config.js';
import { SessionStore } from './auth/sessions.js';
import { SESSION_COOKIE } from './routes.js';
import { silentWorldLink } from './worldLink.js';
import { testRedisUrl } from '../../../test/integration-setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
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

describe('booking HTTP routes', () => {
  let app: FastifyInstance;
  const redis = new Redis(testRedisUrl());
  const nudges: string[] = [];
  beforeEach(() => {
    nudges.length = 0;
  });
  beforeAll(async () => {
    app = await buildServer({
      db,
      redis,
      world: {
        ...silentWorldLink(),
        enterBooking: async (characterId, id) => {
          nudges.push(`enter:${characterId}:${id}`);
        },
        recheckBooking: async (id) => {
          nudges.push(`recheck:${id}`);
        },
      },
      config: readConfig({
        NODE_ENV: 'test',
        DATABASE_URL: testDatabaseUrl(),
        REDIS_URL: testRedisUrl(),
        PUBLIC_ORIGIN: 'http://localhost:5173',
        SESSION_SECRET: 'b'.repeat(64),
        GENERAL_RATE_LIMIT_PER_MINUTE: '10000',
        AUTH_RATE_LIMIT_PER_MINUTE: '10000',
      }),
    });
  });
  afterAll(async () => {
    await app.close();
    redis.disconnect();
  });
  async function cookieFor(id: string) {
    const character = (await db.select().from(characters).where(eq(characters.id, id)))[0]!;
    const token = await new SessionStore(redis).create({
      accountId: character.accountId,
      characterId: id,
    });
    return { [SESSION_COOKIE]: token };
  }
  async function active(host: string) {
    const result = await reserveRoom(db, host, input());
    if (!result.ok) throw new Error(result.reason);
    return result.data.id;
  }

  it('requires a logged-in resident for every booking action', async () => {
    const id = '30000000-0000-4000-8000-000000000001';
    for (const route of [
      { method: 'GET' as const, url: '/api/lounge' },
      { method: 'POST' as const, url: '/api/lounge/bookings' },
      ...['cancel', 'invitations', 'enter'].map((action) => ({
        method: 'POST' as const,
        url: `/api/lounge/bookings/${id}/${action}`,
      })),
    ])
      expect((await app.inject(route)).statusCode).toBe(401);
    expect(nudges).toEqual([]);
  });

  it('creates and replays a reserve-now request without moving its time or duplicating it', async () => {
    const host = await player('Host'),
      cookies = await cookieFor(host);
    const route = {
      method: 'POST' as const,
      url: '/api/lounge/bookings',
      cookies,
      payload: input(),
    };
    const first = await app.inject(route),
      second = await app.inject(route);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ...first.json(), alreadyDone: true });
    const schedule = (await app.inject({ method: 'GET', url: '/api/lounge', cookies })).json();
    expect(schedule.bookings).toHaveLength(1);
    expect(schedule.bookings[0]).toMatchObject({
      id: first.json().id,
      title: input().title,
      yours: true,
    });
    expect(
      Date.parse(schedule.bookings[0].endsAt) - Date.parse(schedule.bookings[0].startsAt),
    ).toBe(30 * minute);
    expect(schedule.rooms.map((room: { capacity: number }) => room.capacity)).toEqual([8, 12, 16]);
  });

  it('validates timezone, duration, identity fields and seven-day horizon on the server', async () => {
    const cookies = await cookieFor(await player('Host'));
    for (const change of [
      { startsAt: '2030-01-01T12:00' },
      { startsAt: 'bad' },
      { durationMinutes: 45 },
      { capacity: 999 },
      { hostId: 'someone-else' },
      { title: '' },
      { startsAt: new Date(Date.now() + 8 * 86400_000).toISOString() },
    ]) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/lounge/bookings',
        cookies,
        payload: { ...input(), ...change },
      });
      expect(result.statusCode).toBe(400);
    }
    expect(await db.select().from(loungeBookings)).toHaveLength(0);
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/lounge/bookings',
          cookies,
          payload: { ...input(), startsAt: future },
        })
      ).statusCode,
    ).toBe(201);
  });

  it('returns useful conflicts for occupied rooms and a full host agenda', async () => {
    const host = await player('Host'),
      other = await player('Other');
    const cookies = await cookieFor(host);
    await active(host);
    const conflict = await app.inject({
      method: 'POST',
      url: '/api/lounge/bookings',
      cookies: await cookieFor(other),
      payload: input(),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('room-unavailable');
    const create = (roomId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/lounge/bookings',
        cookies,
        payload: { ...input(), roomId, requestKey: `request-${roomId}` },
      });
    expect((await create('terrace')).statusCode).toBe(201);
    const full = await create('boardroom');
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toBe('booking-limit');
  });

  it('protects invitations, hides private details, and nudges live access after revocation', async () => {
    const host = await player('Host'),
      guest = await player('Guest'),
      outsider = await player('Outsider');
    const hostCookie = await cookieFor(host),
      guestCookie = await cookieFor(guest),
      otherCookie = await cookieFor(outsider);
    const id = await active(host),
      url = `/api/lounge/bookings/${id}/invitations`;
    const change = (cookies: Record<string, string>, invited: boolean) =>
      app.inject({ method: 'POST', url, cookies, payload: { name: 'guest', invited } });
    expect((await change(otherCookie, true)).statusCode).toBe(403);
    expect((await change(hostCookie, true)).statusCode).toBe(200);
    expect(nudges).toEqual([`recheck:${id}`]);
    const agenda = async (cookies: Record<string, string>) =>
      (await app.inject({ method: 'GET', url: '/api/lounge', cookies })).json();
    expect((await agenda(hostCookie)).bookings[0].guests).toEqual(['Guest']);
    expect((await agenda(guestCookie)).bookings[0]).toMatchObject({ id, yours: false, guests: [] });
    const publicView = await agenda(otherCookie);
    expect(publicView.bookings).toEqual([]);
    expect(Object.keys(publicView.occupied[0]).sort()).toEqual(['endsAt', 'roomId', 'startsAt']);
    expect(JSON.stringify(publicView)).not.toContain(input().title);
    expect((await change(hostCookie, false)).statusCode).toBe(200);
    expect((await agenda(guestCookie)).bookings).toEqual([]);
    expect(nudges).toEqual([`recheck:${id}`, `recheck:${id}`]);
  });

  it('only requests entry for active invited residents and removes everyone on host cancellation', async () => {
    const host = await player('Host'),
      guest = await player('Guest');
    const cookies = await cookieFor(host),
      guestCookie = await cookieFor(guest),
      id = await active(host);
    const enter = (who: Record<string, string>) =>
      app.inject({ method: 'POST', url: `/api/lounge/bookings/${id}/enter`, cookies: who });
    expect((await enter(guestCookie)).statusCode).toBe(403);
    await inviteToBooking(db, host, id, guest, true);
    expect((await enter(guestCookie)).statusCode).toBe(202);
    expect(nudges).toEqual([`enter:${guest}:${id}`]);
    const cancel = (who: Record<string, string>) =>
      app.inject({ method: 'POST', url: `/api/lounge/bookings/${id}/cancel`, cookies: who });
    expect((await cancel(guestCookie)).statusCode).toBe(403);
    expect((await cancel(cookies)).statusCode).toBe(200);
    expect((await cancel(cookies)).statusCode).toBe(200);
    expect(nudges.slice(1)).toEqual([`recheck:${id}`, `recheck:${id}`]);
    expect((await enter(cookies)).statusCode).toBe(403);
    expect((await enter(guestCookie)).statusCode).toBe(403);
  });
});
