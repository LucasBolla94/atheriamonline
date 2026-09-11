/**
 * The purse and the things you carry, in a real browser.
 *
 * The money in these tests is checked as text, exactly as a player reads it.
 * That is deliberate: an amount that looks right on screen and is wrong in the
 * database would pass a test that only looked at the database.
 */
import { expect, test, type Page } from '@playwright/test';

function unique(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`;
}

const PASSWORD = 'correct horse battery staple';

async function createAccountAndEnter(page: Page): Promise<string> {
  const name = unique('Purse');
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create an account' }).click();
  await page.getByLabel('Email address').fill(`${name.toLowerCase()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('1990-05-04');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toContainText(name);
  return name;
}

test('a new player starts with a purse and a few belongings', async ({ page }) => {
  await createAccountAndEnter(page);

  // The readout shows the purse without anything being opened.
  await expect(page.locator('.hud')).toContainText('50.00 c');

  await page.getByRole('button', { name: /Purse/ }).click();
  await expect(page.getByRole('dialog')).toContainText('You are carrying 3 things');
  await expect(page.getByRole('dialog')).toContainText('Oak stool');
  await expect(page.getByRole('dialog')).toContainText('welcome to the city');
});

test('the daily reward can be collected once, and only once', async ({ page }) => {
  await createAccountAndEnter(page);
  await page.getByRole('button', { name: /Purse/ }).click();

  await page.getByRole('button', { name: "Collect today's reward" }).click();
  await expect(page.getByRole('dialog')).toContainText('You collected 10.00 c');
  await expect(page.getByRole('dialog')).toContainText('60.00 c');

  await page.getByRole('button', { name: "Collect today's reward" }).click();
  await expect(page.getByRole('dialog')).toContainText('already collected today');

  // And the money did not move twice.
  await expect(page.getByRole('dialog')).toContainText('60.00 c');
});

test('the purse survives logging out and back in', async ({ page }) => {
  const name = await createAccountAndEnter(page);
  await page.getByRole('button', { name: /Purse/ }).click();
  await page.getByRole('button', { name: "Collect today's reward" }).click();
  await expect(page.getByRole('dialog')).toContainText('60.00 c');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('tab', { name: 'Log in' })).toBeVisible();

  await page.getByLabel('Email address').fill(`${name.toLowerCase()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Enter the city' }).click();

  await expect(page.locator('.hud')).toContainText('60.00 c');
});
