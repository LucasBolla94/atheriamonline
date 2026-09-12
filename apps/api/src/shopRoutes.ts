import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { formatAmount, parseAmount } from '@atheriam/economy';
import type { registerPropertyRoutes } from './propertyRoutes.js';
import { browseShop, buyListing, cancelListing, createListing, type ShopFailure } from './shops.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const requestKey = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const listingBody = z
  .object({ itemId: z.string().uuid(), price: z.string().min(1).max(20), requestKey })
  .strict();
const buyBody = z.object({ requestKey }).strict();
const messages: Record<ShopFailure, string> = {
  'not-owner': 'Only the business owner can change its listings.',
  'not-welcome': 'You do not have access to this business.',
  'no-such-property': 'This address could not be found.',
  'no-such-listing': 'This listing could not be found.',
  'not-your-item': 'That item is no longer in your inventory.',
  'listing-closed': 'This item has already been sold or withdrawn.',
  'own-listing': 'This is your listing. Withdraw it to return the item to your inventory.',
  'bad-price': 'Enter a positive price with at most two decimal places.',
  'bad-request-key': 'Please try this request again.',
  'key-reused': 'This request was already used for another listing or purchase.',
  'not-enough-money': 'You do not have enough Crowns to buy this item.',
};
function failure(reply: FastifyReply, reason: ShopFailure) {
  const status =
    reason === 'not-owner' || reason === 'not-welcome'
      ? 403
      : reason === 'no-such-property' || reason === 'no-such-listing'
        ? 404
        : 409;
  return reply.code(status).send({ error: reason, message: messages[reason] });
}
function invalid(reply: FastifyReply) {
  return reply
    .code(400)
    .send({ error: 'invalid-request', message: 'Please check the listing request.' });
}
export function registerShopRoutes(
  app: FastifyInstance,
  options: Parameters<typeof registerPropertyRoutes>[1],
) {
  const { db, requirePlayer } = options;
  app.get('/api/properties/:id/listings', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (!who) return reply;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return invalid(reply);
    const result = await browseShop(db, who.character.id, params.data.id);
    if (!result.ok) return failure(reply, result.reason);
    return {
      yours: result.data.yours,
      items: result.data.items.map((item) => ({
        ...item,
        price: item.price.toString(),
        priceDisplay: formatAmount(item.price),
      })),
    };
  });
  app.post('/api/properties/:id/listings', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (!who) return reply;
    const params = paramsSchema.safeParse(request.params),
      body = listingBody.safeParse(request.body);
    if (!params.success || !body.success) return invalid(reply);
    const price = parseAmount(body.data.price);
    if (price === null) return failure(reply, 'bad-price');
    const result = await createListing(
      db,
      who.character.id,
      params.data.id,
      body.data.itemId,
      price,
      body.data.requestKey,
    );
    return result.ok ? result.data : failure(reply, result.reason);
  });
  app.post('/api/listings/:id/cancel', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (!who) return reply;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return invalid(reply);
    const result = await cancelListing(db, who.character.id, params.data.id);
    return result.ok ? result.data : failure(reply, result.reason);
  });
  app.post('/api/listings/:id/buy', async (request, reply) => {
    const who = await requirePlayer(request, reply);
    if (!who) return reply;
    const params = paramsSchema.safeParse(request.params),
      body = buyBody.safeParse(request.body);
    if (!params.success || !body.success) return invalid(reply);
    const result = await buyListing(db, who.character.id, params.data.id, body.data.requestKey);
    if (!result.ok) return failure(reply, result.reason);
    return {
      ...result.data,
      price: result.data.price.toString(),
      priceDisplay: formatAmount(result.data.price),
    };
  });
}
