import { expect, type Page, type TestInfo } from '@playwright/test';

/** Compare the same wide minimum-zoom view locally and after publishing. */
export async function verifyWideMap(page: Page, info: TestInfo): Promise<void> {
  await page.mouse.move(1280, 500);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `test-results/${info.project.name}-zoom-out.png` });
  const unknownFraction = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx)
      throw new Error('This pixel coverage check requires the native Canvas test renderer.');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let unknown = 0,
      sampled = 0;
    for (let y = 8; y < canvas.height - 8; y += 8)
      for (let x = 8; x < canvas.width - 8; x += 8) {
        const i = (y * canvas.width + x) * 4;
        sampled++;
        if (data[i] === 0x52 && data[i + 1] === 0x6c && data[i + 2] === 0x51) unknown++;
      }
    return unknown / sampled;
  });
  await info.attach('unknown-ground-fraction', {
    body: String(unknownFraction),
    contentType: 'text/plain',
  });
  expect(unknownFraction).toBeLessThan(0.005);
}
