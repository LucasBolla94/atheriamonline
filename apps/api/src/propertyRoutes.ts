import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database, Property } from '@atheriam/db';
import { CITY_BUILDINGS, STARTER_CITY } from '@atheriam/shared';
import { formatAmount } from '@atheriam/economy';
import {
  buyProperty,
  cityProperties,
  configureBusiness,
  type PropertyFailure,
} from './properties.js';

const settingsBody = z
  .object({
    businessName: z.string().trim().min(3).max(48),
    description: z.string().trim().max(300),
    access: z.enum(['nobody', 'welcomed', 'everyone']),
    published: z.boolean(),
    floorStyle: z.enum(['oak', 'stone', 'tile']),
    wallStyle: z.enum(['cream', 'teal', 'rose']),
  })
  .strict();
const idParams = z.object({ id: z.string().uuid() });
const MESSAGES: Record<PropertyFailure, string> = {
  'no-such-property': 'This address could not be found.',
  'municipal-property': 'This building belongs to the city and is not for sale.',
  'already-owned': 'This property already has an owner.',
  'not-enough-money': 'You do not have enough Crowns to buy this property.',
  'bad-request-key': 'Please try the purchase again.',
  'key-reused': 'This purchase request was already used for another property.',
  'not-owner': 'Only the owner can change this business.',
  'bad-settings': 'Please check the business name and settings.',
};

/** Convert money explicitly; never let a BIGINT through JSON serialization. */
function view(property: Property, viewerId: string) {
  const address = CITY_BUILDINGS.find(
    (b) => b.cityId === property.cityId && b.id === property.buildingId,
  );
  const visible = property.municipal || property.published || property.ownerId === viewerId;
  return {
    id: property.id,
    cityId: property.cityId,
    buildingId: property.buildingId,
    municipal: property.municipal,
    owned: property.ownerId !== null,
    yours: property.ownerId === viewerId,
    price: property.price.toString(),
    priceDisplay: formatAmount(property.price),
    businessName: visible ? property.businessName : (address?.name ?? property.buildingId),
    description: visible ? property.description : '',
    access: property.access,
    published: property.published,
    floorStyle: property.floorStyle,
    wallStyle: property.wallStyle,
    address,
  };
}

export function registerPropertyRoutes(
  app: FastifyInstance,
  options: {
    db: Database;
    requirePlayer: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<{ character: { id: string } } | null>;
  },
): void {
  const { db, requirePlayer } = options;
  app.get('/api/city/properties', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    return {
      city: STARTER_CITY,
      properties: (await cityProperties(db)).map((p) => view(p, who.character.id)),
    };
  });

  app.post('/api/properties/:id/buy', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    const params = idParams.safeParse(request.params);
    const body = z
      .object({ requestKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/) })
      .strict()
      .safeParse(request.body);
    if (!params.success || !body.success)
      return reply
        .code(400)
        .send({ error: 'invalid-request', message: 'Please check the purchase request.' });
    const result = await buyProperty(db, who.character.id, params.data.id, body.data.requestKey);
    if (!result.ok)
      return reply
        .code(result.reason === 'not-owner' ? 403 : 409)
        .send({ error: result.reason, message: MESSAGES[result.reason] });
    return {
      property: view(result.data.property, who.character.id),
      receiptId: result.data.receiptId,
      alreadyDone: result.data.alreadyDone,
    };
  });

  app.post('/api/properties/:id/settings', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (who === null) return reply;
    const params = idParams.safeParse(request.params);
    const body = settingsBody.safeParse(request.body);
    if (!params.success || !body.success)
      return reply
        .code(400)
        .send({ error: 'invalid-request', message: 'Please check the business settings.' });
    const result = await configureBusiness(db, who.character.id, params.data.id, body.data);
    if (!result.ok)
      return reply
        .code(result.reason === 'not-owner' ? 403 : 400)
        .send({ error: result.reason, message: MESSAGES[result.reason] });
    return { property: view(result.data, who.character.id) };
  });
}
