import { test, expect } from '@playwright/test';
import { CITY_BUILDINGS } from '../packages/shared/src/city.js';

test.use({ actionTimeout: 15_000 });
test('the five public entrances lead to furnished spaces with a usable exit', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const name = `Visitor${Date.now().toString().slice(-9)}`;
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
  for (const id of ['central-lounge', 'city-hall', 'creative-hub', 'events-hall', 'market-hall']) {
    const building = CITY_BUILDINGS.find((entry) => entry.id === id)!;
    await page.getByRole('button', { name: 'City guide', exact: true }).click();
    const card = page
      .locator('.city-guide__card')
      .filter({ has: page.getByRole('heading', { name: building.name, exact: true }) });
    await card.getByRole('button', { name: 'Walk to entrance', exact: true }).click();
    const door = page.getByRole('button', {
      name: `Enter environment: ${building.name}`,
      exact: true,
    });
    await expect(door).toBeVisible();
    await door.click();
    await expect(page.getByRole('dialog', { name: building.name, exact: true })).toContainText(
      'furnished by the city',
    );
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.location-card')).toContainText(building.name);
    await expect(page.locator('canvas')).toBeVisible();
    await page.screenshot({ path: `test-results/${info.project.name}-${id}-furnished.png` });
    await page.getByRole('button', { name: 'Step outside', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Go home', exact: true })).toBeVisible();
    await expect(page.locator('.location-card')).not.toContainText(building.name);
  }
  expect(errors).toEqual([]);
});
