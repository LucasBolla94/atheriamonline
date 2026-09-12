import type { TilePos } from './tile.js';

/** Public venues and businesses share a spacious, server-owned floor plan. */
export const INTERIOR_WIDTH = 20;
export const INTERIOR_HEIGHT = 16;
export const INTERIOR_ENTRANCE: TilePos = { x: 10, y: 14 };
export const INTERIOR_ROWS: readonly string[] = Array.from({ length: INTERIOR_HEIGHT }, (_, y) =>
  Array.from({ length: INTERIOR_WIDTH }, (_, x) => {
    if (y === INTERIOR_HEIGHT - 1 && (x === 9 || x === 10)) return '+';
    return x === 0 || y === 0 || x === INTERIOR_WIDTH - 1 || y === INTERIOR_HEIGHT - 1 ? '#' : 'd';
  }).join(''),
);

/** Keep a two-tile entrance aisle clear, even when the room is fully decorated. */
export function canDecorateInterior({ x, y }: TilePos): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    INTERIOR_ROWS[y]?.[x] === 'd' &&
    !((x === 9 || x === 10) && y >= 12)
  );
}
