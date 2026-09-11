/**
 * Houses: who owns one, who may come in, and what is in it.
 *
 * The rule that matters most here is the one from `docs/SPEC.md` section 3.4,
 * and it is the same rule as everywhere else: **placing furniture moves the
 * item instance, it does not copy it**. A stool in a house is the same row in
 * `item_instances` that was in the inventory a moment ago, with a different
 * holder and a position. Taking it back changes those columns again.
 *
 * Access is three plain settings rather than a system of permissions:
 *
 *   nobody    — only the owner;
 *   welcomed  — the owner and the people on their list;
 *   everyone  — anybody in the city.
 *
 * "welcomed" is a list the owner keeps by hand, not a two-way friendship.
 * Friendship is a feature of its own, and a house does not need one to be
 * useful — see D-054.
 */
import { and, eq } from 'drizzle-orm';
import {
  characters,
  houseGuests,
  houses,
  itemDefinitions,
  itemInstances,
  type Database,
  type House,
} from '@atheriam/db';
import { canPlaceFurniture, isRotation } from '@atheriam/shared';
import { moveItem } from './items.js';

/** Any database handle: the pool, or a transaction already in progress. */
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export type HouseFailure =
  | 'no-such-house'
  | 'not-your-house'
  | 'not-welcome'
  | 'not-your-item'
  | 'not-furniture'
  | 'tile-taken'
  | 'bad-place'
  | 'bad-rotation';

export type HouseResult<T> = { ok: true; data: T } | { ok: false; reason: HouseFailure };

/**
 * The house belonging to this character, making one if they have none.
 *
 * Everybody gets a house. There is nothing to buy and nothing to unlock: a
 * place of your own is part of being in the city, not a reward.
 */
export async function houseOf(db: Database, characterId: string): Promise<House> {
  const existing = await db.select().from(houses).where(eq(houses.ownerId, characterId)).limit(1);
  const found = existing[0];
  if (found !== undefined) return found;

  const written = await db
    .insert(houses)
    .values({ ownerId: characterId })
    .onConflictDoNothing()
    .returning();

  const made = written[0];
  if (made !== undefined) return made;

  // Two logins at once: the other one made it. Read it back.
  const again = await db.select().from(houses).where(eq(houses.ownerId, characterId)).limit(1);
  const settled = again[0];
  if (settled === undefined) throw new Error('The house was neither made nor found.');
  return settled;
}

export async function houseById(db: Executor, houseId: string): Promise<House | null> {
  const found = await db.select().from(houses).where(eq(houses.id, houseId)).limit(1);
  return found[0] ?? null;
}

/** May this person come in? */
export async function mayEnter(db: Executor, house: House, visitorId: string): Promise<boolean> {
  if (house.ownerId === visitorId) return true;
  if (house.access === 'everyone') return true;
  if (house.access === 'nobody') return false;

  const welcomed = await db
    .select({ id: houseGuests.id })
    .from(houseGuests)
    .where(and(eq(houseGuests.houseId, house.id), eq(houseGuests.characterId, visitorId)))
    .limit(1);
  return welcomed.length > 0;
}

/** Change who may come in. */
export async function setAccess(
  db: Database,
  characterId: string,
  access: House['access'],
): Promise<House> {
  const house = await houseOf(db, characterId);
  const updated = await db
    .update(houses)
    .set({ access, updatedAt: new Date() })
    .where(eq(houses.id, house.id))
    .returning();
  return updated[0] ?? house;
}

/** Add somebody to the list of people who may come in. */
export async function welcome(
  db: Database,
  ownerId: string,
  guestId: string,
): Promise<HouseResult<House>> {
  if (ownerId === guestId) return { ok: false, reason: 'not-your-house' };
  const house = await houseOf(db, ownerId);
  await db
    .insert(houseGuests)
    .values({ houseId: house.id, characterId: guestId })
    .onConflictDoNothing();
  return { ok: true, data: house };
}

/** Take somebody off the list. */
export async function unwelcome(
  db: Database,
  ownerId: string,
  guestId: string,
): Promise<HouseResult<House>> {
  const house = await houseOf(db, ownerId);
  await db
    .delete(houseGuests)
    .where(and(eq(houseGuests.houseId, house.id), eq(houseGuests.characterId, guestId)));
  return { ok: true, data: house };
}

/** Everybody the owner has welcomed, by name. */
export async function welcomedNames(db: Executor, houseId: string): Promise<string[]> {
  const rows = await db
    .select({ name: characters.name })
    .from(houseGuests)
    .innerJoin(characters, eq(characters.id, houseGuests.characterId))
    .where(eq(houseGuests.houseId, houseId))
    .orderBy(characters.name);
  return rows.map((row) => row.name);
}

/** One piece of furniture standing in a house. */
export interface PlacedItem {
  readonly id: string;
  readonly definitionId: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/** Everything standing in a house. */
export async function contentsOf(db: Executor, houseId: string): Promise<PlacedItem[]> {
  const rows = await db
    .select({
      id: itemInstances.id,
      definitionId: itemInstances.definitionId,
      name: itemDefinitions.name,
      x: itemInstances.x,
      y: itemInstances.y,
      rotation: itemInstances.rotation,
    })
    .from(itemInstances)
    .innerJoin(itemDefinitions, eq(itemDefinitions.id, itemInstances.definitionId))
    .where(and(eq(itemInstances.holderKind, 'house'), eq(itemInstances.holderId, houseId)));

  return rows.map((row) => ({
    id: row.id,
    definitionId: row.definitionId,
    name: row.name,
    x: row.x ?? 0,
    y: row.y ?? 0,
    rotation: row.rotation,
  }));
}

/**
 * Put a piece of furniture down.
 *
 * The item moves out of the inventory and into the house. There is no copy
 * anywhere in this function, and the move carries the check that the person
 * really had it.
 */
export async function place(
  db: Database,
  ownerId: string,
  itemId: string,
  x: number,
  y: number,
  rotation: number,
): Promise<HouseResult<PlacedItem[]>> {
  if (!isRotation(rotation)) return { ok: false, reason: 'bad-rotation' };
  if (!canPlaceFurniture({ x, y })) return { ok: false, reason: 'bad-place' };

  const house = await houseOf(db, ownerId);

  return db.transaction(async (tx) => {
    const definition = await tx
      .select({ kind: itemDefinitions.kind })
      .from(itemInstances)
      .innerJoin(itemDefinitions, eq(itemDefinitions.id, itemInstances.definitionId))
      .where(eq(itemInstances.id, itemId))
      .limit(1);

    if (definition[0]?.kind !== 'furniture') {
      return { ok: false as const, reason: 'not-furniture' as const };
    }

    const standing = await tx
      .select({ id: itemInstances.id })
      .from(itemInstances)
      .where(
        and(
          eq(itemInstances.holderKind, 'house'),
          eq(itemInstances.holderId, house.id),
          eq(itemInstances.x, x),
          eq(itemInstances.y, y),
        ),
      )
      .limit(1);

    if (standing.length > 0) return { ok: false as const, reason: 'tile-taken' as const };

    const moved = await moveItem(
      tx,
      itemId,
      { kind: 'character', id: ownerId },
      { kind: 'house', id: house.id },
    );
    if (!moved) return { ok: false as const, reason: 'not-your-item' as const };

    await tx
      .update(itemInstances)
      .set({ x, y, rotation, updatedAt: new Date() })
      .where(eq(itemInstances.id, itemId));

    return { ok: true as const, data: await contentsOf(tx, house.id) };
  });
}

/** Turn a piece of furniture on the spot. */
export async function rotate(
  db: Database,
  ownerId: string,
  itemId: string,
  rotation: number,
): Promise<HouseResult<PlacedItem[]>> {
  if (!isRotation(rotation)) return { ok: false, reason: 'bad-rotation' };
  const house = await houseOf(db, ownerId);

  const turned = await db
    .update(itemInstances)
    .set({ rotation, updatedAt: new Date() })
    .where(
      and(
        eq(itemInstances.id, itemId),
        eq(itemInstances.holderKind, 'house'),
        eq(itemInstances.holderId, house.id),
      ),
    )
    .returning({ id: itemInstances.id });

  if (turned.length === 0) return { ok: false, reason: 'not-your-item' };
  return { ok: true, data: await contentsOf(db, house.id) };
}

/** Pick a piece of furniture back up. */
export async function takeBack(
  db: Database,
  ownerId: string,
  itemId: string,
): Promise<HouseResult<PlacedItem[]>> {
  const house = await houseOf(db, ownerId);

  const moved = await moveItem(
    db,
    itemId,
    { kind: 'house', id: house.id },
    { kind: 'character', id: ownerId },
  );
  if (!moved) return { ok: false, reason: 'not-your-item' };

  return { ok: true, data: await contentsOf(db, house.id) };
}
