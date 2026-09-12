import { test, expect } from '@playwright/test';
import { LOUNGE_ROOMS } from '../packages/shared/src/city.js';

test.use({ actionTimeout: 15_000 });
test('all three meeting layouts can be reserved, entered and vacated', async ({ page }, info) => {
  test.setTimeout(240_000);
  const name = `Planner${Date.now().toString().slice(-9)}`;
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
  await page.getByRole('button', { name: 'City guide', exact: true }).click();
  await page
    .locator('.city-guide__card')
    .filter({ has: page.getByRole('heading', { name: 'Central Lounge', exact: true }) })
    .getByRole('button', { name: 'Enter environment', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible();
  for (const room of LOUNGE_ROOMS) {
    await page.getByRole('button', { name: 'Meeting rooms', exact: true }).click();
    await page.getByRole('button', { name: 'Reserve a room', exact: true }).click();
    await page.getByRole('combobox', { name: 'Room', exact: true }).selectOption(room.id);
    await page.getByLabel('Meeting name', { exact: true }).fill(`Visit ${room.name}`);
    await page.locator('form').getByRole('button', { name: 'Reserve a room', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Your room is reserved');
    await page.getByRole('button', { name: 'Enter meeting', exact: true }).click();
    await expect(page.locator('.location-card')).toContainText(room.name);
    await expect(page.locator('.meeting-status')).toBeInViewport();
    // Walk along the open entry aisle before capturing the furnished room.
    await page.keyboard.down('ArrowUp');
    try {
      await expect(page.locator('.location-card')).not.toContainText('10, 14');
    } finally {
      await page.keyboard.up('ArrowUp');
    }
    await page.screenshot({ path: `test-results/${info.project.name}-${room.id}-furnished.png` });
    await page.getByRole('button', { name: 'Meeting rooms', exact: true }).click();
    await page.getByRole('button', { name: `Visit ${room.name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Cancel meeting', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Central Lounge', exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
