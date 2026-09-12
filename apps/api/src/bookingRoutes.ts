import type { FastifyInstance, FastifyReply } from 'fastify';
import { bookingAdmission } from '@atheriam/db';
import { z } from 'zod';
import type { registerPropertyRoutes } from './propertyRoutes.js';
import {
  cancelBooking,
  inviteToBooking,
  loungeSchedule,
  reserveRoom,
  type BookingFailure,
} from './bookings.js';
import { findCharacterByName } from './moderation.js';

const idParams = z.object({ id: z.string().uuid() });
const reserveBody = z
  .object({
    roomId: z.enum(['studio', 'terrace', 'boardroom']),
    title: z.string().trim().min(1).max(64),
    startsAt: z.string().datetime({ offset: true }).nullable(),
    durationMinutes: z.union([z.literal(30), z.literal(60)]),
    requestKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
  })
  .strict();
const invitationBody = z
  .object({ name: z.string().trim().min(1).max(24), invited: z.boolean() })
  .strict();
const messages: Record<BookingFailure, string> = {
  'bad-request': 'Choose a meeting within the next seven days, lasting 30 or 60 minutes.',
  'key-reused': 'This request was already used for another reservation.',
  'booking-limit': 'You may host at most two upcoming or active meetings.',
  'room-unavailable':
    'That room is already reserved during this time. Choose another room or time.',
  'not-host': 'Only the host can manage this meeting.',
  'no-such-booking': 'This reservation could not be found.',
  'no-such-character': 'That resident could not be found.',
  'booking-ended': 'This meeting has ended or been cancelled.',
};
function failure(reply: FastifyReply, reason: BookingFailure) {
  const status =
    reason === 'bad-request'
      ? 400
      : reason === 'not-host'
        ? 403
        : reason.startsWith('no-such-')
          ? 404
          : 409;
  return reply.code(status).send({ error: reason, message: messages[reason] });
}
function invalid(reply: FastifyReply) {
  return reply
    .code(400)
    .send({ error: 'invalid-request', message: 'Please check the meeting request.' });
}
export function registerBookingRoutes(
  app: FastifyInstance,
  options: Parameters<typeof registerPropertyRoutes>[1],
): void {
  const { db, world, requirePlayer } = options;
  app.get('/api/lounge', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (!who) return reply;
    return loungeSchedule(db, who.character.id);
  });
  app.post('/api/lounge/bookings', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (!who) return reply;
    const body = reserveBody.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const result = await reserveRoom(db, who.character.id, {
      ...body.data,
      startsAt: body.data.startsAt === null ? null : new Date(body.data.startsAt),
    });
    return result.ok
      ? reply.code(result.data.alreadyDone ? 200 : 201).send(result.data)
      : failure(reply, result.reason);
  });
  app.post('/api/lounge/bookings/:id/cancel', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (!who) return reply;
    const params = idParams.safeParse(request.params);
    if (!params.success) return invalid(reply);
    const result = await cancelBooking(db, who.character.id, params.data.id);
    if (!result.ok) return failure(reply, result.reason);
    await world.recheckBooking(params.data.id);
    return result.data;
  });
  app.post('/api/lounge/bookings/:id/invitations', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (!who) return reply;
    const params = idParams.safeParse(request.params),
      body = invitationBody.safeParse(request.body);
    if (!params.success || !body.success) return invalid(reply);
    // Check the host before resolving names, so this endpoint cannot probe another guest list.
    const schedule = await loungeSchedule(db, who.character.id);
    if (!schedule.bookings.some((booking) => booking.id === params.data.id && booking.yours))
      return failure(reply, 'not-host');
    const guest = await findCharacterByName(db, body.data.name);
    if (!guest) return failure(reply, 'no-such-character');
    const result = await inviteToBooking(
      db,
      who.character.id,
      params.data.id,
      guest.id,
      body.data.invited,
    );
    if (!result.ok) return failure(reply, result.reason);
    await world.recheckBooking(params.data.id);
    return result.data;
  });
  app.post('/api/lounge/bookings/:id/enter', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (!who) return reply;
    const params = idParams.safeParse(request.params);
    if (!params.success) return invalid(reply);
    if (!(await bookingAdmission(db, who.character.id, params.data.id)))
      return reply
        .code(403)
        .send({
          error: 'not-invited',
          message: 'Entry requires an active reservation and an invitation from its host.',
        });
    await world.enterBooking(who.character.id, params.data.id);
    // The live server also checks location, current permission and capacity.
    return reply.code(202).send({ requested: true, id: params.data.id });
  });
}
