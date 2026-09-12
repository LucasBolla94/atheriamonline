/* global Image, document -- Used only inside Playwright's browser evaluation. */
import { Buffer } from 'node:buffer';
/** Deterministic chroma-key extraction and sprite sizing for our original art. */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const source = await readFile('apps/client/public/art/central-buildings-source.png');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const source = document.createElement('canvas');
    source.width = image.width;
    source.height = image.height;
    const context = source.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, source.width, source.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const r = pixels.data[i],
        g = pixels.data[i + 1],
        b = pixels.data[i + 2];
      if (r > 25 && b > 25 && r > g * 1.8 && b > g * 1.8) pixels.data[i + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
    const atlas = document.createElement('canvas');
    atlas.width = 384;
    atlas.height = 256;
    const target = atlas.getContext('2d');
    target.imageSmoothingEnabled = false;
    const names = ['hall', 'creative', 'events', 'lounge', 'market', 'shop'];
    const icons = {};
    for (let i = 0; i < 6; i++) {
      const col = i % 3,
        row = Math.floor(i / 3),
        ox = col * 512,
        oy = row * 512;
      let left = 512,
        right = -1,
        top = 512,
        bottom = -1;
      for (let y = 0; y < 512; y++)
        for (let x = 0; x < 512; x++) {
          if (pixels.data[((oy + y) * source.width + ox + x) * 4 + 3] === 0) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      if (right < left) throw new Error(`Empty building ${names[i]}`);
      const w = right - left + 1,
        h = bottom - top + 1;
      const dw = 128,
        dh = Math.round((h * dw) / w);
      target.drawImage(source, ox + left, oy + top, w, h, col * 128, row * 128 + 128 - dh, dw, dh);
      const icon = document.createElement('canvas');
      icon.width = 128;
      icon.height = 128;
      icon.getContext('2d').drawImage(atlas, col * 128, row * 128, 128, 128, 0, 0, 128, 128);
      icons[names[i]] = icon.toDataURL();
    }
    return { atlas: atlas.toDataURL(), icons };
  }, source.toString('base64'));
  const outputs = {
    'central-buildings': result.atlas,
    ...Object.fromEntries(
      Object.entries(result.icons).map(([key, value]) => [`building-${key}`, value]),
    ),
  };
  for (const [name, data] of Object.entries(outputs))
    await writeFile(
      `apps/client/public/art/${name}.png`,
      Buffer.from(data.split(',')[1], 'base64'),
    );
  console.log('Baked six original building sprites and their atlas.');
} finally {
  await browser.close();
}
