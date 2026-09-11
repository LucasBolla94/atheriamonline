/**
 * The inside of a house.
 *
 * Every house is the same room: four walls, a wooden floor and a door. What
 * makes one different from another is what the owner has put in it.
 *
 * The layout lives in `@atheriam/shared` because three parts of the game need
 * to agree on it — the world server, which decides what may be walked on; the
 * API, which refuses to let furniture be placed in a wall; and the browser,
 * which draws it.
 */
import { SOLID_CHAR, type TerrainChar } from './terrain.js';
import type { TilePos } from './tile.js';

/** How big the inside of a house is, in tiles. */
export const HOUSE_WIDTH_TILES = 14;
export const HOUSE_HEIGHT_TILES = 10;

/** Where somebody appears when they come in: just inside the door. */
export const HOUSE_ENTRANCE: TilePos = { x: 7, y: 8 };

/**
 * The room, drawn once.
 *
 * A wall all the way round with a doorway in the south wall, and floorboards
 * inside. It is built rather than written out so that changing the size is
 * changing two numbers.
 */
function buildRoom(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < HOUSE_HEIGHT_TILES; y += 1) {
    let row = '';
    for (let x = 0; x < HOUSE_WIDTH_TILES; x += 1) {
      const edge =
        x === 0 || y === 0 || x === HOUSE_WIDTH_TILES - 1 || y === HOUSE_HEIGHT_TILES - 1;
      const doorway = y === HOUSE_HEIGHT_TILES - 1 && (x === 6 || x === 7);
      row += doorway ? '+' : edge ? '#' : 'd';
    }
    rows.push(row);
  }
  return rows;
}

/** The inside of every house, as rows of terrain characters. */
export const HOUSE_ROWS: readonly string[] = buildRoom();

/** What this tile of a house is made of. */
export function houseCharAt(pos: TilePos): TerrainChar {
  if (pos.x < 0 || pos.y < 0 || pos.x >= HOUSE_WIDTH_TILES || pos.y >= HOUSE_HEIGHT_TILES) {
    return SOLID_CHAR;
  }
  return (HOUSE_ROWS[pos.y]?.[pos.x] ?? SOLID_CHAR) as TerrainChar;
}

/**
 * May a piece of furniture stand here?
 *
 * Only on the floorboards: not in a wall, and not in the doorway, because
 * furniture in a doorway is how somebody shuts themselves out of their own
 * house.
 */
export function canPlaceFurniture(pos: TilePos): boolean {
  return houseCharAt(pos) === 'd';
}

/** The four ways a piece of furniture may face. */
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** True when this is one of the four rotations. */
export function isRotation(value: number): value is Rotation {
  return (ROTATIONS as readonly number[]).includes(value);
}
