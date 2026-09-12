import { test, expect } from '@playwright/test';

test('the public city website connects discovery, questions and account creation', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A world of possibilities');
  await expect(page.locator('canvas')).toHaveCount(0);
  await page
    .locator('.landing__city > img')
    .evaluate((element) => (element as HTMLImageElement).decode());
  await expect(page.getByText('10 commercial addresses', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-landing.png` });
  if (info.project.name === 'mobile-landscape') {
    await page.setViewportSize({ width: 393, height: 851 });
    expect(await page.locator('.landing').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'test-results/mobile-portrait-landing.png' });
  }

  await page.getByRole('link', { name: 'Take a look around' }).click();
  await expect(page).toHaveURL(/#discover$/);
  await page.getByText('Are Crowns real money?', { exact: true }).click();
  await expect(page.getByText(/Crowns are game currency/)).toBeVisible();
  expect(await page.locator('.landing').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.getByRole('link', { name: 'Find your place' }).first().click();
  await expect(page).toHaveURL(/\/play\/\?create=1$/);
  await expect(page.getByRole('button', { name: 'Create my account', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
