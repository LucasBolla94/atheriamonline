/** Original contemporary city. Building footprints and addresses are shared. */
import {
  CITY_BUILDINGS,
  DEFAULT_SPAWN_TILE,
  STARTER_CITY,
  type TerrainChar,
  type TilePos,
} from '@atheriam/shared';

export const CITY_SIZE_TILES = STARTER_CITY.size;
export const CITY_SPAWN: TilePos = DEFAULT_SPAWN_TILE;

export function buildStarterDistrict(): string[] {
  const size = CITY_SIZE_TILES;
  const rows: TerrainChar[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, (): TerrainChar => '.'),
  );
  const rect = (x: number, y: number, width: number, height: number, char: TerrainChar) => {
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const row = rows[py];
        if (row !== undefined && px >= 0 && px < size) row[px] = char;
      }
    }
  };
  // Low boundary hedges keep the walkable city enclosed.
  rect(0, 0, size, 2, 'F');
  rect(0, size - 2, size, 2, 'F');
  rect(0, 0, 2, size, 'F');
  rect(size - 2, 0, 2, size, 'F');

  // Pedestrian avenues and a perimeter circuit. Broad sidewalks are walkable.
  rect(39, 25, 5, 122, 'p');
  rect(116, 25, 5, 122, 'p');
  rect(39, 25, 82, 5, 'p');
  rect(39, 142, 82, 5, 'p');
  rect(76, 29, 8, 77, 'p');
  rect(3, 83, 154, 6, 'p');
  rect(39, 101, 82, 5, 'p');

  // Park shoreline with a footbridge and a broad south-facing timber pier.
  for (let y = 109; y < 140; y++) {
    for (let x = 52; x < 108; x++) {
      const d = ((x - 80) / 22) ** 2 + ((y - 123) / 11) ** 2;
      if (d <= 1) rect(x, y, 1, 1, '~');
      else if (d <= 1.35) rect(x, y, 1, 1, 's');
    }
  }
  rect(56, 119, 48, 3, 'b');
  rect(78, 130, 5, 13, 'b');
  rect(75, 129, 11, 3, 'b');

  const square = STARTER_CITY.square;
  rect(square.x, square.y, square.width, square.height, 'p');
  rect(STARTER_CITY.fountain.x, STARTER_CITY.fountain.y, 2, 2, 'W');
  // Four planted corners leave the central conversation area open.
  for (const [x, y] of [
    [68, 68],
    [89, 68],
    [68, 88],
    [89, 88],
  ] as const) {
    rect(x, y, 3, 3, '.');
    rect(x + 1, y + 1, 1, 1, 'T');
  }

  for (const building of CITY_BUILDINGS) {
    const { x, y, width, height, entrance } = building;
    rect(x - 2, y - 2, width + 4, height + 6, 'p');
    // Outdoor footprint is solid; entering transfers into a separate interior.
    rect(x, y, width, height, '#');
    rect(entrance.x - 1, entrance.y, 2, 1, '+');
    if (building.kind === 'commercial') {
      if (x < 80) rect(entrance.x - 1, entrance.y + 1, 44 - entrance.x, 3, 'p');
      else rect(116, entrance.y + 1, entrance.x - 114, 3, 'p');
    } else if (y < 60) {
      rect(entrance.x - 1, entrance.y + 1, 2, 66 - entrance.y, 'p');
    }
  }

  // Small, staggered clusters rather than a repeated orchard lattice.
  for (const [cx, cy] of [
    [11, 20],
    [31, 15],
    [61, 16],
    [103, 17],
    [143, 21],
    [11, 67],
    [148, 65],
    [10, 115],
    [149, 116],
    [47, 112],
    [111, 134],
    [55, 148],
    [98, 150],
    [15, 146],
    [146, 147],
  ] as const) {
    for (const [dx, dy] of [
      [0, 0],
      [4, 2],
      [-2, 5],
    ] as const) {
      if (rows[cy + dy]?.[cx + dx] === '.') rect(cx + dx, cy + dy, 1, 1, 'T');
    }
  }
  return rows.map((row) => row.join(''));
}
