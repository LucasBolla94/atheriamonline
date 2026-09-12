import { test, expect, type Page } from '@playwright/test';
import { E2E_CLIENT_PORT } from './global-setup.js';

test.use({ actionTimeout: 15_000 });

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
async function lounge(page: Page) {
  await page.getByRole('button', { name: 'City guide', exact: true }).click();
  const card = page
    .locator('.city-guide__card')
    .filter({ has: page.getByRole('heading', { name: 'Central Lounge', exact: true }) });
  await card.getByRole('button', { name: 'Enter environment', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Meeting rooms', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Meeting rooms', exact: true })).toBeVisible();
}

test('residents reserve a lounge room, meet privately and manage invitations', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: `http://127.0.0.1:${E2E_CLIENT_PORT}`,
  });
  const guest = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  guest.on('pageerror', (error) => errors.push(error.message));
  try {
    await resident(page, 'Host');
    const guestName = await resident(guest, 'Guest');
    await lounge(page);
    await page.getByRole('button', { name: 'Reserve a room', exact: true }).click();
    await page.getByLabel('Meeting name', { exact: true }).fill('Design club');
    await page.getByRole('combobox', { name: 'Room', exact: true }).selectOption('studio');
    await page.getByRole('combobox', { name: 'Duration', exact: true }).selectOption('30');
    await page.locator('form').getByRole('button', { name: 'Reserve a room', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Your room is reserved');
    await page.getByRole('button', { name: 'Design club', exact: true }).click();
    await lounge(guest);
    await expect(guest.getByRole('dialog')).toContainText('No upcoming meetings');
    await page.getByLabel('Resident name', { exact: true }).fill(guestName);
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Invitation updated');
    await expect(guest.getByRole('button', { name: 'Design club', exact: true })).toBeVisible();
    await expect(guest.getByRole('dialog')).not.toContainText('Invited residents');
    await page.screenshot({ path: `test-results/${info.project.name}-lounge-agenda.png` });
    await page.getByRole('button', { name: 'Enter meeting', exact: true }).click();
    await expect(page.locator('.hud')).toContainText('The Studio');
    await page.getByLabel('Say something', { exact: true }).fill('Only inside this meeting');
    await page.getByRole('button', { name: 'Say', exact: true }).click();
    await expect(page.getByRole('log')).toContainText('Only inside this meeting');
    await expect(guest.getByRole('log')).not.toContainText('Only inside this meeting');
    await guest.getByRole('button', { name: 'Enter meeting', exact: true }).click();
    await expect(guest.locator('.hud')).toContainText('The Studio');
    await page.getByLabel('Say something', { exact: true }).fill('Welcome to the design club');
    await page.getByRole('button', { name: 'Say', exact: true }).click();
    await expect(guest.getByRole('log')).toContainText('Welcome to the design club');
    if (info.project.name === 'mobile-landscape') {
      await expect(guest.locator('.meeting-status')).toBeInViewport({ ratio: 1 });
      const status = await guest.locator('.meeting-status').boundingBox();
      expect(status).not.toBeNull();
      expect(status!.y + status!.height).toBeLessThan(guest.viewportSize()!.height / 4);
    }
    await guest.screenshot({ path: `test-results/${info.project.name}-lounge-meeting.png` });
    await page.getByRole('button', { name: 'Meeting rooms', exact: true }).click();
    await page.getByRole('button', { name: 'Design club', exact: true }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Invitation removed');
    await expect(guest.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Meeting rooms', exact: true }).click();
    await expect(guest.getByRole('dialog')).toContainText('No upcoming meetings');
    await page.getByLabel('Resident name', { exact: true }).fill(guestName);
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Enter meeting', exact: true })).toBeEnabled();
    await guest.getByRole('button', { name: 'Enter meeting', exact: true }).click();
    await expect(guest.locator('.hud')).toContainText('The Studio');
    await page.getByRole('button', { name: 'Cancel meeting', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible();
    await expect(guest.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
