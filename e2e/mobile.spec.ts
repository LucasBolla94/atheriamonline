/**
 * The things that only go wrong on a small screen.
 *
 * Playwright runs every spec twice: once on a desktop browser and once on a
 * phone in landscape. These tests are written so that both runs are
 * meaningful, but each of them is here because of the phone.
 */
import { expect, test, type Page } from '@playwright/test';

function unique(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`;
}

const PASSWORD = 'correct horse battery staple';

async function fillTheCreateForm(page: Page): Promise<string> {
  const name = unique('Pocket');
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create an account' }).click();
  await page.getByLabel('Email address').fill(`${name.toLowerCase()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('1990-05-04');
  return name;
}

test('the whole sign-up form can be reached on a short screen', async ({ page }) => {
  await fillTheCreateForm(page);

  // The form is taller than a phone held sideways. If the screen cannot
  // scroll, the tick box and the button below it are simply unreachable —
  // which is the same as the game not existing on a phone.
  const checkbox = page.getByRole('checkbox');
  await checkbox.scrollIntoViewIfNeeded();
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  const submit = page.getByRole('button', { name: 'Create my account' });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeVisible();
  await submit.click();

  await expect(page.locator('.hud')).toBeVisible();
});

test('the page itself never scrolls sideways', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the city fills the screen once you are in it', async ({ page }) => {
  await fillTheCreateForm(page);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toBeVisible();

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error('No canvas and no viewport.');

  // Within a few pixels of the whole window, in both directions.
  expect(box.width).toBeGreaterThan(viewport.width - 8);
  expect(box.height).toBeGreaterThan(viewport.height - 8);
});

test('the chat can be folded out of the way and brought back', async ({ page }) => {
  await fillTheCreateForm(page);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toBeVisible();

  await expect(page.getByLabel('Say something')).toBeVisible();

  await page.getByRole('button', { name: 'Hide chat' }).click();
  await expect(page.getByLabel('Say something')).toBeHidden();

  await page.getByRole('button', { name: /Show chat/ }).click();
  await expect(page.getByLabel('Say something')).toBeVisible();
});

test('every button in a panel can be reached on a short screen', async ({ page }) => {
  await fillTheCreateForm(page);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toBeVisible();

  /*
   * The panels that open over the city are taller than a phone held sideways.
   * Each of these was, at some point, a panel whose bottom button could not be
   * reached at all — which is the same as the feature not existing on a phone.
   */
  await page.getByRole('button', { name: /Purse/ }).click();
  const purse = page.getByRole('dialog');
  await expect(purse.getByRole('button', { name: 'Close' })).toBeVisible();
  await purse.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Go home' }).click();
  const house = page.getByRole('dialog');
  await expect(house.getByRole('button', { name: 'Close' })).toBeVisible();
  await house.getByRole('button', { name: 'Close' }).click();
});

test('every control can be reached with the keyboard alone', async ({ page }) => {
  await page.goto('/');

  // Tab through the form and check the focus actually lands on things, rather
  // than disappearing into the page.
  const reached: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    reached.push(
      await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? 'none'),
    );
  }

  expect(reached).toContain('input');
  expect(reached).toContain('button');
  expect(reached).not.toContain('none');
});

test('walking never blocks the browser for long', async ({ page }, testInfo) => {
  // Only on the phone-sized run. This machine has no GPU, so a browser here
  // rasterises in software: a 1280x720 canvas costs about a tenth of a second
  // a frame whatever is drawn on it, and the measurement would be about that
  // rather than about the game. At phone size there is headroom to see the
  // difference between work we do and work the renderer does.
  test.skip(
    testInfo.project.name !== 'mobile-landscape',
    'Measured on the phone-sized run, where software rendering leaves headroom.',
  );

  await fillTheCreateForm(page);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toBeVisible();

  // Let the game finish starting before anything is measured. Building the
  // renderer and painting the first few chunks is a burst of work that happens
  // once; this test is about what happens afterwards, while somebody walks.
  await page.waitForTimeout(2000);

  /**
   * Watch for long tasks while the player walks across a chunk boundary.
   *
   * Frames per second cannot be measured honestly in a headless browser on a
   * server — it has no screen to keep in step with. What can be measured is
   * the thing that would ruin a real phone: a single piece of work that holds
   * the main thread for a tenth of a second, which is what happens when the
   * ground is rebuilt every frame instead of once per chunk.
   *
   * `docs/SPEC.md` section 11 asks for 16 ms. A headless browser on a server
   * with no graphics card, sharing a CPU with three dev servers, cannot prove
   * 16 ms — its ordinary frames cost 50 to 100 ms all by themselves. So this
   * guards the order of magnitude instead: a fifth of a second is far above
   * the noise and far below the 400 ms burst that drawing several chunks at
   * once used to cost. See D-035 and D-056.
   */
  await page.evaluate(() => {
    const window_ = window as unknown as { __longTasks: number[] };
    window_.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window_.__longTasks.push(entry.duration);
    }).observe({ entryTypes: ['longtask'] });
  });

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('The game canvas has no size.');

  // Walk one way, then the other, crossing the ground the client has to load.
  await canvas.click({ position: { x: box.width / 2 + 120, y: box.height / 2 } });
  await page.waitForTimeout(2500);
  await canvas.click({ position: { x: box.width / 2 - 120, y: box.height / 2 } });
  await page.waitForTimeout(2500);

  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks: number[] }).__longTasks,
  );
  const worst = longTasks.length === 0 ? 0 : Math.max(...longTasks);
  expect(worst).toBeLessThan(200);
});
