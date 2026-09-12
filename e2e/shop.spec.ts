import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { characters, connect } from '../packages/db/src/index.js';
import { MINT, playerAccount } from '../packages/economy/src/index.js';
import { move } from '../apps/api/src/economy.js';
import { E2E_CLIENT_PORT, E2E_DATABASE_NAME, e2eEnv } from './global-setup.js';

async function resident(page: Page, prefix: string) {
  const name = `${prefix}${Date.now().toString().slice(-9)}`;
  await page.goto('/play/?create=1');
  await page.getByLabel('Email address').fill(`${name}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('a strong city password');
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('1990-01-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toContainText(name);
  return name;
}

test('a business sells a reserved item and both residents receive the correct result', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: `http://127.0.0.1:${E2E_CLIENT_PORT}`,
  });
  const buyer = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  buyer.on('pageerror', (error) => errors.push(error.message));
  try {
    const ownerName = await resident(page, 'Seller');
    const url = e2eEnv()['DATABASE_URL']!;
    expect(new URL(url).pathname).toBe(`/${E2E_DATABASE_NAME}`);
    const handle = connect(url);
    try {
      const owner = (
        await handle.db.select().from(characters).where(eq(characters.name, ownerName))
      )[0]!;
      expect(
        (
          await move(handle.db, {
            from: MINT,
            to: playerAccount(owner.id),
            amount: 30000n,
            reason: 'Browser test fixture',
            idempotencyKey: `shop-funding-${ownerName}`,
          })
        ).ok,
      ).toBe(true);
    } finally {
      await handle.close();
    }
    await page.getByRole('button', { name: 'City guide', exact: true }).click();
    await page.getByRole('button', { name: 'For sale', exact: true }).click();
    await page.getByRole('button', { name: 'Review purchase', exact: true }).first().click();
    await page.getByRole('button', { name: 'Buy this property', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('The keys are yours');
    const name = `${ownerName} Shop`;
    await page.getByLabel('Business name', { exact: true }).fill(name);
    await page.getByLabel('Who can enter', { exact: true }).selectOption('everyone');
    await page.getByLabel('Show my business in the directory').check();
    await page.getByRole('button', { name: 'Save business', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('settings are saved');
    await page.getByRole('button', { name: 'Enter environment', exact: true }).click();
    await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Shop', exact: true }).click();
    await page.getByLabel('Item from your inventory').selectOption({ label: 'Oak stool' });
    await page.getByLabel('Price in Crowns').fill('60');
    await page.getByRole('button', { name: 'List item for sale', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('now listed for sale');
    await expect(page.getByRole('option', { name: 'Oak stool', exact: true })).toHaveCount(0);

    await resident(buyer, 'Buyer');
    await buyer.getByRole('button', { name: 'City guide', exact: true }).click();
    const card = buyer
      .locator('.city-guide__card')
      .filter({ has: buyer.getByRole('heading', { name, exact: true }) });
    await card.getByRole('button', { name: 'Enter environment', exact: true }).click();
    await expect(buyer.getByRole('dialog', { name, exact: true })).toBeVisible();
    await buyer.getByRole('button', { name: 'Shop', exact: true }).click();
    await buyer.getByRole('button', { name: 'Review item purchase', exact: true }).click();
    await expect(buyer.getByRole('region', { name: 'Review item purchase' })).toContainText(
      '60.00 c',
    );
    await buyer.getByRole('button', { name: 'Buy this item', exact: true }).click();
    await expect(buyer.getByRole('status')).toContainText('not have enough Crowns');
    await page.getByRole('button', { name: 'Withdraw listing', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('back in your inventory');
    await page.getByLabel('Item from your inventory').selectOption({ label: 'Oak stool' });
    await page.getByLabel('Price in Crowns').fill('12.50');
    await page.getByRole('button', { name: 'List item for sale', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('now listed for sale');
    await buyer.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(buyer.locator('.pouch__item')).toContainText('12.50 c');
    await buyer.getByRole('button', { name: 'Review item purchase', exact: true }).click();
    await expect(buyer.getByRole('region', { name: 'Review item purchase' })).toContainText(
      '12.50 c',
    );
    if (info.project.name === 'mobile-landscape') {
      await expect(
        buyer
          .getByRole('region', { name: 'Review item purchase' })
          .getByText('12.50 c', { exact: true }),
      ).toBeInViewport();
      await expect(
        buyer.getByRole('button', { name: 'Buy this item', exact: true }),
      ).toBeInViewport({ ratio: 1 });
    }
    await buyer.screenshot({ path: `test-results/${info.project.name}-shop-review.png` });
    await buyer.getByRole('button', { name: 'Buy this item', exact: true }).click();
    await expect(buyer.getByRole('status')).toContainText('Purchase complete');
    await expect(buyer.getByRole('dialog')).toContainText('Your balance: 37.50 c');
    await expect(page.getByRole('dialog')).toContainText('Your balance: 112.50 c');
    await expect(page.getByRole('button', { name: 'Withdraw listing', exact: true })).toHaveCount(
      0,
    );
    await buyer.getByRole('button', { name: 'Back to the environment', exact: true }).click();
    await buyer.getByRole('button', { name: 'Close', exact: true }).click();
    await buyer.getByRole('button', { name: 'Purse', exact: false }).click();
    await expect(buyer.locator('.pouch__item').filter({ hasText: 'Oak stool' })).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
