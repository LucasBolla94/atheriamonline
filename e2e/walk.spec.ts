import { expect, test, type Page } from '@playwright/test';

/** Accounts and names must be unique, so every test makes its own. */
function unique(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`;
}

const PASSWORD = 'correct horse battery staple';
const ADULT_BIRTHDAY = '1990-05-04';

interface NewPlayer {
  readonly name: string;
  readonly email: string;
}

/** Make an account and walk straight into the city. */
async function createAccountAndEnter(page: Page): Promise<NewPlayer> {
  const name = unique('Aldric');
  const email = `${name.toLowerCase()}@example.com`;

  await page.goto('/play/');
  await page.getByRole('tab', { name: 'Create an account' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill(ADULT_BIRTHDAY);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  await expect(page.locator('.hud')).toContainText(name);
  return { name, email };
}

/** The two numbers the readout shows: the player's tile. */
async function readPosition(page: Page): Promise<{ x: number; y: number }> {
  const text = await page.locator('.hud').innerText();
  const match = /(-?\d+),\s*(-?\d+)/.exec(text);
  if (match === null) throw new Error(`No position found in the readout: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

test('the page loads and offers a way in', async ({ page }) => {
  await page.goto('/play/');
  await expect(page.getByRole('heading', { name: 'Atheriam' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Log in' })).toBeVisible();
  await expect(page.getByText('You must be 18 or over')).toBeVisible();
});

test('somebody under 18 cannot create an account', async ({ page }) => {
  const name = unique('Child');
  await page.goto('/play/');
  await page.getByRole('tab', { name: 'Create an account' }).click();
  await page.getByLabel('Email address').fill(`${name.toLowerCase()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('2015-06-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  await expect(page.getByRole('alert')).toContainText('18 or over');
  await expect(page.locator('.hud')).toHaveCount(0);
});

test('a short password is refused before it is even sent', async ({ page }) => {
  await page.goto('/play/');
  await page.getByRole('tab', { name: 'Create an account' }).click();
  await page.getByLabel('Email address').fill('someone@example.com');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Your name in the city').fill('Somebody');
  await page.getByLabel('Date of birth').fill(ADULT_BIRTHDAY);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  await expect(page.getByRole('alert')).toContainText('ten characters');
});

test('a new player lands in the city and can see the world', async ({ page }) => {
  const player = await createAccountAndEnter(page);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hud')).toContainText(player.name);
});

test('pressing a movement key moves the character', async ({ page }, testInfo) => {
  // Keyboards belong to desktop. The touch equivalent is the next test.
  test.skip(testInfo.project.name !== 'desktop', 'This device has no keyboard.');

  await createAccountAndEnter(page);
  const before = await readPosition(page);

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(300);

  const after = await readPosition(page);
  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBe(before.y);
});

test('tapping a tile walks the player to it', async ({ page }) => {
  await createAccountAndEnter(page);
  const before = await readPosition(page);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('The game canvas has no size.');

  // The camera keeps the player in the middle, so two tiles left of the middle
  // of the canvas is two tiles left of the player, on open ground.
  await canvas.click({ position: { x: box.width / 2 - 64, y: box.height / 2 } });
  await page.waitForTimeout(1500);

  const after = await readPosition(page);
  expect(after.x).toBeLessThan(before.x);
});

test('two players in the city can see each other', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    await createAccountAndEnter(first);
    await createAccountAndEnter(second);

    await expect(first.locator('.hud')).toContainText('nearby');
    await expect(first.locator('.hud')).not.toContainText('0 people nearby');
  } finally {
    await first.close();
    await second.close();
  }
});

test('the same character name cannot be registered twice', async ({ page, browser }) => {
  const player = await createAccountAndEnter(page);

  const second = await browser.newPage();
  try {
    await second.goto('/play/');
    await second.getByRole('tab', { name: 'Create an account' }).click();
    await second.getByLabel('Email address').fill(`other-${player.email}`);
    await second.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await second.getByLabel('Your name in the city').fill(player.name);
    await second.getByLabel('Date of birth').fill(ADULT_BIRTHDAY);
    await second.getByRole('checkbox').check();
    await second.getByRole('button', { name: 'Create my account' }).click();

    await expect(second.getByRole('alert')).toContainText('already uses that name');
  } finally {
    await second.close();
  }
});

test('logging out and back in brings you back where you were', async ({ page }) => {
  const player = await createAccountAndEnter(page);

  // Walk a few tiles so the saved position is not the spawn point.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(400);
  const before = await readPosition(page);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('tab', { name: 'Log in' })).toBeVisible();

  await page.getByLabel('Email address').fill(player.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Enter the city' }).click();

  await expect(page.locator('.hud')).toContainText(player.name);
  const after = await readPosition(page);
  expect(after).toEqual(before);
});

test('a returning player does not have to log in again', async ({ page }) => {
  const player = await createAccountAndEnter(page);

  // The session lives in a cookie, so a reload should walk straight back in.
  await page.reload();

  await expect(page.locator('.hud')).toContainText(player.name);
});

test('the city cannot be entered without an account', async ({ page }) => {
  await page.goto('/play/');
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enter the city' })).toBeVisible();
});
