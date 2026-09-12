/* global Image, document -- Runs in the browser's canvas implementation. */
import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Packaging original generated artwork for the engine; no semantic retouching.
const source = await readFile('apps/client/public/art/city-furniture-source.png');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const original = document.createElement('canvas');
    original.width = image.width;
    original.height = image.height;
    const ctx = original.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    if (pixels[3] !== 0) throw new Error('The furniture atlas must have genuine transparency');
    const output = document.createElement('canvas');
    output.width = 512;
    output.height = 576;
    const target = output.getContext('2d');
    target.imageSmoothingEnabled = false;
    // Generated silhouettes may cross a nominal cell boundary. Extract complete
    // connected silhouettes first, then assign each by its centre to the grid.
    const groups = Array.from({ length: 12 }, () => ({
      left: image.width,
      right: -1,
      top: image.height,
      bottom: -1,
    }));
    const seen = new Uint8Array(image.width * image.height);
    for (let pixel = 0; pixel < seen.length; pixel++) {
      if (seen[pixel] || pixels[pixel * 4 + 3] < 32) continue;
      const queue = [pixel];
      seen[pixel] = 1;
      let left = image.width,
        right = -1,
        top = image.height,
        bottom = -1;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const current = queue[cursor],
          x = current % image.width,
          y = Math.floor(current / image.width);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        const neighbors = [];
        if (x > 0) neighbors.push(current - 1);
        if (x + 1 < image.width) neighbors.push(current + 1);
        if (y > 0) neighbors.push(current - image.width);
        if (y + 1 < image.height) neighbors.push(current + image.width);
        for (const next of neighbors)
          if (!seen[next] && pixels[next * 4 + 3] >= 32) {
            seen[next] = 1;
            queue.push(next);
          }
      }
      if (queue.length < 32) continue;
      const col = Math.min(3, Math.floor(((left + right) * 2) / image.width));
      const row = Math.min(2, Math.floor(((top + bottom) * 1.5) / image.height));
      const group = groups[row * 4 + col];
      group.left = Math.min(group.left, left);
      group.right = Math.max(group.right, right);
      group.top = Math.min(group.top, top);
      group.bottom = Math.max(group.bottom, bottom);
    }
    const frames = [];
    for (let index = 0; index < 12; index++) {
      const col = index % 4,
        row = Math.floor(index / 4);
      const { left, right, top, bottom } = groups[index];
      if (right < left) throw new Error(`Empty furniture frame ${index}`);
      const width = right - left + 1,
        height = bottom - top + 1;
      const scale = Math.min(120 / width, 184 / height);
      const w = Math.round(width * scale),
        h = Math.round(height * scale);
      target.drawImage(
        original,
        left,
        top,
        width,
        height,
        col * 128 + Math.round((128 - w) / 2),
        row * 192 + 188 - h,
        w,
        h,
      );
      frames.push({ index, width, height });
    }
    return {
      data: output.toDataURL(),
      frames,
      sourceWidth: image.width,
      sourceHeight: image.height,
    };
  }, source.toString('base64'));
  await writeFile(
    'apps/client/public/art/city-furniture.png',
    Buffer.from(result.data.split(',')[1], 'base64'),
  );
  process.stdout.write(`${JSON.stringify({ ...result, data: undefined })}\n`);
} finally {
  await browser.close();
}
