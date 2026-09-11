/**
 * Is the real site actually working?
 *
 * Everything else in `e2e/` runs against servers started for the test. This
 * file runs against whatever is actually published: the real certificate, the
 * real Caddy, the real database. It is what to run after a deployment, and
 * what to run when somebody says the game is broken.
 */
import { expect, test, type Page } from '@playwright/test';

/** Test accounts are named so that they are obvious in the database. */
function throwawayName(): string {
  return `Smoke${Math.floor(Math.random() * 900000 + 100000)}`;
}

const PASSWORD = 'correct horse battery staple';

async function createAccountAndEnter(page: Page): Promise<string> {
  const name = throwawayName();
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

test('the site is served over HTTPS and asks people in', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(page.url()).toMatch(/^https:/);
  await expect(page.getByRole('heading', { name: 'Atheriam' })).toBeVisible();
});

test('the API answers through the proxy', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true, service: 'api' });
});

test('somebody can make an account and walk into the city', async ({ page }) => {
  await createAccountAndEnter(page);

  // Being in the city at all means the WebSocket went through Caddy, the
  // ticket was spent, and the world server sent the ground and a snapshot.
  await expect(page.locator('canvas')).toBeVisible();

  const before = await page.locator('.hud').innerText();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(400);

  expect(await page.locator('.hud').innerText()).not.toBe(before);
});

test('two people can talk to each other on the live site', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    const speaker = await createAccountAndEnter(first);
    await createAccountAndEnter(second);

    await first.getByLabel('Say something').fill('Live and well.');
    await first.getByRole('button', { name: 'Say' }).click();

    await expect(second.locator('.chat__log')).toContainText('Live and well.');
    await expect(second.locator('.chat__log')).toContainText(speaker);
  } finally {
    await first.close();
    await second.close();
  }
});

test('a new player really has a purse, belongings and a house', async ({ page }) => {
  await createAccountAndEnter(page);

  await expect(page.locator('.hud')).toContainText('50.00 c');

  await page.getByRole('button', { name: /Purse/ }).click();
  await expect(page.getByRole('dialog')).toContainText('You are carrying 3 things');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Go home' }).click();
  await expect(page.getByRole('dialog')).toContainText('Your house');
  await page.getByRole('dialog').getByRole('button', { name: 'Step outside' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('two people can really trade on the live site', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    const one = await createAccountAndEnter(first);
    await createAccountAndEnter(second);

    await first.getByLabel('Say something').fill('Trade?');
    await first.getByRole('button', { name: 'Say' }).click();
    await expect(second.locator('.chat__log')).toContainText('Trade?');

    await second.getByRole('button', { name: one }).first().click();
    await second.getByRole('button', { name: 'Offer to trade' }).click();
    await expect(first.getByRole('dialog')).toContainText('Trading with');

    await second
      .getByRole('button', { name: /Oak stool.*put on the table/ })
      .first()
      .click();
    await expect(first.getByRole('dialog')).toContainText('Oak stool');

    await second.getByRole('button', { name: 'Call it off' }).click();
    await expect(second.getByRole('dialog')).toHaveCount(0);
  } finally {
    await first.close();
    await second.close();
  }
});

test('the certificate covers www too, and sends people to the short name', async ({ page }) => {
  const response = await page.goto('https://www.atheriam.online/');
  expect(response?.status()).toBe(200);
  expect(page.url()).toBe('https://atheriam.online/');
});
