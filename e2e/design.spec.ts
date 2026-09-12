import { expect, test, type Page } from '@playwright/test';
import { E2E_CLIENT_PORT } from './global-setup.js';

async function join(page: Page, prefix: string) {
  const name = `${prefix}${Date.now().toString().slice(-8)}`;
  await page.goto('/play/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Create an account' }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Sunset coral' }).click({ noWaitAfter: true });
  await page.getByLabel('Email address').fill(`${name}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('a very good password');
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('1990-01-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click({ noWaitAfter: true });
  await expect(page.locator('.hud')).toContainText(name);
  await expect(page.locator('.resident-card img')).toBeVisible();
  await expect(page.locator('.resident-card img')).toHaveAttribute(
    'src',
    '/art/portrait-modern-1.png',
  );
  return name;
}

test('visual review: entry, city, saved looks and mobile portrait', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/play/', { waitUntil: 'domcontentloaded' });
  await page
    .locator('.welcome-art__image')
    .evaluate((image) => (image as HTMLImageElement).decode());
  await page.screenshot({ path: `test-results/${info.project.name}-login.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Create an account' }).click({ noWaitAfter: true });
  await page.screenshot({ path: `test-results/${info.project.name}-register.png`, fullPage: true });
  const name = await join(page, 'Design');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `test-results/${info.project.name}-city.png` });
  const observerContext = await browser.newContext({
    baseURL: `http://127.0.0.1:${E2E_CLIENT_PORT}`,
  });
  const observer = await observerContext.newPage();
  const received: Array<{ players?: Array<{ name: string; appearance?: number }> }> = [];
  observer.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      try {
        received.push(JSON.parse(String(payload)));
      } catch {
        /* Ignore unrelated payloads. */
      }
    }),
  );
  try {
    await join(observer, 'Neighbour');
    await page.bringToFront();
    await page.getByRole('button', { name: 'Your look' }).click({ noWaitAfter: true });
    await page.getByRole('button', { name: 'Studio lilac' }).click({ noWaitAfter: true });
    await expect(page.getByRole('button', { name: 'Studio lilac' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.screenshot({ path: `test-results/${info.project.name}-looks.png` });
    await page.getByRole('button', { name: 'Wear this look' }).click({ noWaitAfter: true });
    await expect
      .poll(() =>
        received.some((message) =>
          message.players?.some((player) => player.name === name && player.appearance === 2),
        ),
      )
      .toBe(true);
    await page.reload();
    await expect(page.locator('.hud')).toContainText(name);
    await page.getByRole('button', { name: 'Your look' }).click({ noWaitAfter: true });
    await expect(page.getByRole('button', { name: 'Studio lilac' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Close', exact: true }).click({ noWaitAfter: true });
    if (info.project.name === 'mobile-landscape') {
      await page.setViewportSize({ width: 393, height: 851 });
      await expect
        .poll(async () => (await page.locator('canvas').boundingBox())?.height)
        .toBeGreaterThan(840);
      await page.getByLabel('Say something').fill('Hello from my phone!');
      await page.getByRole('button', { name: 'Say', exact: true }).click({ noWaitAfter: true });
      await expect(observer.locator('.chat__log')).toContainText('Hello from my phone!');
      const before = await page.locator('.location-card').innerText();
      await page.getByRole('button', { name: 'Walk east', exact: true }).tap();
      await expect(page.locator('.location-card')).not.toHaveText(before);
      await page.screenshot({ path: 'test-results/mobile-portrait-city.png' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.setViewportSize({ width: 320, height: 740 });
      const resident = await page.locator('.resident-card').boundingBox();
      const location = await page.locator('.location-card').boundingBox();
      expect(resident!.x + resident!.width).toBeLessThanOrEqual(location!.x);
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect
        .poll(async () => (await page.locator('canvas').boundingBox())?.height)
        .toBeGreaterThan(1016);
      const tabletBefore = await page.locator('.location-card').innerText();
      await page.locator('canvas').click({ position: { x: 448, y: 512 } });
      await expect(page.locator('.location-card')).not.toHaveText(tabletBefore);
    }
  } finally {
    await observerContext.close();
  }
  expect(errors).toEqual([]);
});
