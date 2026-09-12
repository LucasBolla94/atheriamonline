/** Business sales conserve the item instance and both sides of its payment. */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  itemDefinitions,
  itemInstances,
  mayEnterProperty,
  properties,
  shopListings,
  shopSales,
  type Database,
} from '@atheriam/db';
import { MAX_AMOUNT, playerAccount } from '@atheriam/economy';
import { moveItem } from './items.js';
import { moveWithin } from './economy.js';

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
export type ShopFailure =
  | 'not-owner'
  | 'not-welcome'
  | 'no-such-property'
  | 'no-such-listing'
  | 'not-your-item'
  | 'listing-closed'
  | 'own-listing'
  | 'bad-price'
  | 'bad-request-key'
  | 'key-reused'
  | 'not-enough-money';
export type ShopResult<T> = { ok: true; data: T } | { ok: false; reason: ShopFailure };
function fail(reason: ShopFailure): ShopResult<never> {
  return { ok: false, reason };
}
const validKey = (key: string) => /^[a-zA-Z0-9_-]{8,100}$/.test(key);
async function lockRequest(tx: Executor, scope: string, id: string, key: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${scope}:${id}:${key}`}))`);
}

export async function createListing(
  db: Database,
  sellerId: string,
  propertyId: string,
  itemId: string,
  price: bigint,
  requestKey: string,
): Promise<ShopResult<{ id: string; alreadyDone: boolean }>> {
  if (!validKey(requestKey)) return fail('bad-request-key');
  if (price <= 0n || price > MAX_AMOUNT) return fail('bad-price');
  return db.transaction(async (tx) => {
    await lockRequest(tx, 'shop-list', sellerId, requestKey);
    const previous = (
      await tx
        .select()
        .from(shopListings)
        .where(and(eq(shopListings.sellerId, sellerId), eq(shopListings.requestKey, requestKey)))
    )[0];
    if (previous) {
      if (
        previous.propertyId !== propertyId ||
        previous.itemId !== itemId ||
        previous.price !== price
      )
        return fail('key-reused');
      return { ok: true, data: { id: previous.id, alreadyDone: true } };
    }
    const property = (
      await tx.select().from(properties).where(eq(properties.id, propertyId)).for('update')
    )[0];
    if (!property) return fail('no-such-property');
    if (property.municipal || property.ownerId !== sellerId) return fail('not-owner');
    const id = randomUUID();
    if (!(await moveItem(tx, itemId, { kind: 'character', id: sellerId }, { kind: 'escrow', id })))
      return fail('not-your-item');
    await tx.insert(shopListings).values({ id, propertyId, sellerId, itemId, price, requestKey });
    return { ok: true, data: { id, alreadyDone: false } };
  });
}

export async function cancelListing(
  db: Database,
  sellerId: string,
  listingId: string,
): Promise<ShopResult<{ alreadyDone: boolean }>> {
  return db.transaction(async (tx) => {
    const original = (
      await tx.select().from(shopListings).where(eq(shopListings.id, listingId))
    )[0];
    if (!original) return fail('no-such-listing');
    const property = (
      await tx.select().from(properties).where(eq(properties.id, original.propertyId)).for('update')
    )[0];
    if (!property || property.ownerId !== sellerId || original.sellerId !== sellerId)
      return fail('not-owner');
    const listing = (
      await tx.select().from(shopListings).where(eq(shopListings.id, listingId)).for('update')
    )[0]!;
    if (listing.status === 'cancelled') return { ok: true, data: { alreadyDone: true } };
    if (listing.status !== 'open') return fail('listing-closed');
    if (
      !(await moveItem(
        tx,
        listing.itemId,
        { kind: 'escrow', id: listing.id },
        { kind: 'character', id: sellerId },
      ))
    )
      throw new Error('An open listing lost its escrow item.');
    await tx
      .update(shopListings)
      .set({ status: 'cancelled', closedAt: new Date() })
      .where(eq(shopListings.id, listing.id));
    return { ok: true, data: { alreadyDone: false } };
  });
}

export interface ShopItem {
  id: string;
  itemId: string;
  definitionId: string;
  name: string;
  description: string;
  price: bigint;
}
export async function browseShop(
  db: Database,
  visitorId: string,
  propertyId: string,
): Promise<ShopResult<{ yours: boolean; items: ShopItem[] }>> {
  return db.transaction(async (tx) => {
    const property = (
      await tx.select().from(properties).where(eq(properties.id, propertyId)).for('share')
    )[0];
    if (!property) return fail('no-such-property');
    if (!(await mayEnterProperty(tx, property, visitorId))) return fail('not-welcome');
    const items = await tx
      .select({
        id: shopListings.id,
        itemId: shopListings.itemId,
        definitionId: itemDefinitions.id,
        name: itemDefinitions.name,
        description: itemDefinitions.description,
        price: shopListings.price,
      })
      .from(shopListings)
      .innerJoin(itemInstances, eq(itemInstances.id, shopListings.itemId))
      .innerJoin(itemDefinitions, eq(itemDefinitions.id, itemInstances.definitionId))
      .where(and(eq(shopListings.propertyId, propertyId), eq(shopListings.status, 'open')))
      .orderBy(shopListings.createdAt);
    return { ok: true, data: { yours: property.ownerId === visitorId, items } };
  });
}

export async function buyListing(
  db: Database,
  buyerId: string,
  listingId: string,
  requestKey: string,
): Promise<ShopResult<{ receiptId: string; itemId: string; price: bigint; alreadyDone: boolean }>> {
  if (!validKey(requestKey)) return fail('bad-request-key');
  return db.transaction(async (tx) => {
    await lockRequest(tx, 'shop-buy', buyerId, requestKey);
    const receipt = (
      await tx
        .select()
        .from(shopSales)
        .where(and(eq(shopSales.buyerId, buyerId), eq(shopSales.requestKey, requestKey)))
    )[0];
    if (receipt) {
      if (receipt.listingId !== listingId) return fail('key-reused');
      const listing = (
        await tx.select().from(shopListings).where(eq(shopListings.id, listingId))
      )[0]!;
      return {
        ok: true,
        data: {
          receiptId: receipt.id,
          itemId: listing.itemId,
          price: receipt.price,
          alreadyDone: true,
        },
      };
    }
    const original = (
      await tx.select().from(shopListings).where(eq(shopListings.id, listingId))
    )[0];
    if (!original) return fail('no-such-listing');
    // All listing changes lock the property before the listing. Permission
    // changes use that same property lock, so access cannot race this sale.
    const property = (
      await tx.select().from(properties).where(eq(properties.id, original.propertyId)).for('update')
    )[0];
    if (!property) return fail('no-such-property');
    if (!(await mayEnterProperty(tx, property, buyerId))) return fail('not-welcome');
    const listing = (
      await tx.select().from(shopListings).where(eq(shopListings.id, listingId)).for('update')
    )[0]!;
    if (listing.status !== 'open') return fail('listing-closed');
    if (listing.sellerId === buyerId) return fail('own-listing');
    if (property.ownerId !== listing.sellerId) return fail('listing-closed');
    const item = (
      await tx
        .select()
        .from(itemInstances)
        .where(eq(itemInstances.id, listing.itemId))
        .for('update')
    )[0];
    if (!item || item.holderKind !== 'escrow' || item.holderId !== listing.id)
      throw new Error('An open listing lost its escrow item.');
    const paid = await moveWithin(tx, {
      from: playerAccount(buyerId),
      to: playerAccount(listing.sellerId),
      amount: listing.price,
      reason: `Business item purchase: ${listing.id}`,
      idempotencyKey: `shop-buy:${buyerId}:${requestKey}`,
    });
    if (!paid.ok) {
      if (paid.reason === 'not-enough-money') return fail('not-enough-money');
      throw new Error(`Invalid listing payment: ${paid.reason}`);
    }
    if (paid.alreadyDone) throw new Error('A listing payment exists without its receipt.');
    if (
      !(await moveItem(
        tx,
        listing.itemId,
        { kind: 'escrow', id: listing.id },
        { kind: 'character', id: buyerId },
      ))
    )
      throw new Error('The sale item could not be transferred.');
    await tx
      .update(shopListings)
      .set({ status: 'sold', closedAt: new Date() })
      .where(eq(shopListings.id, listing.id));
    const written = (
      await tx
        .insert(shopSales)
        .values({
          listingId,
          buyerId,
          requestKey,
          transferId: paid.transferId,
          price: listing.price,
        })
        .returning()
    )[0]!;
    return {
      ok: true,
      data: {
        receiptId: written.id,
        itemId: listing.itemId,
        price: listing.price,
        alreadyDone: false,
      },
    };
  });
}
