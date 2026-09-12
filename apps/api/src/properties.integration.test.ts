import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { readConfig } from './config.js';
import { SessionStore } from './auth/sessions.js';
import { SESSION_COOKIE } from './routes.js';
import { testRedisUrl } from '../../../test/integration-setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { accounts, characters, connect, properties, propertyPurchases } from '@atheriam/db';
import { MINT, playerAccount } from '@atheriam/economy';
import { STARTER_CITY } from '@atheriam/shared';
import { testDatabaseUrl } from '../../../test/integration-setup.js';
import { balanceOf, ledgerSum, move, purseOf } from './economy.js';
import {
  buyProperty,
  cityProperties,
  configureBusiness,
  ensureCityProperties,
  propertyById,
} from './properties.js';

const handle = connect(testDatabaseUrl(), 8);
const db = handle.db;

async function player(name: string, amount = 50000n) {
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
      .values({
        accountId: account.id,
        name,
        nameNormalised: name.toLowerCase(),
        x: 80,
        y: 85,
      })
      .returning()
  )[0]!;
  if (amount > 0n)
    await move(db, {
      from: MINT,
      to: playerAccount(character.id),
      amount,
      reason: 'Test funding',
      idempotencyKey: `fund-${character.id}`,
    });
  return character.id;
}

async function address(buildingId = 'west-1') {
  const found = (await cityProperties(db)).find((p) => p.buildingId === buildingId);
  if (found === undefined) throw new Error('Missing test property');
  return found;
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE accounts, characters, cities, properties, property_purchases, transfers, ledger_entries CASCADE`,
  );
  await ensureCityProperties(db);
});
afterAll(async () => handle.close());

describe('commercial properties in a real city', () => {
  it('seeds exactly fifteen addresses and never resets an owned business', async () => {
    const buyer = await player('owner');
    const site = await address();
    await buyProperty(db, buyer, site.id, 'purchase-1');
    const settings = {
      businessName: 'Corner Studio',
      description: 'A place to create.',
      access: 'everyone' as const,
      published: true,
      floorStyle: 'tile' as const,
      wallStyle: 'teal' as const,
    };
    expect((await configureBusiness(db, buyer, site.id, settings)).ok).toBe(true);
    await ensureCityProperties(db);
    expect(await cityProperties(db)).toHaveLength(15);
    expect((await cityProperties(db)).filter((p) => p.municipal)).toHaveLength(5);
    expect(await propertyById(db, site.id)).toMatchObject({ ownerId: buyer, ...settings });
  });

  it('transfers the price to the city treasury and preserves the balanced ledger', async () => {
    const buyer = await player('buyer');
    const site = await address();
    expect((await buyProperty(db, buyer, site.id, 'purchase-1')).ok).toBe(true);
    expect(await purseOf(db, buyer)).toBe(25000n);
    expect(await balanceOf(db, `city:${STARTER_CITY.id}`)).toBe(25000n);
    expect(await ledgerSum(db)).toBe(0n);
    expect(await db.select().from(propertyPurchases)).toHaveLength(1);
  });

  it('answers concurrent identical retries with the same receipt and one payment', async () => {
    const buyer = await player('retry');
    const site = await address();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => buyProperty(db, buyer, site.id, 'same-key-1')),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = results.map((r) => (r.ok ? r.data.receiptId : 'failure'));
    expect(new Set(ids).size).toBe(1);
    expect(results.filter((r) => r.ok && !r.data.alreadyDone)).toHaveLength(1);
    expect(await purseOf(db, buyer)).toBe(25000n);
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('only sells a property once when two funded buyers race', async () => {
    const [a, b] = await Promise.all([player('alice'), player('bob')]);
    const site = await address();
    const results = await Promise.all([
      buyProperty(db, a, site.id, 'alice-key'),
      buyProperty(db, b, site.id, 'bobby-key'),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'already-owned' }]);
    expect((await purseOf(db, a)) + (await purseOf(db, b))).toBe(75000n);
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('prevents overspending on different properties purchased concurrently', async () => {
    const buyer = await player('limited', 25000n);
    const [a, b] = await Promise.all([address('west-1'), address('east-1')]);
    const results = await Promise.all([
      buyProperty(db, buyer, a.id, 'first-key'),
      buyProperty(db, buyer, b.id, 'second-key'),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'not-enough-money' }]);
    expect(await purseOf(db, buyer)).toBe(0n);
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('refuses public buildings and insufficient funds without changing ownership', async () => {
    const buyer = await player('poor', 100n);
    const publicSite = await address('city-hall');
    const commercial = await address();
    expect(await buyProperty(db, buyer, publicSite.id, 'public-key')).toEqual({
      ok: false,
      reason: 'municipal-property',
    });
    expect(await buyProperty(db, buyer, commercial.id, 'costly-key')).toEqual({
      ok: false,
      reason: 'not-enough-money',
    });
    expect((await propertyById(db, commercial.id))?.ownerId).toBeNull();
    expect(await purseOf(db, buyer)).toBe(100n);
    expect(await db.select().from(propertyPurchases)).toHaveLength(0);
  });

  it('binds successful retry keys to their original address', async () => {
    const buyer = await player('keys');
    const a = await address('west-1');
    const b = await address('east-1');
    await buyProperty(db, buyer, a.id, 'bound-key');
    expect(await buyProperty(db, buyer, b.id, 'bound-key')).toEqual({
      ok: false,
      reason: 'key-reused',
    });
    expect((await propertyById(db, b.id))?.ownerId).toBeNull();
    expect(await purseOf(db, buyer)).toBe(25000n);
  });

  it('prevents other players from editing a business or a municipal venue', async () => {
    const [owner, stranger] = await Promise.all([player('owner'), player('stranger')]);
    const site = await address();
    await buyProperty(db, owner, site.id, 'owner-key');
    const settings = {
      businessName: 'Changed Store',
      description: '',
      access: 'everyone' as const,
      published: true,
      floorStyle: 'oak' as const,
      wallStyle: 'cream' as const,
    };
    expect(await configureBusiness(db, stranger, site.id, settings)).toEqual({
      ok: false,
      reason: 'not-owner',
    });
    expect(await configureBusiness(db, owner, (await address('city-hall')).id, settings)).toEqual({
      ok: false,
      reason: 'not-owner',
    });
    expect((await propertyById(db, site.id))?.businessName).toBe(site.businessName);
  });

  it('rolls money and ownership back if writing the receipt fails', async () => {
    const buyer = await player('rollback');
    const site = await address();
    await db.execute(
      sql`CREATE FUNCTION reject_property_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER reject_receipt BEFORE INSERT ON property_purchases FOR EACH ROW EXECUTE FUNCTION reject_property_receipt()`,
    );
    try {
      await expect(buyProperty(db, buyer, site.id, 'rollback-key')).rejects.toThrow();
      expect(await purseOf(db, buyer)).toBe(50000n);
      expect((await propertyById(db, site.id))?.ownerId).toBeNull();
      expect(await balanceOf(db, `city:${STARTER_CITY.id}`)).toBe(0n);
      expect(await ledgerSum(db)).toBe(0n);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_receipt ON property_purchases`);
      await db.execute(sql`DROP FUNCTION reject_property_receipt()`);
    }
  });

  it('rejects invalid business settings and malformed retry keys', async () => {
    const buyer = await player('invalid');
    const site = await address();
    expect(await buyProperty(db, buyer, site.id, '')).toEqual({
      ok: false,
      reason: 'bad-request-key',
    });
    await buyProperty(db, buyer, site.id, 'valid-key');
    expect(
      await configureBusiness(db, buyer, site.id, {
        businessName: 'a',
        description: '',
        access: 'everyone',
        published: false,
        floorStyle: 'oak',
        wallStyle: 'cream',
      }),
    ).toEqual({ ok: false, reason: 'bad-settings' });
    expect(
      (await db.select().from(properties).where(eq(properties.id, site.id)))[0]?.businessName,
    ).toBe(site.businessName);
  });
});

describe('property HTTP routes', () => {
  let app: FastifyInstance;
  const redis = new Redis(testRedisUrl());
  beforeAll(async () => {
    app = await buildServer({
      db,
      redis,
      config: readConfig({
        NODE_ENV: 'test',
        DATABASE_URL: testDatabaseUrl(),
        REDIS_URL: testRedisUrl(),
        PUBLIC_ORIGIN: 'http://localhost:5173',
        SESSION_SECRET: 'p'.repeat(64),
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

  it('requires login for property browsing, buying and configuration', async () => {
    const site = await address();
    for (const route of [
      { method: 'GET' as const, url: '/api/city/properties' },
      { method: 'POST' as const, url: `/api/properties/${site.id}/buy` },
      { method: 'POST' as const, url: `/api/properties/${site.id}/settings` },
    ])
      expect((await app.inject(route)).statusCode).toBe(401);
  });

  it('returns prices as strings and an owned property after purchase and refresh', async () => {
    const buyer = await player('httpbuyer');
    const cookies = await cookieFor(buyer);
    const site = await address();
    const before = await app.inject({ method: 'GET', url: '/api/city/properties', cookies });
    expect(before.statusCode).toBe(200);
    expect(before.json().properties).toHaveLength(15);
    const purchased = await app.inject({
      method: 'POST',
      url: `/api/properties/${site.id}/buy`,
      cookies,
      payload: { requestKey: 'http-buy-key' },
    });
    expect(purchased.statusCode).toBe(200);
    expect(purchased.json().property).toMatchObject({
      id: site.id,
      yours: true,
      owned: true,
      price: '25000',
    });
    const after = await app.inject({ method: 'GET', url: '/api/city/properties', cookies });
    expect(after.json().properties).toContainEqual(
      expect.objectContaining({ id: site.id, yours: true }),
    );
  });

  it('hides an unpublished business name and description from other residents', async () => {
    const owner = await player('privateowner');
    const visitor = await player('privatevisitor');
    const site = await address();
    await buyProperty(db, owner, site.id, 'private-key');
    await configureBusiness(db, owner, site.id, {
      businessName: 'Unannounced Studio',
      description: 'Private launch details',
      access: 'nobody',
      published: false,
      floorStyle: 'oak',
      wallStyle: 'cream',
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/city/properties',
      cookies: await cookieFor(visitor),
    });
    const body = response.body;
    expect(body).not.toContain('Unannounced Studio');
    expect(body).not.toContain('Private launch details');
    expect(response.json().properties).toContainEqual(
      expect.objectContaining({
        id: site.id,
        businessName: site.businessName,
        description: '',
        owned: true,
      }),
    );
  });

  it('rejects a client-supplied price or owner instead of trusting it', async () => {
    const buyer = await player('tamper');
    const cookies = await cookieFor(buyer);
    const site = await address();
    const response = await app.inject({
      method: 'POST',
      url: `/api/properties/${site.id}/buy`,
      cookies,
      payload: { requestKey: 'tamper-key', price: '1', ownerId: buyer },
    });
    expect(response.statusCode).toBe(400);
    expect((await propertyById(db, site.id))?.ownerId).toBeNull();
    expect(await purseOf(db, buyer)).toBe(50000n);
  });

  it('validates identifiers and settings and enforces the actual session owner', async () => {
    const buyer = await player('editor');
    const other = await player('othereditor');
    const site = await address();
    await buyProperty(db, buyer, site.id, 'editor-key');
    const payload = {
      businessName: 'My New Studio',
      description: 'Open to everyone',
      published: true,
      access: 'everyone',
      floorStyle: 'tile',
      wallStyle: 'teal',
    };
    const denied = await app.inject({
      method: 'POST',
      url: `/api/properties/${site.id}/settings`,
      cookies: await cookieFor(other),
      payload,
    });
    expect(denied.statusCode).toBe(403);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/properties/${site.id}/settings`,
      cookies: await cookieFor(buyer),
      payload,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().property.businessName).toBe(payload.businessName);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/properties/invalid/buy',
          cookies: await cookieFor(buyer),
          payload: { requestKey: 'valid-key' },
        })
      ).statusCode,
    ).toBe(400);
  });
});
