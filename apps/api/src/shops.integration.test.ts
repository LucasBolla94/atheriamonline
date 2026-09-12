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
  itemInstances,
  properties,
  shopListings,
  shopSales,
} from '@atheriam/db';
import { MINT, playerAccount } from '@atheriam/economy';
import { testDatabaseUrl } from '../../../test/integration-setup.js';
import {
  buyProperty,
  cityProperties,
  configureBusiness,
  ensureCityProperties,
} from './properties.js';
import { createItemFor, ensureCatalogue, inventoryOf } from './items.js';
import { ledgerSum, move, purseOf } from './economy.js';
import { browseShop, buyListing, cancelListing, createListing } from './shops.js';
import { decorateInterior } from './interiors.js';

const handle = connect(testDatabaseUrl(), 8),
  db = handle.db;
async function player(name: string, balance = 50000n) {
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
  const character = (
    await db
      .insert(characters)
      .values({ accountId: account.id, name, nameNormalised: name.toLowerCase(), x: 80, y: 85 })
      .returning()
  )[0]!;
  if (balance > 0n)
    await move(db, {
      from: MINT,
      to: playerAccount(character.id),
      amount: balance,
      reason: 'Test funding',
      idempotencyKey: `fund-${character.id}`,
    });
  return character.id;
}
async function shop() {
  const seller = await player('Seller');
  const property = (await cityProperties(db)).find((p) => !p.municipal)!;
  expect((await buyProperty(db, seller, property.id, 'property-purchase')).ok).toBe(true);
  await configureBusiness(db, seller, property.id, {
    businessName: 'Corner Shop',
    description: '',
    access: 'everyone',
    published: true,
    floorStyle: 'oak',
    wallStyle: 'cream',
  });
  const item = await createItemFor(db, 'oak-stool', seller);
  return { seller, property, item };
}
async function listing(
  seller: string,
  propertyId: string,
  itemId: string,
  price = 1250n,
  key = 'listing-key',
) {
  const result = await createListing(db, seller, propertyId, itemId, price, key);
  if (!result.ok) throw new Error(result.reason);
  return result.data.id;
}
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE accounts, characters, cities, properties, transfers, ledger_entries, item_instances CASCADE`,
  );
  await ensureCityProperties(db);
  await ensureCatalogue(db);
});
afterAll(async () => handle.close());

describe('atomic business sales', () => {
  it('reserves one item, pays the seller and gives that same instance to the buyer', async () => {
    const { seller, property, item } = await shop();
    const buyer = await player('Buyer');
    const id = await listing(seller, property.id, item.id);
    expect(await inventoryOf(db, seller)).toHaveLength(0);
    expect(
      await decorateInterior(db, seller, property.id, {
        action: 'place',
        itemId: item.id,
        x: 4,
        y: 4,
        rotation: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'not-your-item' });
    expect(await browseShop(db, buyer, property.id)).toMatchObject({
      ok: true,
      data: { yours: false, items: [{ id, itemId: item.id, price: 1250n }] },
    });
    expect(await buyListing(db, buyer, id, 'purchase-key')).toMatchObject({
      ok: true,
      data: { itemId: item.id, price: 1250n, alreadyDone: false },
    });
    expect(await purseOf(db, seller)).toBe(26250n);
    expect(await purseOf(db, buyer)).toBe(48750n);
    expect(await ledgerSum(db)).toBe(0n);
    expect(await db.select().from(itemInstances)).toHaveLength(1);
    expect(await inventoryOf(db, buyer)).toMatchObject([{ id: item.id }]);
    expect(await browseShop(db, buyer, property.id)).toMatchObject({
      ok: true,
      data: { items: [] },
    });
  });
  it('serializes concurrent buyers and preserves the losing buyer balance', async () => {
    const { seller, property, item } = await shop();
    const buyers = await Promise.all([player('One'), player('Two')]);
    const id = await listing(seller, property.id, item.id);
    const results = await Promise.all(
      buyers.map((buyer) => buyListing(db, buyer, id, 'purchase-race')),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'listing-closed' }]);
    const winner = results.findIndex((r) => r.ok);
    expect(await purseOf(db, buyers[winner]!)).toBe(48750n);
    expect(await purseOf(db, buyers[1 - winner]!)).toBe(50000n);
    expect(await inventoryOf(db, buyers[winner]!)).toMatchObject([{ id: item.id }]);
    expect(await db.select().from(shopSales)).toHaveLength(1);
    expect(await ledgerSum(db)).toBe(0n);
  });
  it('replays concurrent purchases once and retains the receipt after access changes', async () => {
    const { seller, property, item } = await shop();
    const buyer = await player('Buyer');
    const id = await listing(seller, property.id, item.id);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => buyListing(db, buyer, id, 'same-purchase')),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.data.alreadyDone)).toHaveLength(1);
    await db.update(properties).set({ access: 'nobody' }).where(eq(properties.id, property.id));
    expect(await buyListing(db, buyer, id, 'same-purchase')).toMatchObject({
      ok: true,
      data: { alreadyDone: true },
    });
    expect(await purseOf(db, buyer)).toBe(48750n);
    expect(await db.select().from(itemInstances)).toHaveLength(1);
    expect(await ledgerSum(db)).toBe(0n);
  });
  it('prevents overspending across two businesses purchased at the same time', async () => {
    const { seller, property, item } = await shop();
    const secondSeller = await player('SecondSeller');
    const secondProperty = (await cityProperties(db)).find((p) => !p.municipal && !p.ownerId)!;
    await buyProperty(db, secondSeller, secondProperty.id, 'second-property');
    await db
      .update(properties)
      .set({ access: 'everyone' })
      .where(eq(properties.id, secondProperty.id));
    const secondItem = await createItemFor(db, 'rush-mat', secondSeller);
    const firstListing = await listing(seller, property.id, item.id);
    const secondListing = await listing(secondSeller, secondProperty.id, secondItem.id);
    const buyer = await player('LimitedBuyer', 1500n);
    const outcomes = await Promise.all([
      buyListing(db, buyer, firstListing, 'first-purchase'),
      buyListing(db, buyer, secondListing, 'second-purchase'),
    ]);
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect(outcomes.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: 'not-enough-money' },
    ]);
    expect(await purseOf(db, buyer)).toBe(250n);
    expect(await inventoryOf(db, buyer)).toHaveLength(1);
    expect(await db.select().from(itemInstances)).toHaveLength(2);
    expect(await db.select().from(shopSales)).toHaveLength(1);
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('binds listing and purchase retry keys to the exact intent', async () => {
    const { seller, property, item } = await shop();
    const buyer = await player('Buyer');
    const id = await listing(seller, property.id, item.id);
    expect(await createListing(db, seller, property.id, item.id, 1251n, 'listing-key')).toEqual({
      ok: false,
      reason: 'key-reused',
    });
    const second = await createItemFor(db, 'rush-mat', seller);
    const secondId = await listing(seller, property.id, second.id, 1250n, 'second-key');
    await buyListing(db, buyer, id, 'purchase-key');
    expect(await buyListing(db, buyer, secondId, 'purchase-key')).toEqual({
      ok: false,
      reason: 'key-reused',
    });
    expect(await purseOf(db, buyer)).toBe(48750n);
  });
  it('allows one listing for an item and safely retries its creation', async () => {
    const { seller, property, item } = await shop();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        createListing(db, seller, property.id, item.id, 100n, 'same-listing'),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await db.select().from(shopListings)).toHaveLength(1);
    expect(await createListing(db, seller, property.id, item.id, 100n, 'different-key')).toEqual({
      ok: false,
      reason: 'not-your-item',
    });
    expect(await db.select().from(itemInstances)).toHaveLength(1);
  });
  it('leaves the listing and money unchanged when the buyer cannot afford it', async () => {
    const { seller, property, item } = await shop();
    const buyer = await player('Poor', 100n);
    const id = await listing(seller, property.id, item.id);
    expect(await buyListing(db, buyer, id, 'purchase-key')).toEqual({
      ok: false,
      reason: 'not-enough-money',
    });
    expect(await purseOf(db, buyer)).toBe(100n);
    expect(await purseOf(db, seller)).toBe(25000n);
    expect((await db.select().from(shopListings))[0]!.status).toBe('open');
    expect((await db.select().from(itemInstances))[0]).toMatchObject({
      id: item.id,
      holderKind: 'escrow',
      holderId: id,
    });
    expect(await db.select().from(shopSales)).toHaveLength(0);
  });
  it('cancels exactly once and permits a new listing of the returned item', async () => {
    const { seller, property, item } = await shop();
    const id = await listing(seller, property.id, item.id);
    expect(await cancelListing(db, seller, id)).toEqual({ ok: true, data: { alreadyDone: false } });
    expect(await cancelListing(db, seller, id)).toEqual({ ok: true, data: { alreadyDone: true } });
    expect(await inventoryOf(db, seller)).toMatchObject([{ id: item.id }]);
    const next = await listing(seller, property.id, item.id, 500n, 'relisted-key');
    expect(next).not.toBe(id);
    expect(await createListing(db, seller, property.id, item.id, 1250n, 'listing-key')).toEqual({
      ok: true,
      data: { id, alreadyDone: true },
    });
    expect(await db.select().from(itemInstances)).toHaveLength(1);
  });
  it('resolves a cancellation racing a purchase without losing or duplicating anything', async () => {
    const { seller, property, item } = await shop();
    const buyer = await player('Buyer');
    const id = await listing(seller, property.id, item.id);
    const [sale, cancel] = await Promise.all([
      buyListing(db, buyer, id, 'purchase-key'),
      cancelListing(db, seller, id),
    ]);
    expect(Number(sale.ok) + Number(cancel.ok)).toBe(1);
    const holder = (await db.select().from(itemInstances))[0]!;
    expect(holder.holderKind).toBe('character');
    expect(holder.holderId).toBe(sale.ok ? buyer : seller);
    expect(await purseOf(db, buyer)).toBe(sale.ok ? 48750n : 50000n);
    expect(await ledgerSum(db)).toBe(0n);
  });
  it('rejects cross-owner changes, self-purchases and private visitors', async () => {
    const { seller, property, item } = await shop();
    const other = await player('Other');
    expect(await createListing(db, other, property.id, item.id, 100n, 'other-key')).toEqual({
      ok: false,
      reason: 'not-owner',
    });
    const othersItem = await createItemFor(db, 'oak-stool', other);
    expect(await createListing(db, seller, property.id, othersItem.id, 100n, 'theft-key')).toEqual({
      ok: false,
      reason: 'not-your-item',
    });
    const id = await listing(seller, property.id, item.id);
    expect(await cancelListing(db, other, id)).toEqual({ ok: false, reason: 'not-owner' });
    expect(await buyListing(db, seller, id, 'self-key')).toEqual({
      ok: false,
      reason: 'own-listing',
    });
    await db.update(properties).set({ access: 'nobody' }).where(eq(properties.id, property.id));
    expect(await browseShop(db, other, property.id)).toEqual({ ok: false, reason: 'not-welcome' });
    expect(await buyListing(db, other, id, 'visitor-key')).toEqual({
      ok: false,
      reason: 'not-welcome',
    });
  });
  it('rolls back item delivery and payment when receipt writing fails', async () => {
    const { seller, property, item } = await shop();
    const buyer = await player('Buyer');
    const id = await listing(seller, property.id, item.id);
    await db.execute(
      sql`CREATE FUNCTION fail_shop_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt test failure'; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER fail_shop_receipt BEFORE INSERT ON shop_sales FOR EACH ROW EXECUTE FUNCTION fail_shop_receipt()`,
    );
    try {
      await expect(buyListing(db, buyer, id, 'failure-key')).rejects.toThrow(
        'receipt test failure',
      );
      expect(await purseOf(db, buyer)).toBe(50000n);
      expect(await purseOf(db, seller)).toBe(25000n);
      expect((await db.select().from(itemInstances))[0]).toMatchObject({
        holderKind: 'escrow',
        holderId: id,
      });
      expect((await db.select().from(shopListings))[0]!.status).toBe('open');
      expect(await ledgerSum(db)).toBe(0n);
    } finally {
      await db.execute(sql`DROP TRIGGER fail_shop_receipt ON shop_sales`);
      await db.execute(sql`DROP FUNCTION fail_shop_receipt()`);
    }
    expect((await buyListing(db, buyer, id, 'failure-key')).ok).toBe(true);
  });
});

describe('shop HTTP contracts', () => {
  let app: FastifyInstance;
  const redis = new Redis(testRedisUrl());
  beforeAll(async () => {
    app = await buildServer({
      db,
      redis,
      world: silentWorldLink(),
      config: readConfig({
        NODE_ENV: 'test',
        DATABASE_URL: testDatabaseUrl(),
        REDIS_URL: testRedisUrl(),
        PUBLIC_ORIGIN: 'http://localhost:5173',
        SESSION_SECRET: 's'.repeat(64),
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
    return {
      [SESSION_COOKIE]: await new SessionStore(redis).create({
        accountId: character.accountId,
        characterId: id,
      }),
    };
  }
  it('requires authentication and rejects client-supplied purchase prices or sellers', async () => {
    const { seller, property, item } = await shop();
    const id = await listing(seller, property.id, item.id);
    for (const route of [
      { method: 'GET' as const, url: `/api/properties/${property.id}/listings` },
      { method: 'POST' as const, url: `/api/properties/${property.id}/listings` },
      { method: 'POST' as const, url: `/api/listings/${id}/buy` },
      { method: 'POST' as const, url: `/api/listings/${id}/cancel` },
    ])
      expect((await app.inject(route)).statusCode).toBe(401);
    const buyer = await player('Buyer');
    const response = await app.inject({
      method: 'POST',
      url: `/api/listings/${id}/buy`,
      cookies: await cookieFor(buyer),
      payload: { requestKey: 'purchase-key', price: '0.01', sellerId: buyer },
    });
    expect(response.statusCode).toBe(400);
    expect(await purseOf(db, buyer)).toBe(50000n);
    expect(await db.select().from(shopSales)).toHaveLength(0);
  });
  it('lists, reviews and buys with exact Crown strings and the session buyer', async () => {
    const { seller, property, item } = await shop();
    const buyer = await player('Buyer');
    const sellerCookie = await cookieFor(seller),
      buyerCookie = await cookieFor(buyer);
    const url = `/api/properties/${property.id}/listings`;
    for (const price of ['0', '-1', '1.001', '1e5', '100000001']) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            cookies: sellerCookie,
            payload: { itemId: item.id, price, requestKey: 'invalid-price' },
          })
        ).statusCode,
      ).toBe(409);
    }
    expect(await inventoryOf(db, seller)).toMatchObject([{ id: item.id }]);
    const created = await app.inject({
      method: 'POST',
      url,
      cookies: sellerCookie,
      payload: { itemId: item.id, price: '12.50', requestKey: 'http-list-key' },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    const browsed = await app.inject({ method: 'GET', url, cookies: buyerCookie });
    expect(browsed.statusCode).toBe(200);
    expect(browsed.json()).toMatchObject({
      yours: false,
      items: [{ id, price: '1250', priceDisplay: '12.50 c' }],
    });
    const bought = await app.inject({
      method: 'POST',
      url: `/api/listings/${id}/buy`,
      cookies: buyerCookie,
      payload: { requestKey: 'http-buy-key' },
    });
    expect(bought.statusCode).toBe(200);
    expect(bought.json()).toMatchObject({
      itemId: item.id,
      price: '1250',
      priceDisplay: '12.50 c',
      alreadyDone: false,
    });
    const retry = await app.inject({
      method: 'POST',
      url: `/api/listings/${id}/buy`,
      cookies: buyerCookie,
      payload: { requestKey: 'http-buy-key' },
    });
    expect(retry.json().receiptId).toBe(bought.json().receiptId);
    expect(retry.json().alreadyDone).toBe(true);
    expect(await ledgerSum(db)).toBe(0n);
    expect(await purseOf(db, buyer)).toBe(48750n);
    expect(await inventoryOf(db, buyer)).toMatchObject([{ id: item.id }]);
  });
});
