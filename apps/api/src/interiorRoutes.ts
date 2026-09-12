import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { registerPropertyRoutes } from './propertyRoutes.js';
import {
  decorateInterior,
  setPropertyGuest,
  viewInterior,
  type InteriorFailure,
} from './interiors.js';
import { findCharacterByName } from './moderation.js';

const idParams = z.object({ id: z.string().uuid() });
const itemId = z.string().uuid();
const rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const decoration = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('place'),
      itemId,
      x: z.number().int(),
      y: z.number().int(),
      rotation,
    })
    .strict(),
  z.object({ action: z.literal('rotate'), itemId, rotation }).strict(),
  z.object({ action: z.literal('take'), itemId }).strict(),
]);
const guestBody = z
  .object({ name: z.string().trim().min(1).max(24), welcomed: z.boolean() })
  .strict();
const messages: Record<InteriorFailure, string> = {
  'not-owner': 'Only the owner can change this environment.',
  'not-welcome': 'This environment is private. Ask the owner for an invitation.',
  'no-such-property': 'This address could not be found.',
  'no-such-character': 'That resident could not be found.',
  'not-your-item': 'That item is no longer available to move.',
  'not-furniture': 'Only furniture can be placed here.',
  'bad-place': 'Choose a floor tile and leave the entrance clear.',
  'bad-rotation': 'Choose a valid furniture direction.',
  'tile-taken': 'Another item is already on that tile.',
};
function failure(reply: FastifyReply, reason: InteriorFailure) {
  const status =
    reason === 'not-owner' || reason === 'not-welcome'
      ? 403
      : reason === 'no-such-property' || reason === 'no-such-character'
        ? 404
        : 409;
  return reply.code(status).send({ error: reason, message: messages[reason] });
}
function invalid(reply: FastifyReply) {
  return reply
    .code(400)
    .send({ error: 'invalid-request', message: 'Please check the environment request.' });
}

export function registerInteriorRoutes(
  app: FastifyInstance,
  options: Parameters<typeof registerPropertyRoutes>[1],
): void {
  const { db, world, requirePlayer } = options;
  app.get('/api/properties/:id/interior', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    const params = idParams.safeParse(request.params);
    if (!params.success) return invalid(reply);
    const result = await viewInterior(db, params.data.id, who.character.id);
    return result.ok ? result.data : failure(reply, result.reason);
  });
  app.post('/api/properties/:id/enter', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    const params = idParams.safeParse(request.params);
    if (!params.success) return invalid(reply);
    const result = await viewInterior(db, params.data.id, who.character.id);
    if (!result.ok) return failure(reply, result.reason);
    await world.enterProperty(who.character.id, params.data.id);
    // Admission is confirmed by the live realm message, never by this HTTP reply.
    return reply.code(202).send({ requested: true, id: params.data.id });
  });
  app.post('/api/properties/:id/guests', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    const params = idParams.safeParse(request.params);
    const body = guestBody.safeParse(request.body);
    if (!params.success || !body.success) return invalid(reply);
    const interior = await viewInterior(db, params.data.id, who.character.id);
    if (!interior.ok) return failure(reply, interior.reason);
    if (!interior.data.yours) return failure(reply, 'not-owner');
    const guest = await findCharacterByName(db, body.data.name);
    if (guest === null) return failure(reply, 'no-such-character');
    const result = await setPropertyGuest(
      db,
      who.character.id,
      params.data.id,
      guest.id,
      body.data.welcomed,
    );
    if (!result.ok) return failure(reply, result.reason);
    await world.recheckProperty(params.data.id);
    return { guests: result.data };
  });
  app.post('/api/properties/:id/decorate', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    const params = idParams.safeParse(request.params);
    const body = decoration.safeParse(request.body);
    if (!params.success || !body.success) return invalid(reply);
    const result = await decorateInterior(db, who.character.id, params.data.id, body.data);
    return result.ok ? { contents: result.data } : failure(reply, result.reason);
  });
}
