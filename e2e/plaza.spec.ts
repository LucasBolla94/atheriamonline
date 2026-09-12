import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 15_000 });
test('a resident can approach the fountain through the clear square', async ({ page }, info) => {
  test.setTimeout(90_000);
  const name = `Square${Date.now().toString().slice(-9)}`;
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
  await expect(page.locator('.location-card')).toContainText('80, 85');
  if (info.project.name === 'mobile-landscape') {
    for (let y = 84; y >= 81; y--) {
      await page.getByRole('button', { name: 'Walk north', exact: true }).tap();
      await expect(page.locator('.location-card')).toContainText(`80, ${y}`);
    }
  } else {
    await page.keyboard.down('ArrowUp');
    try {
      await expect(page.locator('.location-card')).not.toContainText('80, 85');
    } finally {
      await page.keyboard.up('ArrowUp');
    }
  }
  // Let the camera finish following before retaining the visual review.
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `test-results/${info.project.name}-square-approach.png` });
  expect(errors).toEqual([]);
});
