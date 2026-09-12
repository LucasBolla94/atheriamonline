/**
 * Is the real site actually working?
 *
 * Everything else in `e2e/` runs against servers started for the test. This
 * file runs against whatever is actually published: the real certificate, the
 * real Caddy, the real database. It is what to run after a deployment, and
 * what to run when somebody says the game is broken.
 */
import { expect, test, type Page } from '@playwright/test';
import { verifyChatControls } from '../e2e/helpers/chat-controls.js';

/** Test accounts are named so that they are obvious in the database. */
function throwawayName(): string {
  return `Smoke${Math.floor(Math.random() * 900000 + 100000)}`;
}

const PASSWORD = 'correct horse battery staple';

/**
 * Make an account on the real site and walk in.
 *
 * The live site allows ten registrations a minute from one address, and that
 * limit is deliberately low because it is where passwords get guessed. This
 * suite makes more accounts than that, from one address, so it waits and tries
 * again rather than failing — and the limit is never loosened to suit a test,
 * because then the test would stop checking the thing that matters.
 */
async function createAccountAndEnter(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const name = throwawayName();

    await page.goto('/play/');
    await page.getByRole('tab', { name: 'Create an account' }).click();
    await page.getByLabel('Email address').fill(`${name.toLowerCase()}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Your name in the city').fill(name);
    await page.getByLabel('Date of birth').fill('1990-05-04');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create my account' }).click();

    const arrived = page.locator('.hud').filter({ hasText: name });
    const refused = page.getByRole('alert');
    await expect(arrived.or(refused).first()).toBeVisible({ timeout: 20_000 });

    if (await arrived.isVisible()) return name;

    const why = (await refused.innerText()).toLowerCase();
    if (!why.includes('rate') && !why.includes('too many') && !why.includes('retry')) {
      throw new Error(
        `The site refused the account for a reason that is not the rate limit: ${why}`,
      );
    }

    // The window is a minute, so waiting most of one is enough.
    await page.waitForTimeout(35_000);
  }

  throw new Error('Could not make an account: the rate limit held for three attempts.');
}

test('the site is served over HTTPS and asks people in', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(page.url()).toMatch(/^https:/);
  await expect(page.getByRole('heading', { name: /A little city/ })).toBeVisible();
});

test('the API answers through the proxy', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true, service: 'api' });
});

test('the published city guide and reserved lounge room work together', async ({ page }) => {
  await createAccountAndEnter(page);
  await page.getByRole('button', { name: 'City guide', exact: true }).click();
  const cards = page.locator('.city-guide__card');
  await expect(cards).toHaveCount(15);
  await expect(cards.filter({ hasText: 'City-owned' })).toHaveCount(5);
  const lounge = cards.filter({
    has: page.getByRole('heading', { name: 'Central Lounge', exact: true }),
  });
  await lounge.getByRole('button', { name: 'Enter environment', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Meeting rooms', exact: true }).click();
  const response = await page.request.get('/api/lounge');
  expect(response.ok()).toBe(true);
  const schedule = (await response.json()) as {
    now: string;
    rooms: { id: string; name: string }[];
    occupied: { roomId: string; startsAt: string; endsAt: string }[];
  };
  const now = Date.parse(schedule.now);
  const room = schedule.rooms.find(
    (candidate) =>
      !schedule.occupied.some(
        (slot) =>
          slot.roomId === candidate.id &&
          Date.parse(slot.endsAt) > now &&
          Date.parse(slot.startsAt) < now + 30 * 60_000,
      ),
  );
  expect(room, 'A room must be available for the live reservation check').toBeDefined();
  const title = `Smoke meeting ${Date.now()}`;
  let bookingId: string | null = null;
  try {
    await page.getByRole('button', { name: 'Reserve a room', exact: true }).click();
    await page.getByLabel('Meeting name', { exact: true }).fill(title);
    await page.getByRole('combobox', { name: 'Room', exact: true }).selectOption(room!.id);
    const created = page.waitForResponse(
      (reply) =>
        new URL(reply.url()).pathname === '/api/lounge/bookings' &&
        reply.request().method() === 'POST',
    );
    await page.locator('form').getByRole('button', { name: 'Reserve a room', exact: true }).click();
    const result = await created;
    expect(result.ok()).toBe(true);
    bookingId = (await result.json()).id as string;
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('button', { name: 'Enter meeting', exact: true }).click();
    await expect(page.locator('.hud')).toContainText(room!.name);
    await expect(page.locator('.meeting-status')).toContainText('Ends at');
    await page.getByRole('button', { name: 'Meeting rooms', exact: true }).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('button', { name: 'Cancel meeting', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible();
    bookingId = null;
  } finally {
    if (bookingId)
      await page.request.post(`/api/lounge/bookings/${bookingId}/cancel`, {
        headers: { origin: new URL(page.url()).origin },
      });
  }
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

test('the published pixel-art look persists and works on touch', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/play/');
  await page
    .locator('.welcome-art__image')
    .evaluate((image) => (image as HTMLImageElement).decode());
  await page.screenshot({ path: `test-results/live-${info.project.name}-login.png` });
  const name = await createAccountAndEnter(page);
  await page.getByRole('button', { name: 'Your look' }).click();
  await page.getByRole('button', { name: 'Warm terracotta' }).click();
  await page.getByRole('button', { name: 'Wear this look' }).click();
  await expect(page.locator('.resident-card img')).toHaveAttribute(
    'src',
    '/art/portrait-modern-4.png',
  );
  await page.reload();
  await expect(page.locator('.hud')).toContainText(name);
  await expect(page.locator('.resident-card img')).toHaveAttribute(
    'src',
    '/art/portrait-modern-4.png',
  );
  if (info.project.name === 'mobile-landscape') {
    await page.setViewportSize({ width: 393, height: 851 });
    await expect
      .poll(async () => (await page.locator('canvas').boundingBox())?.height)
      .toBeGreaterThan(840);
    const before = await page.locator('.location-card').innerText();
    await page.getByRole('button', { name: 'Walk east', exact: true }).tap();
    await expect(page.locator('.location-card')).not.toHaveText(before);
  }
  await page.screenshot({ path: `test-results/live-${info.project.name}-city.png` });
  expect(errors).toEqual([]);
});

test('live chat accepts movement letters and Enter restores walking', async ({ page }) => {
  await createAccountAndEnter(page);
  await verifyChatControls(page);
});
