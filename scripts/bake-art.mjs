/** Export the game loader's aligned, keyed atlases once, rather than on every phone. */
import { chromium } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173');
  const result = await page.evaluate(async () => {
    const { bakeArt } = await import('/src/game/art.ts');
    const art = await bakeArt();
    return {
      residents: art.residents.map((canvas) => canvas.toDataURL()),
      props: art.props.toDataURL(),
      portraits: art.portraits,
      icons: art.icons,
    };
  });
  const outputs = {
    'town.png': result.props,
    ...Object.fromEntries(result.residents.map((url, i) => [`resident-${i}.png`, url])),
    ...Object.fromEntries(result.portraits.map((url, i) => [`portrait-${i}.png`, url])),
    ...Object.fromEntries(Object.entries(result.icons).map(([id, url]) => [`${id}.png`, url])),
  };
  for (const [name, url] of Object.entries(outputs))
    await writeFile(`apps/client/public/art/${name}`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`Exported ${Object.keys(outputs).length} game-ready images.`);
} finally {
  await browser.close();
}
