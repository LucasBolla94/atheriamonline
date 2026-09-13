import { MAX_TERRAIN_VIEW_TILES, TILE_SIZE_PX } from '@atheriam/shared';

/** Exponential easing gives the same catch-up at 30, 60 and 144 frames/second. */
export function movementBlend(deltaMs: number): number {
  return 1 - Math.exp(-0.012 * Math.max(0, deltaMs));
}

/** Camera bounds may move its centre away from the resident near city edges. */
export function terrainViewForCamera(
  view: { x: number; y: number; width: number; height: number },
  resident: { x: number; y: number },
  world: { width: number; height: number },
): { radiusX: number; radiusY: number } {
  const left = Math.max(0, view.x / TILE_SIZE_PX);
  const right = Math.min(world.width, (view.x + view.width) / TILE_SIZE_PX);
  const top = Math.max(0, view.y / TILE_SIZE_PX);
  const bottom = Math.min(world.height, (view.y + view.height) / TILE_SIZE_PX);
  const bounded = (radius: number) =>
    Math.min(MAX_TERRAIN_VIEW_TILES, Math.max(1, Math.ceil(radius / 4) * 4));
  return {
    radiusX: bounded(Math.max(Math.abs(left - resident.x), Math.abs(right - resident.x)) + 8),
    // A facade can project sixteen tiles above its entrance chunk.
    radiusY: bounded(Math.max(Math.abs(top - resident.y), Math.abs(bottom - resident.y)) + 20),
  };
}
