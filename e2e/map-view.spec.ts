import { test, expect } from '@playwright/test';
import { verifyWideMap } from './helpers/map-view.js';

test('zoomed-out city ground fills a large viewport', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 2560, height: 1440 });
  const name = `View${Date.now().toString().slice(-9)}`;
  await page.goto('/play/?create=1');
  await page.getByLabel('Email address').fill(`${name}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('a strong city password');
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('1990-01-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toContainText(name);
  await verifyWideMap(page, info);
});
