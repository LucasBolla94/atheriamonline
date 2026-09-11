/**
 * Trading, against a real database.
 *
 * Several of these are written as an attempt to cheat, because that is what a
 * trade has to survive: confirming and then swapping the item, offering the
 * same thing twice, walking away half way through, or simply both people
 * pressing the button at the same moment.
 *
 * Every one of them ends by counting: the same items exist afterwards, and the
 * whole ledger still sums to zero.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { connect, type DatabaseHandle } from '@atheriam/db';
import { MINT, crowns, playerAccount, tradeEscrow } from '@atheriam/economy';
import { testDatabaseUrl } from '../../../test/integration-setup.js';
import { balanceOf, ledgerSum, move, purseOf } from './economy.js';
import { countItems, createItemFor, ensureCatalogue, inventoryOf } from './items.js';
import {
  cancel,
  cancelTradesOf,
  confirm,
  offerItem,
  offerMoney,
  openTradeOf,
  startTrade,
  tradeById,
  viewOf,
  withdrawItem,
} from './trading.js';

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

async function fund(characterId: string, amount: bigint, key: string): Promise<void> {
  await move(db, {
    from: MINT,
    to: playerAccount(characterId),
    amount,
    reason: 'a test',
    idempotencyKey: key,
  });
}

let aldric = '';
let bryn = '';

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE trade_items, trades, ledger_entries, transfers, item_instances, characters, accounts RESTART IDENTITY CASCADE`,
  );
  await ensureCatalogue(db);
  aldric = await makeCharacter('Aldric');
  bryn = await makeCharacter('Bryn');
});

afterAll(async () => {
  await handle.close();
});

describe('starting a trade', () => {
  it('puts both people into it', async () => {
    const started = await startTrade(db, aldric, bryn);
    expect(started.ok).toBe(true);

    expect(await openTradeOf(db, aldric)).not.toBeNull();
    expect(await openTradeOf(db, bryn)).not.toBeNull();
  });

  it('refuses a second trade while one is open', async () => {
    const cara = await makeCharacter('Cara');
    await startTrade(db, aldric, bryn);

    expect(await startTrade(db, aldric, cara)).toEqual({ ok: false, reason: 'already-trading' });
    expect(await startTrade(db, cara, bryn)).toEqual({ ok: false, reason: 'already-trading' });
  });

  it('refuses to let somebody trade with themselves', async () => {
    expect(await startTrade(db, aldric, aldric)).toEqual({ ok: false, reason: 'not-yourself' });
  });

  it('creates one trade when two invitations cross in the post', async () => {
    const [first, second] = await Promise.allSettled([
      startTrade(db, aldric, bryn),
      startTrade(db, bryn, aldric),
    ]);

    const succeeded = [first, second].filter(
      (result) => result.status === 'fulfilled' && result.value.ok,
    );
    expect(succeeded).toHaveLength(1);
  });
});

describe('putting things on the table', () => {
  it('takes the item out of your hands at once', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    const offered = await offerItem(db, started.data.id, aldric, stool.id);
    expect(offered.ok).toBe(true);

    // It is neither in their hands nor anybody else's: it is on the table.
    expect(await inventoryOf(db, aldric)).toHaveLength(0);
    expect(await inventoryOf(db, bryn)).toHaveLength(0);
    expect(await countItems(db)).toBe(1);
  });

  it('refuses an item somebody does not hold', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    expect(await offerItem(db, started.data.id, bryn, stool.id)).toEqual({
      ok: false,
      reason: 'not-your-item',
    });
  });

  it('gives it back when it is taken off the table', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    await offerItem(db, started.data.id, aldric, stool.id);
    await withdrawItem(db, started.data.id, aldric, stool.id);

    expect(await inventoryOf(db, aldric)).toHaveLength(1);
  });

  it('moves the money into escrow as soon as it is offered', async () => {
    await fund(aldric, crowns(50), 'fund-a');
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    await offerMoney(db, started.data.id, aldric, crowns(20));

    expect(await purseOf(db, aldric)).toBe(crowns(30));
    expect(await balanceOf(db, tradeEscrow(started.data.id))).toBe(crowns(20));
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('treats the amount as a total, so asking twice does not stack up', async () => {
    await fund(aldric, crowns(50), 'fund-a');
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    await offerMoney(db, started.data.id, aldric, crowns(20));
    await offerMoney(db, started.data.id, aldric, crowns(20));

    expect(await purseOf(db, aldric)).toBe(crowns(30));
    expect(await balanceOf(db, tradeEscrow(started.data.id))).toBe(crowns(20));
  });

  it('gives money back when the offer is lowered', async () => {
    await fund(aldric, crowns(50), 'fund-a');
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    await offerMoney(db, started.data.id, aldric, crowns(20));
    await offerMoney(db, started.data.id, aldric, crowns(5));

    expect(await purseOf(db, aldric)).toBe(crowns(45));
    expect(await balanceOf(db, tradeEscrow(started.data.id))).toBe(crowns(5));
  });

  it('refuses money somebody does not have', async () => {
    await fund(aldric, crowns(5), 'fund-a');
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    expect(await offerMoney(db, started.data.id, aldric, crowns(50))).toEqual({
      ok: false,
      reason: 'not-enough-money',
    });
    expect(await purseOf(db, aldric)).toBe(crowns(5));
  });
});

describe('agreeing', () => {
  it('takes both confirmations away whenever anything changes', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const pin = await createItemFor(db, 'copper-pin', bryn);
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');
    const tradeId = started.data.id;

    await offerItem(db, tradeId, aldric, stool.id);
    await offerItem(db, tradeId, bryn, pin.id);
    await confirm(db, tradeId, aldric);

    // This is the oldest trick there is: confirm, then change what you are
    // giving while the other person reaches for the button.
    await withdrawItem(db, tradeId, aldric, stool.id);

    const trade = await tradeById(db, tradeId);
    expect(trade?.initiatorConfirmed).toBe(false);
    expect(trade?.partnerConfirmed).toBe(false);
    expect(trade?.status).toBe('open');
  });

  it('swaps everything when both agree', async () => {
    await fund(aldric, crowns(50), 'fund-a');
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const pin = await createItemFor(db, 'copper-pin', bryn);

    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');
    const tradeId = started.data.id;

    await offerItem(db, tradeId, aldric, stool.id);
    await offerMoney(db, tradeId, aldric, crowns(10));
    await offerItem(db, tradeId, bryn, pin.id);

    await confirm(db, tradeId, aldric);
    const second = await confirm(db, tradeId, bryn);

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.completed).toBe(true);

    const aldricHas = await inventoryOf(db, aldric);
    const brynHas = await inventoryOf(db, bryn);
    expect(aldricHas.map((item) => item.definitionId)).toEqual(['copper-pin']);
    expect(brynHas.map((item) => item.definitionId)).toEqual(['oak-stool']);

    expect(await purseOf(db, aldric)).toBe(crowns(40));
    expect(await purseOf(db, bryn)).toBe(crowns(10));
    expect(await balanceOf(db, tradeEscrow(tradeId))).toBe(0n);

    // Nothing was created and nothing was lost.
    expect(await countItems(db)).toBe(2);
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('does nothing at all until the second person agrees', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    await offerItem(db, started.data.id, aldric, stool.id);
    const first = await confirm(db, started.data.id, aldric);

    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.completed).toBe(false);
    expect(await inventoryOf(db, bryn)).toHaveLength(0);
  });

  it('swaps once when both press the button at the same moment', async () => {
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const pin = await createItemFor(db, 'copper-pin', bryn);
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');
    const tradeId = started.data.id;

    await offerItem(db, tradeId, aldric, stool.id);
    await offerItem(db, tradeId, bryn, pin.id);

    await Promise.allSettled([confirm(db, tradeId, aldric), confirm(db, tradeId, bryn)]);

    // However the race went, nothing may be duplicated or lost.
    expect(await countItems(db)).toBe(2);
    expect(await ledgerSum(db)).toBe(0n);

    const trade = await tradeById(db, tradeId);
    if (trade?.status === 'completed') {
      expect(await inventoryOf(db, aldric)).toHaveLength(1);
      expect(await inventoryOf(db, bryn)).toHaveLength(1);
    }
  });
});

describe('when a trade does not happen', () => {
  it('gives everything back when it is called off', async () => {
    await fund(aldric, crowns(50), 'fund-a');
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const pin = await createItemFor(db, 'copper-pin', bryn);

    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');
    const tradeId = started.data.id;

    await offerItem(db, tradeId, aldric, stool.id);
    await offerMoney(db, tradeId, aldric, crowns(25));
    await offerItem(db, tradeId, bryn, pin.id);

    const cancelled = await cancel(db, tradeId, bryn);
    expect(cancelled.ok).toBe(true);

    expect((await inventoryOf(db, aldric)).map((item) => item.definitionId)).toEqual(['oak-stool']);
    expect((await inventoryOf(db, bryn)).map((item) => item.definitionId)).toEqual(['copper-pin']);
    expect(await purseOf(db, aldric)).toBe(crowns(50));
    expect(await balanceOf(db, tradeEscrow(tradeId))).toBe(0n);
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('gives everything back when somebody simply walks away', async () => {
    await fund(aldric, crowns(50), 'fund-a');
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    await offerItem(db, started.data.id, aldric, stool.id);
    await offerMoney(db, started.data.id, aldric, crowns(25));

    // What happens when a player closes the tab.
    await cancelTradesOf(db, aldric);

    expect(await inventoryOf(db, aldric)).toHaveLength(1);
    expect(await purseOf(db, aldric)).toBe(crowns(50));
    expect(await openTradeOf(db, aldric)).toBeNull();
    expect(await ledgerSum(db)).toBe(0n);
  });

  it('cannot be called off twice, and cannot pay out twice', async () => {
    await fund(aldric, crowns(50), 'fund-a');
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    await offerMoney(db, started.data.id, aldric, crowns(25));
    await cancel(db, started.data.id, aldric);

    expect(await cancel(db, started.data.id, aldric)).toEqual({
      ok: false,
      reason: 'trade-is-over',
    });
    expect(await purseOf(db, aldric)).toBe(crowns(50));
  });

  it('refuses anything at all from somebody who is not in it', async () => {
    const cara = await makeCharacter('Cara');
    const stool = await createItemFor(db, 'oak-stool', cara);
    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    expect(await offerItem(db, started.data.id, cara, stool.id)).toEqual({
      ok: false,
      reason: 'not-your-trade',
    });
    expect(await confirm(db, started.data.id, cara)).toEqual({
      ok: false,
      reason: 'not-your-trade',
    });
    expect(await cancel(db, started.data.id, cara)).toEqual({
      ok: false,
      reason: 'not-your-trade',
    });
  });
});

describe('what each person sees', () => {
  it('shows each side their own half of the table', async () => {
    await fund(aldric, crowns(50), 'fund-a');
    const stool = await createItemFor(db, 'oak-stool', aldric);
    const pin = await createItemFor(db, 'copper-pin', bryn);

    const started = await startTrade(db, aldric, bryn);
    if (!started.ok) throw new Error('no trade');

    await offerItem(db, started.data.id, aldric, stool.id);
    await offerMoney(db, started.data.id, aldric, crowns(10));
    await offerItem(db, started.data.id, bryn, pin.id);

    const trade = await tradeById(db, started.data.id);
    if (trade === null) throw new Error('no trade');

    const asAldric = await viewOf(db, trade, aldric);
    const asBryn = await viewOf(db, trade, bryn);

    expect(asAldric?.yourItems.map((item) => item.name)).toEqual(['Oak stool']);
    expect(asAldric?.theirItems.map((item) => item.name)).toEqual(['Copper pin']);
    expect(asAldric?.yourMoneyDisplay).toBe('10.00 c');
    expect(asAldric?.them.name).toBe('Bryn');

    expect(asBryn?.yourItems.map((item) => item.name)).toEqual(['Copper pin']);
    expect(asBryn?.theirMoneyDisplay).toBe('10.00 c');
    expect(asBryn?.them.name).toBe('Aldric');
  });
});
