/**
 * Houses, in a real browser.
 *
 * The two things worth proving here are the ones that only show up when the
 * whole stack is running: that walking indoors really changes where you are,
 * and that a shut door really keeps somebody out.
 */
import { expect, test, type Page } from '@playwright/test';

function unique(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`;
}

const PASSWORD = 'correct horse battery staple';

async function createAccountAndEnter(page: Page): Promise<string> {
  const name = unique('Home');
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

async function say(page: Page, text: string): Promise<void> {
  await page.getByLabel('Say something').fill(text);
  await page.getByRole('button', { name: 'Say' }).click();
}

test('a player can go home and come back out', async ({ page }) => {
  await createAccountAndEnter(page);

  await page.getByRole('button', { name: 'Go home' }).click();

  await expect(page.getByRole('dialog')).toContainText('Your house');
  await expect(page.getByRole('dialog')).toContainText('It is a bare room');

  // The panel is a dialog over the whole screen, so the readout behind it
  // cannot be clicked: the button inside the panel is the one to use.
  await page.getByRole('dialog').getByRole('button', { name: 'Step outside' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Go home' })).toBeVisible();
});

test('furniture can be put down and picked up again', async ({ page }) => {
  await createAccountAndEnter(page);
  await page.getByRole('button', { name: 'Go home' }).click();
  await expect(page.getByRole('dialog')).toContainText('Your house');

  // Choose the stool, then tap the middle of the room.
  await page.getByRole('button', { name: /Oak stool.*choose/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Now tap where');

  // The panel covers the floor, so it is closed while the tap happens.
  await page.getByRole('button', { name: 'Close' }).click();
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('The game canvas has no size.');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 - 64 } });

  await page.getByRole('button', { name: 'House', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Standing here');
  await expect(page.getByRole('dialog')).toContainText('Oak stool');

  // And it is no longer being carried: the same item, in one place only.
  await page.getByRole('button', { name: 'pick up' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('It is a bare room');
});

test('a shut door keeps somebody out', async ({ browser }) => {
  const owner = await browser.newPage();
  const caller = await browser.newPage();
  try {
    const ownerName = await createAccountAndEnter(owner);
    await createAccountAndEnter(caller);

    // The owner shuts the door.
    await owner.getByRole('button', { name: 'Go home' }).click();
    await expect(owner.getByRole('dialog')).toContainText('Who may come in');
    await owner.getByRole('dialog').getByRole('button', { name: 'Nobody' }).click();
    await owner.getByRole('dialog').getByRole('button', { name: 'Step outside' }).click();
    await expect(owner.getByRole('dialog')).toHaveCount(0);

    // Somebody tries to call on them.
    await say(owner, 'I am home.');
    await expect(caller.locator('.chat__log')).toContainText('I am home.');
    await caller.getByRole('button', { name: ownerName }).first().click();
    await caller.getByRole('button', { name: 'Call on them at home' }).click();

    await expect(caller.locator('.chat__notice')).toContainText('door is shut');
  } finally {
    await owner.close();
    await caller.close();
  }
});

test('an open door lets somebody in', async ({ browser }) => {
  const owner = await browser.newPage();
  const caller = await browser.newPage();
  try {
    const ownerName = await createAccountAndEnter(owner);
    await createAccountAndEnter(caller);

    await owner.getByRole('button', { name: 'Go home' }).click();
    await expect(owner.getByRole('dialog')).toContainText('Who may come in');
    await owner.getByRole('dialog').getByRole('button', { name: 'Anybody' }).click();
    await owner.getByRole('dialog').getByRole('button', { name: 'Step outside' }).click();
    await expect(owner.getByRole('dialog')).toHaveCount(0);

    await say(owner, 'Do come in.');
    await expect(caller.locator('.chat__log')).toContainText('Do come in.');
    await caller.getByRole('button', { name: ownerName }).first().click();
    await caller.getByRole('button', { name: 'Call on them at home' }).click();

    await expect(caller.getByRole('dialog')).toContainText('Somebody else');
  } finally {
    await owner.close();
    await caller.close();
  }
});
