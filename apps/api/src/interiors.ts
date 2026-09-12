/** Access and furniture changes for public venues and player businesses. */
import { and, eq } from 'drizzle-orm';
import {
  mayEnterProperty,
  characters,
  properties,
  propertyGuests,
  itemInstances,
  itemDefinitions,
  type Database,
  type Property,
} from '@atheriam/db';
import { canDecorateInterior, isRotation } from '@atheriam/shared';
import { contentsOf, type PlacedItem } from './houses.js';
import { moveItem } from './items.js';

export { mayEnterProperty } from '@atheriam/db';

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
export type InteriorFailure =
  | 'not-owner'
  | 'not-welcome'
  | 'no-such-property'
  | 'no-such-character'
  | 'not-your-item'
  | 'not-furniture'
  | 'bad-place'
  | 'bad-rotation'
  | 'tile-taken';
export type InteriorResult<T> = { ok: true; data: T } | { ok: false; reason: InteriorFailure };

export async function propertyGuestNames(db: Executor, propertyId: string): Promise<string[]> {
  const guests = await db
    .select({ name: characters.name })
    .from(propertyGuests)
    .innerJoin(characters, eq(characters.id, propertyGuests.characterId))
    .where(eq(propertyGuests.propertyId, propertyId))
    .orderBy(characters.name);
  return guests.map((guest) => guest.name);
}

export async function setPropertyGuest(
  db: Database,
  ownerId: string,
  propertyId: string,
  guestId: string,
  welcomed: boolean,
): Promise<InteriorResult<string[]>> {
  return db.transaction(async (tx) => {
    const property = (
      await tx.select().from(properties).where(eq(properties.id, propertyId)).for('update')
    )[0];
    if (property === undefined) return { ok: false as const, reason: 'no-such-property' as const };
    if (property.municipal || property.ownerId !== ownerId)
      return { ok: false as const, reason: 'not-owner' as const };
    const guest = (
      await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, guestId))
        .limit(1)
    )[0];
    if (guest === undefined) return { ok: false as const, reason: 'no-such-character' as const };
    if (welcomed)
      await tx
        .insert(propertyGuests)
        .values({ propertyId, characterId: guestId })
        .onConflictDoNothing();
    else
      await tx
        .delete(propertyGuests)
        .where(
          and(eq(propertyGuests.propertyId, propertyId), eq(propertyGuests.characterId, guestId)),
        );
    return { ok: true as const, data: await propertyGuestNames(tx, propertyId) };
  });
}

export interface InteriorView {
  readonly id: string;
  readonly name: string;
  readonly yours: boolean;
  readonly municipal: boolean;
  readonly access: Property['access'];
  readonly floorStyle: string;
  readonly wallStyle: string;
  readonly guests: string[];
  readonly contents: PlacedItem[];
}

export async function viewInterior(
  db: Database,
  propertyId: string,
  visitorId: string,
): Promise<InteriorResult<InteriorView>> {
  return db.transaction(async (tx) => {
    // Access and the view belong to one locked snapshot, so revocation cannot
    // race a furniture read into revealing a newly private interior.
    const property = (
      await tx.select().from(properties).where(eq(properties.id, propertyId)).for('share')
    )[0];
    if (property === undefined) return { ok: false as const, reason: 'no-such-property' as const };
    if (!(await mayEnterProperty(tx, property, visitorId)))
      return { ok: false as const, reason: 'not-welcome' as const };
    return {
      ok: true as const,
      data: {
        id: property.id,
        name: property.businessName,
        yours: property.ownerId === visitorId,
        municipal: property.municipal,
        access: property.access,
        floorStyle: property.floorStyle,
        wallStyle: property.wallStyle,
        guests: property.ownerId === visitorId ? await propertyGuestNames(tx, propertyId) : [],
        contents: await contentsOf(tx, propertyId),
      },
    };
  });
}

export type DecorationIntent =
  | { action: 'place'; itemId: string; x: number; y: number; rotation: number }
  | { action: 'rotate'; itemId: string; rotation: number }
  | { action: 'take'; itemId: string };

/** Every edit locks the property, then moves the existing instance atomically. */
export async function decorateInterior(
  db: Database,
  ownerId: string,
  propertyId: string,
  intent: DecorationIntent,
): Promise<InteriorResult<PlacedItem[]>> {
  if (intent.action !== 'take' && !isRotation(intent.rotation))
    return { ok: false, reason: 'bad-rotation' };
  if (intent.action === 'place' && !canDecorateInterior(intent))
    return { ok: false, reason: 'bad-place' };
  return db.transaction(async (tx) => {
    const property = (
      await tx.select().from(properties).where(eq(properties.id, propertyId)).for('update')
    )[0];
    if (property === undefined) return { ok: false as const, reason: 'no-such-property' as const };
    if (property.municipal || property.ownerId !== ownerId)
      return { ok: false as const, reason: 'not-owner' as const };
    if (intent.action === 'place') {
      const kind = (
        await tx
          .select({ kind: itemDefinitions.kind })
          .from(itemInstances)
          .innerJoin(itemDefinitions, eq(itemDefinitions.id, itemInstances.definitionId))
          .where(eq(itemInstances.id, intent.itemId))
          .limit(1)
      )[0]?.kind;
      if (kind !== 'furniture') return { ok: false as const, reason: 'not-furniture' as const };
      const occupied =
        (
          await tx
            .select({ id: itemInstances.id })
            .from(itemInstances)
            .where(
              and(
                eq(itemInstances.holderKind, 'house'),
                eq(itemInstances.holderId, propertyId),
                eq(itemInstances.x, intent.x),
                eq(itemInstances.y, intent.y),
              ),
            )
            .limit(1)
        ).length > 0;
      if (occupied) return { ok: false as const, reason: 'tile-taken' as const };
      if (
        !(await moveItem(
          tx,
          intent.itemId,
          { kind: 'character', id: ownerId },
          { kind: 'house', id: propertyId },
        ))
      )
        return { ok: false as const, reason: 'not-your-item' as const };
      await tx
        .update(itemInstances)
        .set({ x: intent.x, y: intent.y, rotation: intent.rotation, updatedAt: new Date() })
        .where(eq(itemInstances.id, intent.itemId));
    } else if (intent.action === 'rotate') {
      const changed = await tx
        .update(itemInstances)
        .set({ rotation: intent.rotation, updatedAt: new Date() })
        .where(
          and(
            eq(itemInstances.id, intent.itemId),
            eq(itemInstances.holderKind, 'house'),
            eq(itemInstances.holderId, propertyId),
          ),
        )
        .returning({ id: itemInstances.id });
      if (changed.length === 0) return { ok: false as const, reason: 'not-your-item' as const };
    } else if (
      !(await moveItem(
        tx,
        intent.itemId,
        { kind: 'house', id: propertyId },
        { kind: 'character', id: ownerId },
      ))
    ) {
      return { ok: false as const, reason: 'not-your-item' as const };
    }
    return { ok: true as const, data: await contentsOf(tx, propertyId) };
  });
}
