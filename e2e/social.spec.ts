import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { characters, connect } from '../packages/db/src/index.js';
import { E2E_API_PORT, E2E_CLIENT_PORT, E2E_DATABASE_NAME, e2eEnv } from './global-setup.js';

type View = {
  id: string;
  name: string;
  pose?: 'wave' | 'sit';
  seat?: { x: number; y: number; offsetX?: number };
};
function observe(page: Page) {
  const players = new Map<string, View>();
  const waved = new Set<string>();
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.t !== 'snapshot') return;
      for (const player of [message.you, ...(message.players ?? [])]) {
        players.set(player.name, player);
        if (player.pose === 'wave') waved.add(player.name);
      }
      for (const id of message.gone ?? [])
        for (const [name, player] of players) if (player.id === id) players.delete(name);
    }),
  );
  return { players, waved };
}

async function joinBesideBench(page: Page, prefix: string, x: number, appearance: number) {
  const name = `${prefix}${Date.now().toString().slice(-9)}`;
  const origin = `http://127.0.0.1:${E2E_CLIENT_PORT}`;
  const response = await page.request.post(`http://127.0.0.1:${E2E_API_PORT}/api/auth/register`, {
    headers: { origin },
    data: {
      email: `${name}@example.com`,
      password: 'a strong city password',
      dateOfBirth: '1990-01-01',
      characterName: name,
      appearance,
      confirmsAdult: true,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const url = e2eEnv()['DATABASE_URL']!;
  expect(new URL(url).pathname).toBe(`/${E2E_DATABASE_NAME}`);
  const handle = connect(url);
  try {
    // No world socket exists yet, so there is no live position to overwrite.
    await handle.db.update(characters).set({ x, y: 82 }).where(eq(characters.name, name));
  } finally {
    await handle.close();
  }
  await page.goto('/play/');
  try {
    await expect(page.locator('.hud')).toContainText(name, { timeout: 45_000 });
  } catch (error) {
    await test.info().attach(`${name}-entry-state`, {
      body: JSON.stringify({ url: page.url(), text: await page.locator('body').innerText() }),
      contentType: 'application/json',
    });
    throw error;
  }
  await expect(page.locator('.location-card')).toContainText(`${x}, 82`);
  return name;
}

// Social buttons do not navigate. Await their authoritative state below;
// keep Playwright's normal visibility, stability and hit-target checks.
test.use({ actionTimeout: 30_000 });
test('neighbours see waves, occupied seats and standing up', async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: `http://127.0.0.1:${E2E_CLIENT_PORT}`,
  });
  const neighbour = await context.newPage();
  const { players: seen, waved } = observe(neighbour);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  neighbour.on('pageerror', (error) => errors.push(error.message));
  try {
    const name = await joinBesideBench(page, 'Friendly', 68, 0);
    await joinBesideBench(neighbour, 'Social', 70, 2);
    await expect.poll(() => seen.has(name)).toBe(true);
    await page.bringToFront();
    await page
      .getByRole('button', { name: 'Your actions', exact: true })
      .click({ noWaitAfter: true });
    await page.getByRole('button', { name: 'Wave', exact: true }).click({ noWaitAfter: true });
    await expect.poll(() => waved.has(name), { intervals: [50] }).toBe(true);
    await expect.poll(() => seen.get(name)?.pose).toBeUndefined();
    // Wave cooldown has elapsed after the authoritative expiry.
    await page.waitForTimeout(250);
    await page
      .getByRole('button', { name: 'Your actions', exact: true })
      .click({ noWaitAfter: true });
    await page
      .getByRole('button', { name: 'Sit nearby', exact: true })
      .click({ noWaitAfter: true });
    await expect(page.locator('.resident-card')).toContainText('Seated');
    await expect.poll(() => seen.get(name)?.seat).toEqual({ x: 68, y: 81, offsetX: 8 });
    await neighbour.bringToFront();
    await neighbour
      .getByRole('button', { name: 'Your actions', exact: true })
      .click({ noWaitAfter: true });
    await neighbour
      .getByRole('button', { name: 'Sit nearby', exact: true })
      .click({ noWaitAfter: true });
    await expect(neighbour.locator('.resident-card')).toContainText('Seated');
    await page.bringToFront();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/${info.project.name}-social-seating.png` });
    await page
      .getByRole('button', { name: 'Your actions', exact: true })
      .click({ noWaitAfter: true });
    await page.getByRole('button', { name: 'Stand up', exact: true }).click({ noWaitAfter: true });
    await expect(page.locator('.resident-card')).not.toContainText('Seated');
    await expect.poll(() => seen.get(name)?.pose).toBeUndefined();
    await expect.poll(() => seen.get(name)?.seat).toBeUndefined();
    await page.reload();
    try {
      await expect(page.locator('.hud')).toContainText(name, { timeout: 45_000 });
    } catch (error) {
      await test.info().attach(`${name}-entry-state`, {
        body: JSON.stringify({ url: page.url(), text: await page.locator('body').innerText() }),
        contentType: 'application/json',
      });
      throw error;
    }
    await expect(page.locator('.resident-card img')).toHaveAttribute(
      'src',
      '/art/portrait-modern-0.png',
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('one resident can use the visible social controls', async ({ page }, info) => {
  test.setTimeout(120_000);
  await joinBesideBench(page, 'Solo', 68, 4);
  await page
    .getByRole('button', { name: 'Your actions', exact: true })
    .click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Wave', exact: true }).click({ noWaitAfter: true });
  await expect(page.locator('.resident-card')).toContainText('Waving');
  await expect(page.locator('.resident-card')).not.toContainText('Waving');
  await page.waitForTimeout(250);
  await page
    .getByRole('button', { name: 'Your actions', exact: true })
    .click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Sit nearby', exact: true }).click({ noWaitAfter: true });
  await expect(page.locator('.resident-card')).toContainText('Seated');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `test-results/${info.project.name}-solo-seating.png` });
  await page
    .getByRole('button', { name: 'Your actions', exact: true })
    .click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Stand up', exact: true }).click({ noWaitAfter: true });
  await expect(page.locator('.resident-card')).not.toContainText('Seated');
});
