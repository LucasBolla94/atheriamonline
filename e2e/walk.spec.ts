import { expect, test, type Page } from '@playwright/test';

/** Names must be unique in the world, so every test uses its own. */
function uniqueName(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 9000 + 1000)}`;
}

async function enterCity(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Enter the city' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** The two numbers the readout shows: the player's tile. */
async function readPosition(page: Page): Promise<{ x: number; y: number }> {
  const hud = page.locator('.hud');
  const text = await hud.innerText();
  const match = /(-?\d+),\s*(-?\d+)/.exec(text);
  if (match === null) throw new Error(`No position found in the readout: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

test('the page loads and asks who you are', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Atheriam' })).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByText('You must be 18 or over')).toBeVisible();
});

test('a short name is refused with a helpful message, not a disconnection', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your name').fill('ab');
  await page.getByRole('button', { name: 'Enter the city' }).click();
  await expect(page.getByRole('alert')).toContainText('too short');
});

test('a player can enter the city and see the world', async ({ page }) => {
  const name = uniqueName('Aldric');
  await enterCity(page, name);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hud')).toContainText(name);
});

test('pressing a movement key moves the character', async ({ page }, testInfo) => {
  // Keyboards belong to desktop. The touch equivalent is the next test.
  test.skip(testInfo.project.name !== 'desktop', 'This device has no keyboard.');

  const name = uniqueName('Bryn');
  await enterCity(page, name);

  const before = await readPosition(page);

  // Hold the key long enough for several server ticks to pass.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(300);

  const after = await readPosition(page);
  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBe(before.y);
});

test('tapping a tile walks the player to it', async ({ page }) => {
  const name = uniqueName('Faran');
  await enterCity(page, name);

  const before = await readPosition(page);
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('The game canvas has no size.');

  // The camera keeps the player in the middle, so two tiles to the left of
  // the middle of the canvas is two tiles to the left of the player. The
  // starter district is open ground there.
  await canvas.click({ position: { x: box.width / 2 - 64, y: box.height / 2 } });
  await page.waitForTimeout(1500);

  const after = await readPosition(page);
  expect(after.x).toBeLessThan(before.x);
});

test('two players in the city can see each other', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  const nameA = uniqueName('Cass');
  const nameB = uniqueName('Dara');

  try {
    await enterCity(first, nameA);
    await enterCity(second, nameB);

    // The readout counts the people nearby, which is how we know the first
    // player was told about the second one arriving.
    await expect(first.locator('.hud')).toContainText('nearby');
    await expect(first.locator('.hud')).not.toContainText('0 people nearby');
  } finally {
    await first.close();
    await second.close();
  }
});

test('the same name cannot be used twice at once', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  const name = uniqueName('Eryn');

  try {
    await enterCity(first, name);

    await second.goto('/');
    await second.getByLabel('Your name').fill(name);
    await second.getByRole('button', { name: 'Enter the city' }).click();

    await expect(second.getByRole('alert')).toContainText('already called that');
  } finally {
    await first.close();
    await second.close();
  }
});
