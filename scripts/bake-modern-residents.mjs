/* global Image, document -- Runs in the browser's canvas implementation. */
import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Packaging original generated artwork for the engine; no semantic retouching.
const sourceName = process.argv[2] ?? 'resident-modern-source';
const firstLook = Number(process.argv[3] ?? 0);
const source = await readFile(`apps/client/public/art/${sourceName}.png`);
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
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const pixels = imageData.data;
    if (pixels[3] !== 0) {
      // Same chroma-key packaging used by the original resident importer.
      // The generated source is retained unchanged; only its uniform key is removed.
      if (!(pixels[0] > 220 && pixels[1] < 60 && pixels[2] > 220))
        throw new Error('Resident source needs genuine alpha or a solid magenta key');
      for (let i = 0; i < pixels.length; i += 4)
        // Include darker blended key pixels along the silhouette. The jacket's
        // lilac palette has substantial green; the magenta backdrop does not.
        if (
          pixels[i] > 80 &&
          pixels[i + 2] > 80 &&
          pixels[i + 1] < pixels[i] * 0.5 &&
          pixels[i + 1] < pixels[i + 2] * 0.5
        )
          pixels[i + 3] = 0;
      ctx.putImageData(imageData, 0, 0);
    }
    const output = document.createElement('canvas');
    output.width = 192;
    output.height = 288;
    const target = output.getContext('2d');
    target.imageSmoothingEnabled = false;
    // Generated silhouettes may cross a nominal cell boundary. Extract complete
    // connected silhouettes first, then assign each by its centre to the grid.
    const groups = Array.from({ length: 36 }, () => ({
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
      const col = Math.min(5, Math.floor(((left + right) * 3) / image.width));
      const row = Math.min(5, Math.floor(((top + bottom) * 3) / image.height));
      const group = groups[row * 6 + col];
      group.left = Math.min(group.left, left);
      group.right = Math.max(group.right, right);
      group.top = Math.min(group.top, top);
      group.bottom = Math.max(group.bottom, bottom);
    }
    const frames = [];
    const scale = 40 / Math.max(...groups.slice(0, 30).map((box) => box.bottom - box.top + 1));
    for (let index = 0; index < 36; index++) {
      const col = index % 6,
        row = Math.floor(index / 6);
      const { left, right, top, bottom } = groups[index];
      if (right < left) throw new Error(`Empty resident frame ${index}`);
      const width = right - left + 1,
        height = bottom - top + 1;
      const w = Math.round(width * scale),
        h = Math.round(height * scale);
      // Wave arms change silhouette width. Keep the body anchored to the
      // corresponding walking column rather than recentering the raised hand.
      const body = groups[col];
      const center = row === 4 ? (body.left + body.right) / 2 : (left + right) / 2;
      const x = col * 32 + Math.round(16 + (left - center) * scale);
      const y = row * 48 + 44 - h;
      if (x < col * 32 || x + w > (col + 1) * 32 || h > 44)
        throw new Error(`Resident frame ${index} would be clipped`);
      target.drawImage(original, left, top, width, height, x, y, w, h);
      frames.push({ index, width, height });
    }
    const portrait = document.createElement('canvas');
    portrait.width = 32;
    portrait.height = 48;
    portrait.getContext('2d').drawImage(output, 0, 192, 32, 48, 0, 0, 32, 48);
    return {
      data: output.toDataURL(),
      portrait: portrait.toDataURL(),
      frames,
      sourceWidth: image.width,
      sourceHeight: image.height,
    };
  }, source.toString('base64'));
  for (const [name, url] of [
    [`resident-modern-${firstLook}.png`, result.data],
    [`portrait-modern-${firstLook}.png`, result.portrait],
  ])
    await writeFile(`apps/client/public/art/${name}`, Buffer.from(url.split(',')[1], 'base64'));
  // Reuse the established curated outfit-dye approach for the paired look.
  const dyed = await page.evaluate(
    async ({ data, look }) => {
      const image = new Image();
      image.src = data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 288;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, 192, 288);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const [r, g, b] = pixels.data.slice(i, i + 3);
        if (look === 0 && g > r * 1.3 && b > r * 1.4 && g >= b * 0.85) {
          pixels.data[i] = Math.min(255, Math.round(g * 1.65));
          pixels.data[i + 1] = Math.round(g * 0.76);
          pixels.data[i + 2] = Math.round(b * 0.62);
        } else if (look === 2 && b > r * 1.1 && b > g * 1.1 && r >= g * 0.9) {
          pixels.data[i] = Math.min(255, Math.round(b * 1.1));
          pixels.data[i + 1] = Math.round(b * 0.8);
          pixels.data[i + 2] = Math.round(b * 0.37);
        } else if (look === 4 && b > r * 1.5 && b > g * 1.2) {
          pixels.data[i] = Math.round(b * 0.55);
          pixels.data[i + 1] = Math.round(b * 0.84);
          pixels.data[i + 2] = Math.round(b * 0.68);
        }
      }
      ctx.putImageData(pixels, 0, 0);
      const portrait = document.createElement('canvas');
      portrait.width = 32;
      portrait.height = 48;
      portrait.getContext('2d').drawImage(canvas, 0, 192, 32, 48, 0, 0, 32, 48);
      return { data: canvas.toDataURL(), portrait: portrait.toDataURL() };
    },
    { data: result.data, look: firstLook },
  );
  for (const [name, url] of [
    [`resident-modern-${firstLook + 1}.png`, dyed.data],
    [`portrait-modern-${firstLook + 1}.png`, dyed.portrait],
  ])
    await writeFile(`apps/client/public/art/${name}`, Buffer.from(url.split(',')[1], 'base64'));
  process.stdout.write(`${JSON.stringify({ ...result, data: undefined, portrait: undefined })}\n`);
} finally {
  await browser.close();
}
