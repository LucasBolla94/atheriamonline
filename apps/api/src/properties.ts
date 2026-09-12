/** Durable commercial ownership. Price, permissions and money are server-owned. */
import { and, eq, sql } from 'drizzle-orm';
import { cities, properties, propertyPurchases, type Database, type Property } from '@atheriam/db';
import { CITY_BUILDINGS, STARTER_CITY } from '@atheriam/shared';
import { playerAccount } from '@atheriam/economy';
import { moveWithin } from './economy.js';

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
export type PropertyFailure =
  | 'no-such-property'
  | 'municipal-property'
  | 'already-owned'
  | 'not-enough-money'
  | 'bad-request-key'
  | 'key-reused'
  | 'not-owner'
  | 'bad-settings';
export type PropertyResult<T> = { ok: true; data: T } | { ok: false; reason: PropertyFailure };

/** Repeated startup never resets ownership, prices or business decoration. */
export async function ensureCityProperties(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(cities)
      .values({ id: STARTER_CITY.id, name: STARTER_CITY.name })
      .onConflictDoNothing();
    await tx
      .insert(properties)
      .values(
        CITY_BUILDINGS.map((building) => ({
          cityId: building.cityId,
          buildingId: building.id,
          municipal: building.kind === 'public',
          price: BigInt(building.priceMinor),
          businessName: building.name,
          access: building.kind === 'public' ? ('everyone' as const) : ('nobody' as const),
          published: building.kind === 'public',
        })),
      )
      .onConflictDoNothing();
  });
}

export async function propertyById(db: Executor, id: string): Promise<Property | null> {
  const found = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
  return found[0] ?? null;
}

export async function cityProperties(db: Database, cityId = STARTER_CITY.id): Promise<Property[]> {
  return db
    .select()
    .from(properties)
    .where(eq(properties.cityId, cityId))
    .orderBy(properties.buildingId);
}

export async function buyProperty(
  db: Database,
  buyerId: string,
  propertyId: string,
  requestKey: string,
): Promise<PropertyResult<{ property: Property; receiptId: string; alreadyDone: boolean }>> {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey)) return { ok: false, reason: 'bad-request-key' };
  return db.transaction(async (tx) => {
    // Serialize retries before locking the chosen property. A reused key cannot
    // buy a different address, even if both requests arrive at the same moment.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`property:${buyerId}:${requestKey}`}))`,
    );
    const receipts = await tx
      .select()
      .from(propertyPurchases)
      .where(
        and(eq(propertyPurchases.buyerId, buyerId), eq(propertyPurchases.requestKey, requestKey)),
      )
      .limit(1);
    const receipt = receipts[0];
    if (receipt !== undefined) {
      if (receipt.propertyId !== propertyId)
        return { ok: false as const, reason: 'key-reused' as const };
      const property = await propertyById(tx, propertyId);
      if (property === null) throw new Error('A purchase receipt has lost its property.');
      return { ok: true as const, data: { property, receiptId: receipt.id, alreadyDone: true } };
    }
    const locked = await tx
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .for('update');
    const property = locked[0];
    if (property === undefined) return { ok: false as const, reason: 'no-such-property' as const };
    if (property.municipal) return { ok: false as const, reason: 'municipal-property' as const };
    if (property.ownerId !== null) return { ok: false as const, reason: 'already-owned' as const };
    const payment = await moveWithin(tx, {
      from: playerAccount(buyerId),
      to: `city:${property.cityId}`,
      amount: property.price,
      reason: `Property purchase: ${property.cityId}/${property.buildingId}`,
      idempotencyKey: `property:${buyerId}:${requestKey}`,
    });
    if (!payment.ok) {
      if (payment.reason === 'not-enough-money')
        return { ok: false as const, reason: payment.reason };
      throw new Error(`Invalid property payment: ${payment.reason}`);
    }
    if (payment.alreadyDone) throw new Error('Payment exists without its atomic property receipt.');
    const updated = await tx
      .update(properties)
      .set({
        ownerId: buyerId,
        purchasedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(properties.id, propertyId))
      .returning();
    const written = await tx
      .insert(propertyPurchases)
      .values({
        propertyId,
        buyerId,
        requestKey,
        transferId: payment.transferId,
        price: property.price,
      })
      .returning();
    if (updated[0] === undefined || written[0] === undefined)
      throw new Error('Incomplete property purchase.');
    return {
      ok: true as const,
      data: { property: updated[0], receiptId: written[0].id, alreadyDone: false },
    };
  });
}

export interface BusinessSettings {
  readonly businessName: string;
  readonly description: string;
  readonly access: 'nobody' | 'welcomed' | 'everyone';
  readonly published: boolean;
  readonly floorStyle: 'oak' | 'stone' | 'tile';
  readonly wallStyle: 'cream' | 'teal' | 'rose';
}

export async function configureBusiness(
  db: Database,
  ownerId: string,
  propertyId: string,
  settings: BusinessSettings,
): Promise<PropertyResult<Property>> {
  const name = settings.businessName.trim();
  if (
    name.length < 3 ||
    name.length > 48 ||
    settings.description.length > 300 ||
    [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    !['nobody', 'welcomed', 'everyone'].includes(settings.access) ||
    !['oak', 'stone', 'tile'].includes(settings.floorStyle) ||
    !['cream', 'teal', 'rose'].includes(settings.wallStyle)
  ) {
    return { ok: false, reason: 'bad-settings' };
  }
  const result = await db
    .update(properties)
    .set({
      businessName: name,
      description: settings.description.trim(),
      access: settings.access,
      published: settings.published,
      floorStyle: settings.floorStyle,
      wallStyle: settings.wallStyle,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(properties.id, propertyId),
        eq(properties.ownerId, ownerId),
        eq(properties.municipal, false),
      ),
    )
    .returning();
  const property = result[0];
  return property === undefined ? { ok: false, reason: 'not-owner' } : { ok: true, data: property };
}
