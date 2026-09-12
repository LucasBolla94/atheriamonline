import { test, expect, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { characters, connect, loungeBookings } from '../packages/db/src/index.js';
import { E2E_DATABASE_NAME, e2eEnv } from './global-setup.js';

test.use({ actionTimeout: 15_000 });
let residentName: string | null = null;
test.afterEach(async () => {
  if (!residentName) return;
  const url = e2eEnv()['DATABASE_URL']!;
  expect(new URL(url).pathname).toBe(`/${E2E_DATABASE_NAME}`);
  const handle = connect(url);
  try {
    const [host] = await handle.db
      .select()
      .from(characters)
      .where(eq(characters.name, residentName));
    if (host)
      await handle.db
        .update(loungeBookings)
        .set({ cancelledAt: new Date() })
        .where(eq(loungeBookings.hostId, host.id));
  } finally {
    residentName = null;
    await handle.close();
  }
});

async function openAgenda(page: Page) {
  await page.getByRole('button', { name: 'City guide', exact: true }).click();
  const lounge = page.locator('.city-guide__card').filter({
    has: page.getByRole('heading', { name: 'Central Lounge', exact: true }),
  });
  await lounge.getByRole('button', { name: 'Enter environment', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Meeting rooms', exact: true }).click();
}

test('future reservations survive reload and active rooms warn then close at the deadline', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const name = `Agenda${Date.now().toString().slice(-9)}`;
  residentName = name;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/play/?create=1');
  await page.getByLabel('Email address').fill(`${name}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('a strong city password');
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('1990-01-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toContainText(name);
  await openAgenda(page);
  await page.getByRole('button', { name: 'Reserve a room', exact: true }).click();
  await page.getByLabel('Meeting name', { exact: true }).fill('Tomorrow together');
  await page.getByRole('combobox', { name: 'Room', exact: true }).selectOption('terrace');
  await page.getByRole('combobox', { name: 'Start', exact: true }).selectOption('later');
  const tomorrow = await page.evaluate(() => {
    const date = new Date(Date.now() + 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  await page.getByLabel('Date and time (your local time)', { exact: true }).fill(tomorrow);
  await page.locator('form').getByRole('button', { name: 'Reserve a room', exact: true }).click();
  await page.getByRole('button', { name: 'Tomorrow together', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enter meeting', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('Entry opens at the start time.');
  await page.reload();
  await expect(page.locator('.hud')).toContainText(name);
  await openAgenda(page);
  await page.getByRole('button', { name: 'Tomorrow together', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enter meeting', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel meeting', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Meeting cancelled.');
  await page.getByRole('button', { name: 'Reserve a room', exact: true }).click();
  await page.getByLabel('Meeting name', { exact: true }).fill('Last minute');
  await page.getByRole('combobox', { name: 'Room', exact: true }).selectOption('terrace');
  await page.getByRole('combobox', { name: 'Start', exact: true }).selectOption('now');
  await page.locator('form').getByRole('button', { name: 'Reserve a room', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your room is reserved.');

  // A page reload leaves the live room but preserves its durable reservation.
  await page.getByRole('button', { name: 'Last minute', exact: true }).click();
  await page.getByRole('button', { name: 'Enter meeting', exact: true }).click();
  await expect(page.locator('.hud')).toContainText('The Terrace');
  await page.reload();
  await expect(page.locator('.hud')).toContainText(name);
  await expect(page.locator('.meeting-status')).toHaveCount(0);
  await openAgenda(page);

  // Move the existing test reservation near its end before renewed admission.
  // Keep the real 30-minute duration, server clock, authorization and tick loop.
  // This avoids making a browser suite wait half an hour and touches only its DB.
  const url = e2eEnv()['DATABASE_URL']!;
  expect(new URL(url).pathname).toBe(`/${E2E_DATABASE_NAME}`);
  const handle = connect(url);
  const deadline = new Date(Date.now() + 45_000);
  try {
    const [host] = await handle.db.select().from(characters).where(eq(characters.name, name));
    expect(host).toBeDefined();
    const changed = await handle.db
      .update(loungeBookings)
      .set({
        startsAt: new Date(deadline.getTime() - 30 * 60_000),
        endsAt: deadline,
      })
      .where(and(eq(loungeBookings.hostId, host!.id), eq(loungeBookings.title, 'Last minute')))
      .returning();
    expect(changed).toHaveLength(1);
  } finally {
    await handle.close();
  }

  await page.getByRole('button', { name: 'Last minute', exact: true }).click();
  await page.getByRole('button', { name: 'Enter meeting', exact: true }).click();
  await expect(page.locator('.hud')).toContainText('The Terrace');
  await expect(page.locator('.meeting-status')).toContainText('Meeting ends in 1 min.');
  // Let the scene finish its next frame after the agenda modal closes.
  await page.waitForTimeout(500);
  await page.screenshot({ path: `test-results/${info.project.name}-meeting-warning.png` });
  await expect(page.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible({
    timeout: 50_000,
  });
  expect(Date.now()).toBeGreaterThanOrEqual(deadline.getTime());
  await expect(page.locator('.meeting-status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Meeting rooms', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Last minute', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
