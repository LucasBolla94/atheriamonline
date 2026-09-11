/**
 * Money and items, against a real database.
 *
 * These are the tests `docs/SPEC.md` section 13 asks for by name: proof that
 * money and items are conserved. They are written to be believed rather than
 * to be passed — several of them do the racing thing on purpose and check that
 * the database refuses it.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { connect, type DatabaseHandle } from '@atheriam/db';
import { MINT, SINK, crowns, playerAccount } from '@atheriam/economy';
import { testDatabaseUrl } from '../../../test/integration-setup.js';
import { balanceOf, ledgerSum, move, purseOf } from './economy.js';
import {
  CATALOGUE,
  countItems,
  createItemFor,
  ensureCatalogue,
  inventoryOf,
  moveItem,
} from './items.js';
import { DAILY_CROWNS, WELCOME_CROWNS, grantDailyReward, grantWelcome } from './gifts.js';

const handle: DatabaseHandle = connect(testDatabaseUrl(), 4);
const db = handle.db;

/** A character row, which items and purses need to point at. */
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

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE ledger_entries, transfers, item_instances, characters, accounts RESTART IDENTITY CASCADE`,
  );
  await ensureCatalogue(db);
});

afterAll(async () => {
  await handle.close();
});

describe('moving money', () => {
  it('writes two rows that sum to zero', async () => {
    const aldric = await makeCharacter('Aldric');

    const result = await move(db, {
      from: MINT,
      to: playerAccount(aldric),
      amount: crowns(10),
      reason: 'a test',
      idempotencyKey: 'test-1',
    });

    expect(result.ok).toBe(true);
    expect(await purseOf(db, aldric)).toBe(crowns(10));
    expect(await balanceOf(db, MINT)).toBe(-crowns(10));
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('moves money once, however many times the same request arrives', async () => {
    const aldric = await makeCharacter('Aldric');

    for (let i = 0; i < 5; i += 1) {
      const result = await move(db, {
        from: MINT,
        to: playerAccount(aldric),
        amount: crowns(10),
        reason: 'a test',
        idempotencyKey: 'the-same-key',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.alreadyDone).toBe(i > 0);
    }

    expect(await purseOf(db, aldric)).toBe(crowns(10));
  });

  it('moves money once when the same request arrives all at once', async () => {
    const aldric = await makeCharacter('Aldric');

    // Five requests racing, as they would from a player tapping a button on a
    // slow connection. Only one may land.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        move(db, {
          from: MINT,
          to: playerAccount(aldric),
          amount: crowns(10),
          reason: 'a test',
          idempotencyKey: 'racing-key',
        }),
      ),
    );

    // Some may fail outright on the unique index; none may pay twice.
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(await purseOf(db, aldric)).toBe(crowns(10));
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('refuses to let a player spend what they do not have', async () => {
    const aldric = await makeCharacter('Aldric');
    const bryn = await makeCharacter('Bryn');

    await move(db, {
      from: MINT,
      to: playerAccount(aldric),
      amount: crowns(5),
      reason: 'a test',
      idempotencyKey: 'fund',
    });

    const result = await move(db, {
      from: playerAccount(aldric),
      to: playerAccount(bryn),
      amount: crowns(50),
      reason: 'a test',
      idempotencyKey: 'too-much',
    });

    expect(result).toEqual({ ok: false, reason: 'not-enough-money' });
    expect(await purseOf(db, aldric)).toBe(crowns(5));
    expect(await purseOf(db, bryn)).toBe(0n);
  });

  it('lets a player spend the same Crown only once, however fast they ask', async () => {
    const aldric = await makeCharacter('Aldric');
    const bryn = await makeCharacter('Bryn');
    const cara = await makeCharacter('Cara');

    await move(db, {
      from: MINT,
      to: playerAccount(aldric),
      amount: crowns(10),
      reason: 'a test',
      idempotencyKey: 'fund',
    });

    // Two different payments of ten, from a purse holding ten, at the same
    // moment. Exactly one may succeed.
    const [toBryn, toCara] = await Promise.all([
      move(db, {
        from: playerAccount(aldric),
        to: playerAccount(bryn),
        amount: crowns(10),
        reason: 'a test',
        idempotencyKey: 'spend-1',
      }),
      move(db, {
        from: playerAccount(aldric),
        to: playerAccount(cara),
        amount: crowns(10),
        reason: 'a test',
        idempotencyKey: 'spend-2',
      }),
    ]);

    const succeeded = [toBryn, toCara].filter((result) => result.ok).length;
    expect(succeeded).toBe(1);
    expect(await purseOf(db, aldric)).toBe(0n);
    expect(await purseOf(db, bryn)).toBe(toBryn.ok ? crowns(10) : 0n);
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('keeps the books at zero through a busy evening', async () => {
    const aldric = await makeCharacter('Aldric');
    const bryn = await makeCharacter('Bryn');

    await move(db, {
      from: MINT,
      to: playerAccount(aldric),
      amount: crowns(100),
      reason: 'a test',
      idempotencyKey: 'fund-a',
    });

    for (let i = 0; i < 20; i += 1) {
      await move(db, {
        from: playerAccount(aldric),
        to: playerAccount(bryn),
        amount: crowns(1),
        reason: 'a round of drinks',
        idempotencyKey: `drink-${i}`,
      });
      await move(db, {
        from: playerAccount(bryn),
        to: SINK,
        amount: crowns(1),
        reason: 'a tax',
        idempotencyKey: `tax-${i}`,
      });
    }

    expect(await ledgerSum(db)).toBe(0n);
    expect(await purseOf(db, aldric)).toBe(crowns(80));
    expect(await purseOf(db, bryn)).toBe(0n);
    expect(await balanceOf(db, SINK)).toBe(crowns(20));
  });

  it('refuses a movement with no reason, before anything is written', async () => {
    const aldric = await makeCharacter('Aldric');
    const result = await move(db, {
      from: MINT,
      to: playerAccount(aldric),
      amount: crowns(1),
      reason: '   ',
      idempotencyKey: 'no-reason',
    });
    expect(result.ok).toBe(false);
    expect(await ledgerSum(db)).toBe(0n);
  });
});

describe('the gifts that create money', () => {
  it('gives a new character a purse and their belongings', async () => {
    const aldric = await makeCharacter('Aldric');
    await grantWelcome(db, aldric);

    expect(await purseOf(db, aldric)).toBe(WELCOME_CROWNS);
    expect(await inventoryOf(db, aldric)).toHaveLength(3);
  });

  it('gives them once, however many times somebody logs in', async () => {
    const aldric = await makeCharacter('Aldric');
    await grantWelcome(db, aldric);
    await grantWelcome(db, aldric);
    await grantWelcome(db, aldric);

    expect(await purseOf(db, aldric)).toBe(WELCOME_CROWNS);
    expect(await inventoryOf(db, aldric)).toHaveLength(3);
  });

  it('pays the daily reward once a day, not once a click', async () => {
    const aldric = await makeCharacter('Aldric');
    const monday = new Date('2026-09-07T10:00:00Z');

    const first = await grantDailyReward(db, aldric, monday);
    const second = await grantDailyReward(db, aldric, new Date('2026-09-07T23:59:00Z'));

    expect(first).toMatchObject({ ok: true, alreadyClaimed: false });
    expect(second).toMatchObject({ ok: true, alreadyClaimed: true });
    expect(await purseOf(db, aldric)).toBe(DAILY_CROWNS);

    const tuesday = await grantDailyReward(db, aldric, new Date('2026-09-08T00:01:00Z'));
    expect(tuesday).toMatchObject({ ok: true, alreadyClaimed: false });
    expect(await purseOf(db, aldric)).toBe(DAILY_CROWNS * 2n);
  });

  it('leaves the mint exactly as negative as the money it created', async () => {
    const aldric = await makeCharacter('Aldric');
    const bryn = await makeCharacter('Bryn');
    await grantWelcome(db, aldric);
    await grantWelcome(db, bryn);

    expect(await balanceOf(db, MINT)).toBe(-(WELCOME_CROWNS * 2n));
    expect(await ledgerSum(db)).toBe(0n);
  });
});

describe('items', () => {
  it('knows every kind in the catalogue', async () => {
    const aldric = await makeCharacter('Aldric');
    for (const definition of CATALOGUE) {
      await createItemFor(db, definition.id, aldric);
    }
    expect(await inventoryOf(db, aldric)).toHaveLength(CATALOGUE.length);
  });

  it('moves an item without ever making a second one', async () => {
    const aldric = await makeCharacter('Aldric');
    const bryn = await makeCharacter('Bryn');
    const stool = await createItemFor(db, 'oak-stool', aldric);

    const before = await countItems(db);
    const moved = await moveItem(
      db,
      stool.id,
      { kind: 'character', id: aldric },
      { kind: 'character', id: bryn },
    );

    expect(moved).toBe(true);
    expect(await countItems(db)).toBe(before);
    expect(await inventoryOf(db, aldric)).toHaveLength(0);
    expect(await inventoryOf(db, bryn)).toHaveLength(1);
  });

  it('refuses to move an item that is not where the caller thinks it is', async () => {
    const aldric = await makeCharacter('Aldric');
    const bryn = await makeCharacter('Bryn');
    const stool = await createItemFor(db, 'oak-stool', aldric);

    const moved = await moveItem(
      db,
      stool.id,
      { kind: 'character', id: bryn },
      { kind: 'character', id: bryn },
    );

    expect(moved).toBe(false);
    expect(await inventoryOf(db, aldric)).toHaveLength(1);
  });

  it('lets only one of two people take the same item', async () => {
    const aldric = await makeCharacter('Aldric');
    const bryn = await makeCharacter('Bryn');
    const cara = await makeCharacter('Cara');
    const stool = await createItemFor(db, 'oak-stool', aldric);

    // Both try to take it out of Aldric's hands at the same moment. The
    // `WHERE` clause carries where it was, so the loser changes nothing.
    const [toBryn, toCara] = await Promise.all([
      moveItem(db, stool.id, { kind: 'character', id: aldric }, { kind: 'character', id: bryn }),
      moveItem(db, stool.id, { kind: 'character', id: aldric }, { kind: 'character', id: cara }),
    ]);

    expect([toBryn, toCara].filter(Boolean)).toHaveLength(1);
    expect(await countItems(db)).toBe(1);
    const held = (await inventoryOf(db, bryn)).length + (await inventoryOf(db, cara)).length;
    expect(held).toBe(1);
  });

  it('never loses an item, however many times it changes hands', async () => {
    const people = [
      await makeCharacter('Aldric'),
      await makeCharacter('Bryn'),
      await makeCharacter('Cara'),
    ];
    const stool = await createItemFor(db, 'oak-stool', people[0] ?? '');

    let holder = people[0] ?? '';
    for (let i = 1; i <= 30; i += 1) {
      const next = people[i % people.length] ?? '';
      const moved = await moveItem(
        db,
        stool.id,
        { kind: 'character', id: holder },
        { kind: 'character', id: next },
      );
      expect(moved).toBe(true);
      holder = next;
    }

    expect(await countItems(db)).toBe(1);
  });
});
