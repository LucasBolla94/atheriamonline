/**
 * Things you own.
 *
 * The rule from `docs/SPEC.md` section 3.4 — an item instance is in exactly
 * one place, and is never copied — is the whole design of this file. There is
 * one `holderKind`/`holderId` pair on a row, so being in two places is not
 * something the database can express. Moving an item changes those two
 * columns, inside one transaction. Nothing here ever inserts a copy.
 *
 * The starter items are given away rather than sold, because there is no shop:
 * `docs/OPEN_QUESTIONS.md` Q-002 is still open, and nothing in this code
 * assumes an answer.
 */
import { and, eq } from 'drizzle-orm';
import { itemDefinitions, itemInstances, type Database, type ItemInstance } from '@atheriam/db';

/** Any database handle: the pool, or a transaction already in progress. */
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Everything that exists in the world, as kinds.
 *
 * All of it is invented for this project. Nothing is named after, or modelled
 * on, anything from another game — `docs/SPEC.md` section 2.
 */
export const CATALOGUE: ReadonlyArray<{
  id: string;
  name: string;
  kind: 'furniture' | 'trinket';
  description: string;
}> = [
  {
    id: 'oak-stool',
    name: 'Oak stool',
    kind: 'furniture',
    description: 'Three legs, no complaints.',
  },
  {
    id: 'rush-mat',
    name: 'Rush mat',
    kind: 'furniture',
    description: 'Woven from river rushes. Warmer than the floor.',
  },
  {
    id: 'clay-lamp',
    name: 'Clay lamp',
    kind: 'furniture',
    description: 'Burns oil, smells of it too.',
  },
  {
    id: 'long-table',
    name: 'Long table',
    kind: 'furniture',
    description: 'Seats eight, or six who are arguing.',
  },
  {
    id: 'wool-rug',
    name: 'Wool rug',
    kind: 'furniture',
    description: 'Dyed with madder. The red has faded to a friendly rust.',
  },
  {
    id: 'copper-pin',
    name: 'Copper pin',
    kind: 'trinket',
    description: 'Holds a cloak shut. Turns your skin green.',
  },
  {
    id: 'river-stone',
    name: 'River stone',
    kind: 'trinket',
    description: 'Flat, grey, and pleasing to hold.',
  },
  {
    id: 'brass-bell',
    name: 'Brass bell',
    kind: 'trinket',
    description: 'Small, and louder than it has any right to be.',
  },
];

/** What a new character starts with, so their first inventory is not empty. */
export const STARTER_ITEMS: readonly string[] = ['oak-stool', 'rush-mat', 'copper-pin'];

/**
 * Make sure every kind in the catalogue exists in the database.
 *
 * Run on start-up. Adding a kind to the list above is all it takes to add it
 * to the game; nothing has to be written by hand into the database.
 */
export async function ensureCatalogue(db: Database): Promise<void> {
  for (const definition of CATALOGUE) {
    await db
      .insert(itemDefinitions)
      .values(definition)
      .onConflictDoUpdate({
        target: itemDefinitions.id,
        set: {
          name: definition.name,
          kind: definition.kind,
          description: definition.description,
        },
      });
  }
}

/**
 * Bring a new item into the world, held by a character.
 *
 * This is the only place an item instance is created. Everything else moves
 * one that already exists.
 */
export async function createItemFor(
  db: Executor,
  definitionId: string,
  characterId: string,
): Promise<ItemInstance> {
  const written = await db
    .insert(itemInstances)
    .values({ definitionId, holderKind: 'character', holderId: characterId })
    .returning();

  const instance = written[0];
  if (instance === undefined) throw new Error('The item was not written.');
  return instance;
}

/** Give a new character the few things they start with. */
export async function giveStarterItems(db: Executor, characterId: string): Promise<void> {
  for (const definitionId of STARTER_ITEMS) {
    await createItemFor(db, definitionId, characterId);
  }
}

/** One thing in somebody's inventory, as a player sees it. */
export interface InventoryItem {
  readonly id: string;
  readonly definitionId: string;
  readonly name: string;
  readonly kind: string;
  readonly description: string;
}

/** What a character is carrying. */
export async function inventoryOf(db: Executor, characterId: string): Promise<InventoryItem[]> {
  const rows = await db
    .select({
      id: itemInstances.id,
      definitionId: itemDefinitions.id,
      name: itemDefinitions.name,
      kind: itemDefinitions.kind,
      description: itemDefinitions.description,
      createdAt: itemInstances.createdAt,
    })
    .from(itemInstances)
    .innerJoin(itemDefinitions, eq(itemDefinitions.id, itemInstances.definitionId))
    .where(and(eq(itemInstances.holderKind, 'character'), eq(itemInstances.holderId, characterId)))
    .orderBy(itemInstances.createdAt);

  return rows.map((row) => ({
    id: row.id,
    definitionId: row.definitionId,
    name: row.name,
    kind: row.kind,
    description: row.description,
  }));
}

/** Where an item can be. */
export interface Holder {
  readonly kind: 'character' | 'house' | 'escrow';
  readonly id: string;
}

/**
 * Move one item from one holder to another.
 *
 * Returns false when the item was not where the caller believed it was —
 * because somebody else moved it first. The `WHERE` clause carries the
 * expected holder, so the check and the move are one statement and cannot be
 * raced: two people cannot both take the same item out of the same place.
 *
 * There is no copy here, and there is no delete-then-insert. One row changes
 * two columns.
 */
export async function moveItem(
  tx: Executor,
  itemId: string,
  from: Holder,
  to: Holder,
): Promise<boolean> {
  const moved = await tx
    .update(itemInstances)
    .set({
      holderKind: to.kind,
      holderId: to.id,
      updatedAt: new Date(),
      // Leaving a house means forgetting where it stood in it.
      ...(to.kind === 'house' ? {} : { x: null, y: null, rotation: 0 }),
    })
    .where(
      and(
        eq(itemInstances.id, itemId),
        eq(itemInstances.holderKind, from.kind),
        eq(itemInstances.holderId, from.id),
      ),
    )
    .returning({ id: itemInstances.id });

  return moved.length === 1;
}

/** How many items exist in the whole world. Used to prove none are lost. */
export async function countItems(db: Executor): Promise<number> {
  const rows = await db.select({ id: itemInstances.id }).from(itemInstances);
  return rows.length;
}
