/**
 * Houses, against a real database.
 *
 * The rule under test throughout is the same one as everywhere else: placing
 * furniture **moves** the item, it never copies it. Every test here ends by
 * counting the items in the world.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { connect, type DatabaseHandle } from '@atheriam/db';
import { HOUSE_ENTRANCE, canPlaceFurniture } from '@atheriam/shared';
import { testDatabaseUrl } from '../../../test/integration-setup.js';
import { countItems, createItemFor, ensureCatalogue, inventoryOf } from './items.js';
import {
  contentsOf,
  houseOf,
  mayEnter,
  place,
  rotate,
  setAccess,
  takeBack,
  unwelcome,
  welcome,
  welcomedNames,
} from './houses.js';

const handle: DatabaseHandle = connect(testDatabaseUrl(), 4);
const db = handle.db;

async function makeCharacter(name: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH new_account AS (
      INSERT INTO accounts (email, email_normalised, password_hash, date_of_birth)
      VALUES (${name}, ${name.toLowerCase()}, 'not-a-real-hash', '1990-05-04')
      RETURNING id
    )
    INSERT INTO characters (account_id, name, name_normalised, x, y)
    SELECT id, ${name}, ${name.toLowerCase()}, 64, 69 FROM new_account
    RETURNING id
  `);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('No character was made.');
  return id;
}

let aldric = '';
let bryn = '';

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE house_guests, houses, item_instances, characters, accounts RESTART IDENTITY CASCADE`,
  );
  await ensureCatalogue(db);
  aldric = await makeCharacter('Aldric');
  bryn = await makeCharacter('Bryn');
});

afterAll(async () => {
  await handle.close();
});

describe('having a house', () => {
  it('gives everybody one, without being asked twice', async () => {
    const first = await houseOf(db, aldric);
    const second = await houseOf(db, aldric);
    expect(second.id).toBe(first.id);
  });

  it('makes only one house when two logins arrive at once', async () => {
    const [a, b] = await Promise.all([houseOf(db, bryn), houseOf(db, bryn)]);
    expect(a.id).toBe(b.id);
  });

  it('starts with the door open to people you have welcomed', async () => {
    const house = await houseOf(db, aldric);
    expect(house.access).toBe('welcomed');
  });
});

describe('who may come in', () => {
  it('always lets the owner in', async () => {
    await setAccess(db, aldric, 'nobody');
    const house = await houseOf(db, aldric);
    expect(await mayEnter(db, house, aldric)).toBe(true);
  });

  it('keeps everybody else out when the door is shut', async () => {
    await setAccess(db, aldric, 'nobody');
    const house = await houseOf(db, aldric);
    expect(await mayEnter(db, house, bryn)).toBe(false);
  });

  it('lets anybody in when it is open to everyone', async () => {
    await setAccess(db, aldric, 'everyone');
    const house = await houseOf(db, aldric);
    expect(await mayEnter(db, house, bryn)).toBe(true);
  });

  it('lets in exactly the people who were welcomed', async () => {
    const cara = await makeCharacter('Cara');
    await setAccess(db, aldric, 'welcomed');
    await welcome(db, aldric, bryn);

    const house = await houseOf(db, aldric);
    expect(await mayEnter(db, house, bryn)).toBe(true);
    expect(await mayEnter(db, house, cara)).toBe(false);
    expect(await welcomedNames(db, house.id)).toEqual(['Bryn']);
  });

  it('shuts the door again when somebody is unwelcomed', async () => {
    await welcome(db, aldric, bryn);
    await unwelcome(db, aldric, bryn);

    const house = await houseOf(db, aldric);
    expect(await mayEnter(db, house, bryn)).toBe(false);
  });

  it('is the same whether somebody is welcomed once or twice', async () => {
    await welcome(db, aldric, bryn);
    await welcome(db, aldric, bryn);
    const house = await houseOf(db, aldric);
    expect(await welcomedNames(db, house.id)).toEqual(['Bryn']);
  });
});

describe('furnishing a house', () => {
  it('moves the item out of the inventory and into the house', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const before = await countItems(db);

    const placed = await place(db, aldric, stool.id, 5, 5, 0);
    expect(placed.ok).toBe(true);

    expect(await inventoryOf(db, aldric)).toHaveLength(0);
    const house = await houseOf(db, aldric);
    expect(await contentsOf(db, house.id)).toHaveLength(1);

    // The thing that must never change.
    expect(await countItems(db)).toBe(before);
  });

  it('brings it back to the inventory when it is picked up', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    await place(db, aldric, stool.id, 5, 5, 0);
    const taken = await takeBack(db, aldric, stool.id);

    expect(taken.ok).toBe(true);
    expect(await inventoryOf(db, aldric)).toHaveLength(1);
    expect(await countItems(db)).toBe(1);
  });

  it('refuses to stand two things on one tile', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const mat = await createItemFor(db, 'rush-mat', aldric);

    await place(db, aldric, stool.id, 5, 5, 0);
    expect(await place(db, aldric, mat.id, 5, 5, 0)).toEqual({ ok: false, reason: 'tile-taken' });

    expect(await inventoryOf(db, aldric)).toHaveLength(1);
  });

  it('refuses to stand anything in a wall or a doorway', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);

    expect(await place(db, aldric, stool.id, 0, 0, 0)).toEqual({ ok: false, reason: 'bad-place' });
    expect(await place(db, aldric, stool.id, 7, 9, 0)).toEqual({ ok: false, reason: 'bad-place' });
    // The doorway is where the entrance is, and it must stay clear.
    expect(canPlaceFurniture(HOUSE_ENTRANCE)).toBe(true);
  });

  it('refuses a trinket, which is carried rather than stood on the floor', async () => {
    const pin = await createItemFor(db, 'copper-pin', aldric);
    expect(await place(db, aldric, pin.id, 5, 5, 0)).toEqual({
      ok: false,
      reason: 'not-furniture',
    });
  });

  it("refuses somebody else's item", async () => {
    const stool = await createItemFor(db, 'oak-stool', bryn);
    expect(await place(db, aldric, stool.id, 5, 5, 0)).toEqual({
      ok: false,
      reason: 'not-your-item',
    });
  });

  it('turns furniture in quarters and refuses anything else', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    await place(db, aldric, stool.id, 5, 5, 0);

    expect((await rotate(db, aldric, stool.id, 90)).ok).toBe(true);
    expect(await rotate(db, aldric, stool.id, 45)).toEqual({ ok: false, reason: 'bad-rotation' });

    const house = await houseOf(db, aldric);
    expect((await contentsOf(db, house.id))[0]?.rotation).toBe(90);
  });

  it("will not let somebody rearrange another person's house", async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    await place(db, aldric, stool.id, 5, 5, 0);

    expect(await rotate(db, bryn, stool.id, 90)).toEqual({ ok: false, reason: 'not-your-item' });
    expect(await takeBack(db, bryn, stool.id)).toEqual({ ok: false, reason: 'not-your-item' });

    const house = await houseOf(db, aldric);
    expect(await contentsOf(db, house.id)).toHaveLength(1);
  });

  it('never makes a second item, however much furniture is moved about', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);

    for (let i = 0; i < 10; i += 1) {
      await place(db, aldric, stool.id, 3 + (i % 5), 4, 0);
      await takeBack(db, aldric, stool.id);
    }

    expect(await countItems(db)).toBe(1);
    expect(await inventoryOf(db, aldric)).toHaveLength(1);
  });
});
