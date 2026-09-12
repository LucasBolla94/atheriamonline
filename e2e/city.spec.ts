import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { connect, characters } from '../packages/db/src/index.js';
import { MINT, playerAccount } from '../packages/economy/src/index.js';
import { move } from '../apps/api/src/economy.js';
import { E2E_DATABASE_NAME, e2eEnv } from './global-setup.js';

test('a resident reviews, buys and configures a commercial address', async ({ page }, info) => {
  test.setTimeout(120_000);
  const name = `Owner${Date.now().toString().slice(-9)}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/play/');
  await page.getByRole('tab', { name: 'Create an account' }).click();
  await page.getByLabel('Email address').fill(`${name}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('a strong city password');
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('1990-01-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toContainText(name);
  await page.getByRole('button', { name: 'City guide', exact: true }).click();
  await expect(page.locator('.city-guide__card')).toHaveCount(15);
  await page.getByRole('button', { name: 'Public spaces', exact: true }).click();
  await expect(page.locator('.city-guide__card')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Review purchase', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'For sale', exact: true }).click();
  const address = await page.locator('.city-guide__card h3').first().innerText();
  await page.getByRole('button', { name: 'Review purchase', exact: true }).first().click();
  await expect(page.locator('.city-guide__confirmation')).toContainText('250.00 c');
  await expect(page.locator('.city-guide__confirmation')).toContainText('50.00 c');
  await page.getByRole('button', { name: 'Buy this property', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('not have enough Crowns');

  // A test-only ledger grant, guarded against production. All actual purchasing
  // happens through the ordinary UI, with no test-only product routes.
  const url = e2eEnv()['DATABASE_URL']!;
  expect(new URL(url).pathname).toBe(`/${E2E_DATABASE_NAME}`);
  const handle = connect(url);
  try {
    const owner = (await handle.db.select().from(characters).where(eq(characters.name, name)))[0]!;
    expect(
      (
        await move(handle.db, {
          from: MINT,
          to: playerAccount(owner.id),
          amount: 30000n,
          reason: 'Browser test fixture',
          idempotencyKey: `browser-funding-${name}`,
        })
      ).ok,
    ).toBe(true);
  } finally {
    await handle.close();
  }
  await page.getByRole('button', { name: 'Buy this property', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('The keys are yours');
  await expect(page.locator('.hud')).toContainText('100.00 c');
  await expect(page.locator('.city-guide__card')).toHaveCount(1);
  await expect(page.locator('.city-guide__card')).toContainText(address);
  await page.getByLabel('Business name', { exact: true }).fill(`${name} Studio`);
  await page
    .getByLabel('About your business', { exact: true })
    .fill('A creative corner for the community.');
  await page.getByLabel('Who can enter', { exact: true }).selectOption('everyone');
  await page.getByLabel('Show my business in the directory').check();
  await page.getByLabel('Floor finish').selectOption('tile');
  await page.getByLabel('Wall colour').selectOption('teal');
  await page.getByRole('button', { name: 'Save business', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('settings are saved');
  await page.screenshot({ path: `test-results/${info.project.name}-business.png`, fullPage: true });
  await page.reload();
  await expect(page.locator('.hud')).toContainText(name);
  await page.getByRole('button', { name: 'City guide', exact: true }).click();
  await page.getByRole('button', { name: 'My businesses', exact: true }).click();
  await expect(page.locator('.city-guide__card')).toContainText(`${name} Studio`);
  await page.getByRole('button', { name: 'Business settings', exact: true }).click();
  await expect(page.getByLabel('Floor finish')).toHaveValue('tile');
  await expect(page.getByLabel('Wall colour')).toHaveValue('teal');
  await expect(page.getByLabel('Show my business in the directory')).toBeChecked();
  await page.getByRole('button', { name: 'Enter environment', exact: true }).click();
  await expect(page.getByRole('dialog', { name: `${name} Studio`, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Change access, floor and wall finishes');
  await page.getByRole('button', { name: /Oak stool.*choose/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Now tap where');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing game canvas');
  const placed = page.waitForResponse(
    (response) => response.url().endsWith('/decorate') && response.request().method() === 'POST',
  );
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 - 64 } });
  expect((await placed).status()).toBe(200);
  await page.getByRole('button', { name: 'Environment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'pick up', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'turn', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  if (info.project.name === 'mobile-landscape') {
    const action = await page
      .getByRole('button', { name: 'Environment', exact: true })
      .boundingBox();
    const arrows = await page.locator('.touch-walk').boundingBox();
    expect(action).not.toBeNull();
    expect(arrows).not.toBeNull();
    expect(action!.x + action!.width).toBeLessThan(arrows!.x);
  }
  await page.screenshot({ path: `test-results/${info.project.name}-business-interior.png` });
  await page.getByRole('button', { name: 'Environment', exact: true }).click();
  await page.getByRole('button', { name: 'pick up', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('It is a bare room');
  await page.getByRole('button', { name: 'Step outside', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Go home', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
