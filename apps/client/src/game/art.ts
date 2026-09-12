/** Game-ready atlases assembled once from the original chroma-key source sheets. */
export const PROP_NAMES = [
  'tree',
  'well',
  'stall',
  'cottage',
  'oak-stool',
  'rush-mat',
  'clay-lamp',
  'long-table',
  'wool-rug',
  'copper-pin',
  'river-stone',
  'brass-bell',
] as const;
export const BUILDING_NAMES = ['hall', 'creative', 'events', 'lounge', 'market', 'shop'] as const;

export interface GameArt {
  buildings: HTMLCanvasElement;
  residents: HTMLCanvasElement[];
  props: HTMLCanvasElement;
  portraits: string[];
  icons: Record<string, string>;
}
let pending: Promise<GameArt> | undefined;

function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

async function load(path: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = path;
  await image.decode();
  return image;
}

/** Chroma-keying is part of the loader, so the original artwork stays editable. */
function keyImage(image: HTMLImageElement): HTMLCanvasElement {
  const result = canvas(image.width, image.height);
  const ctx = result.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, result.width, result.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const r = pixels.data[i] ?? 0;
    const g = pixels.data[i + 1] ?? 0;
    const b = pixels.data[i + 2] ?? 0;
    if (r > 25 && b > 25 && r > g * 1.5 && b > g * 1.5) pixels.data[i + 3] = 0;
  }
  ctx.putImageData(pixels, 0, 0);
  return result;
}

function bounds(source: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const data = source.getContext('2d')!.getImageData(x, y, w, h).data;
  let left = w,
    top = h,
    right = 0,
    bottom = 0;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      if ((data[(py * w + px) * 4 + 3] ?? 0) < 128) continue;
      left = Math.min(left, px);
      top = Math.min(top, py);
      right = Math.max(right, px);
      bottom = Math.max(bottom, py);
    }
  if (left > right) throw new Error('An art frame is empty.');
  return { x: x + left, y: y + top, w: right - left + 1, h: bottom - top + 1 };
}

function residentSheet(image: HTMLImageElement, variant: number): HTMLCanvasElement {
  const keyed = keyImage(image);
  const result = canvas(192, 192);
  const ctx = result.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const rowEdges = [0, 272, 512, 768, 1024];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 6; col++) {
      const y = rowEdges[row]!;
      const box = bounds(keyed, col * 256, y, 256, rowEdges[row + 1]! - y);
      // A common scale and foot anchor keep footsteps stable between source poses.
      const w = Math.round(box.w * 0.19),
        h = Math.round(box.h * 0.19);
      ctx.drawImage(
        keyed,
        box.x,
        box.y,
        box.w,
        box.h,
        col * 32 + Math.round((32 - w) / 2),
        row * 48 + 44 - h,
        w,
        h,
      );
    }
  if (variant > 0) {
    const pixels = ctx.getImageData(0, 0, 192, 192);
    for (let i = 0; i < pixels.data.length; i += 4) {
      // Curated alternate dyes. Skin, dark outlines and leather are preserved.
      const r = pixels.data[i]!,
        g = pixels.data[i + 1]!,
        b = pixels.data[i + 2]!;
      const py = Math.floor(i / 4 / 192) % 48;
      const px = (i / 4) % 32;
      const onTunic = py >= 26 && py <= 34 && px >= 9 && px <= 22;
      if (variant === 1 && b > r * 1.2 && g > r * 1.3) {
        pixels.data[i] = Math.round(g * 0.62);
        pixels.data[i + 1] = Math.round(g * 1.12);
        pixels.data[i + 2] = Math.round(b * 0.45);
      } else if (variant === 2 && onTunic && r > g * 1.6 && g < 125 && r > 145) {
        pixels.data[i] = Math.round(r * 0.64);
        pixels.data[i + 1] = Math.round(r * 0.38);
        pixels.data[i + 2] = Math.round(r * 0.72);
      } else if (
        variant === 3 &&
        onTunic &&
        r > 100 &&
        g > 80 &&
        b < r * 0.9 &&
        Math.abs(r - g) < 80
      ) {
        pixels.data[i] = Math.round(r * 0.33);
        pixels.data[i + 1] = Math.round(g * 0.55);
        pixels.data[i + 2] = Math.round(r * 0.71);
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }
  return result;
}

export async function bakeArt(): Promise<GameArt> {
  return (async () => {
    const sources = await Promise.all(
      ['resident-source', 'resident-ponytail-source', 'resident-curly-source', 'town-source'].map(
        (name) => load(`/art/${name}.png`),
      ),
    );
    const residents: HTMLCanvasElement[] = [];
    for (let i = 0; i < 6; i++) {
      residents.push(residentSheet(sources[i % 3]!, i >= 3 ? i - 2 : 0));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const portraits = residents.map((sheet) => {
      const out = canvas(32, 48);
      out.getContext('2d')!.drawImage(sheet, 32, 0, 32, 48, 0, 0, 32, 48);
      return out.toDataURL();
    });
    const keyed = keyImage(sources[3]!);
    const props = canvas(512, 384);
    const ctx = props.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const icons: Record<string, string> = {};
    for (let i = 0; i < 12; i++) {
      const row = Math.floor(i / 4),
        col = i % 4;
      const y = Math.floor((row * 1024) / 3),
        bottom = Math.floor(((row + 1) * 1024) / 3);
      const box = bounds(keyed, col * 384, y, 384, bottom - y);
      const scale = Math.min(120 / box.w, 120 / box.h);
      const w = Math.round(box.w * scale),
        h = Math.round(box.h * scale);
      ctx.drawImage(
        keyed,
        box.x,
        box.y,
        box.w,
        box.h,
        col * 128 + Math.round((128 - w) / 2),
        row * 128 + 124 - h,
        w,
        h,
      );
      const icon = canvas(128, 128);
      icon.getContext('2d')!.drawImage(props, col * 128, row * 128, 128, 128, 0, 0, 128, 128);
      icons[PROP_NAMES[i]!] = icon.toDataURL();
    }
    return { residents, props, portraits, icons, buildings: await loadBuildings() };
  })().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
}

export function prepareArt(): Promise<GameArt> {
  pending ??= (async () => {
    const loaded = await Promise.all(
      Array.from({ length: 6 }, (_, i) => load(`/art/resident-${i}.png`)),
    );
    const residents = loaded.map((image) => {
      const out = canvas(192, 192);
      out.getContext('2d')!.drawImage(image, 0, 0);
      return out;
    });
    const town = await load('/art/town.png');
    const props = canvas(512, 384);
    props.getContext('2d')!.drawImage(town, 0, 0);
    return {
      residents,
      props,
      buildings: await loadBuildings(),
      portraits: Array.from({ length: 6 }, (_, i) => `/art/portrait-${i}.png`),
      icons: Object.fromEntries(PROP_NAMES.map((name) => [name, `/art/${name}.png`])),
    };
  })().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

async function loadBuildings(): Promise<HTMLCanvasElement> {
  const image = await load('/art/central-buildings.png');
  const out = canvas(384, 256);
  out.getContext('2d')!.drawImage(image, 0, 0);
  return out;
}
