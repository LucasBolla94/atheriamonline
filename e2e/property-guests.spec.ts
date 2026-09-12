import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { characters, connect } from '../packages/db/src/index.js';
import { MINT, playerAccount } from '../packages/economy/src/index.js';
import { move } from '../apps/api/src/economy.js';
import { E2E_DATABASE_NAME, E2E_CLIENT_PORT, e2eEnv } from './global-setup.js';

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

test('an owner invites a visitor and revoking access sends the visitor outside', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: `http://127.0.0.1:${E2E_CLIENT_PORT}`,
  });
  const guest = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  guest.on('pageerror', (error) => errors.push(error.message));
  try {
    const ownerName = await resident(page, 'Host');
    const guestName = await resident(guest, 'Guest');
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
            idempotencyKey: `guest-funding-${ownerName}`,
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
    const businessName = `${ownerName} Club`;
    await page.getByLabel('Business name', { exact: true }).fill(businessName);
    await page.getByLabel('Who can enter', { exact: true }).selectOption('welcomed');
    await page.getByLabel('Show my business in the directory').check();
    await page.getByRole('button', { name: 'Save business', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('settings are saved');
    await page.getByRole('button', { name: 'Enter environment', exact: true }).click();
    await expect(page.getByRole('dialog', { name: businessName, exact: true })).toBeVisible();

    await guest.getByRole('button', { name: 'City guide', exact: true }).click();
    const card = guest
      .locator('.city-guide__card')
      .filter({ has: guest.getByRole('heading', { name: businessName, exact: true }) });
    await card.getByRole('button', { name: 'Enter environment', exact: true }).click();
    await expect(guest.getByRole('status')).toContainText('environment is private');
    await page.getByLabel('Name of somebody to welcome').fill(guestName);
    await page.getByRole('button', { name: 'Welcome', exact: true }).click();
    await expect(page.getByRole('button', { name: `${guestName} stop welcoming` })).toBeVisible();
    await card.getByRole('button', { name: 'Enter environment', exact: true }).click();
    await expect(guest.getByRole('dialog', { name: businessName, exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Welcome', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: `${guestName} stop welcoming` }).click();
    await expect(guest.getByRole('dialog')).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Go home', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
