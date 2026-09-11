/**
 * The starter district of Atheriam, drawn tile by tile.
 *
 * Everything here is invented for this project: the shape of the walls, the
 * streets, the market, the park. Nothing is taken from, traced from or modelled
 * on another game — see `docs/SPEC.md` section 2.
 *
 * The district is written as code rather than as a giant text file for one
 * reason: a street here is a line with a name, so it can be moved, widened or
 * removed without counting characters in a wall of text. The result is always
 * the same tiles, because nothing here is random — `plantGrid` lays trees on a
 * fixed lattice, so two servers always build the same city.
 *
 * The plan, at a glance:
 *
 *      +--------------------------------------+   0
 *      |  orchard      north gate     orchard  |
 *      |    +-----------------------------+    |  24  ring road
 *      |    |  park+lake  |    market     |    |
 *      |    |        +---------+          |    |  52  the Crown Square
 *      |    |        | square  |          |    |
 *      |    |  homes  |        |   homes  |    |
 *      |    +-----------------------------+    | 103
 *      |  orchard      south gate     orchard  |
 *      +--------------------------------------+ 127
 */
import {
  CHUNK_SIZE_TILES,
  DEFAULT_SPAWN_TILE,
  SOLID_CHAR,
  type TerrainChar,
  type TilePos,
} from '@atheriam/shared';

/** The district is four chunks by four chunks. */
export const CITY_SIZE_TILES = CHUNK_SIZE_TILES * 4;

/**
 * Where a player who has never played before appears: the Crown Square.
 *
 * The tile itself is decided in `@atheriam/shared`, because the API writes it
 * onto a new character before the world server ever sees them.
 */
export const CITY_SPAWN: TilePos = DEFAULT_SPAWN_TILE;

/** How thick the city wall is. Two tiles so it reads as stone, not as a line. */
const WALL_THICKNESS = 2;

/** A rectangle of tiles, given by its corners, both ends included. */
interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * A grid of characters being drawn on.
 *
 * Every method clips to the canvas, so a street that runs off the edge is
 * simply shorter rather than an exception. That keeps the drawing code below
 * free of bounds checks.
 */
class Canvas {
  private readonly rows: TerrainChar[][];

  constructor(
    readonly width: number,
    readonly height: number,
    fill: TerrainChar,
  ) {
    this.rows = Array.from({ length: height }, () =>
      Array.from({ length: width }, (): TerrainChar => fill),
    );
  }

  set(x: number, y: number, char: TerrainChar): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const row = this.rows[y];
    if (row === undefined) return;
    row[x] = char;
  }

  at(x: number, y: number): TerrainChar {
    return this.rows[y]?.[x] ?? SOLID_CHAR;
  }

  fill(rect: Rect, char: TerrainChar): void {
    for (let y = rect.y0; y <= rect.y1; y += 1) {
      for (let x = rect.x0; x <= rect.x1; x += 1) {
        this.set(x, y, char);
      }
    }
  }

  /** The outline of a rectangle, one tile thick. */
  outline(rect: Rect, char: TerrainChar): void {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      this.set(x, rect.y0, char);
      this.set(x, rect.y1, char);
    }
    for (let y = rect.y0; y <= rect.y1; y += 1) {
      this.set(rect.x0, y, char);
      this.set(rect.x1, y, char);
    }
  }

  toRows(): string[] {
    return this.rows.map((row) => row.join(''));
  }
}

/** A city wall with nothing but solid stone: the edge of the world. */
function drawWalls(canvas: Canvas): void {
  const last = canvas.width - 1;
  canvas.fill({ x0: 0, y0: 0, x1: last, y1: WALL_THICKNESS - 1 }, '#');
  canvas.fill({ x0: 0, y0: canvas.height - WALL_THICKNESS, x1: last, y1: canvas.height - 1 }, '#');
  canvas.fill({ x0: 0, y0: 0, x1: WALL_THICKNESS - 1, y1: canvas.height - 1 }, '#');
  canvas.fill({ x0: canvas.width - WALL_THICKNESS, y0: 0, x1: last, y1: canvas.height - 1 }, '#');
}

/**
 * The two great streets that cross at the square, and the ring road that ties
 * the four quarters together.
 */
function drawStreets(canvas: Canvas): void {
  const near = WALL_THICKNESS;
  const far = canvas.width - WALL_THICKNESS - 1;

  // King's Road, north to south. Queen's Road, west to east.
  canvas.fill({ x0: 61, y0: near, x1: 66, y1: far }, ',');
  canvas.fill({ x0: near, y0: 61, x1: far, y1: 66 }, ',');

  // The ring road, a square around the four quarters.
  canvas.fill({ x0: 24, y0: 24, x1: 103, y1: 25 }, ',');
  canvas.fill({ x0: 24, y0: 102, x1: 103, y1: 103 }, ',');
  canvas.fill({ x0: 24, y0: 24, x1: 25, y1: 103 }, ',');
  canvas.fill({ x0: 102, y0: 24, x1: 103, y1: 103 }, ',');

  // Gatehouses: solid blocks flanking each gate, so the wall reads as guarded.
  for (const [x0, x1] of [
    [56, 59],
    [68, 71],
  ] as const) {
    canvas.fill({ x0, y0: near, x1, y1: near + 3 }, '#');
    canvas.fill({ x0, y0: far - 3, x1, y1: far }, '#');
  }
  for (const [y0, y1] of [
    [56, 59],
    [68, 71],
  ] as const) {
    canvas.fill({ x0: near, y0, x1: near + 3, y1 }, '#');
    canvas.fill({ x0: far - 3, y0, x1: far, y1 }, '#');
  }
}

/** The Crown Square: paved, with the city well at its heart. */
function drawSquare(canvas: Canvas): void {
  canvas.fill({ x0: 52, y0: 52, x1: 75, y1: 75 }, 'p');
  canvas.fill({ x0: 63, y0: 63, x1: 64, y1: 64 }, 'W');
}

/**
 * The park in the north-west quarter: a lake with a shore, and trees on a
 * lattice wide enough that a person can always walk between them.
 */
function drawPark(canvas: Canvas): void {
  const centre = { x: 42, y: 42 };
  const radius = { x: 11, y: 8 };

  for (let y = centre.y - radius.y - 2; y <= centre.y + radius.y + 2; y += 1) {
    for (let x = centre.x - radius.x - 2; x <= centre.x + radius.x + 2; x += 1) {
      const dx = (x - centre.x) / radius.x;
      const dy = (y - centre.y) / radius.y;
      const distance = dx * dx + dy * dy;
      if (canvas.at(x, y) !== '.') continue;
      if (distance <= 1) canvas.set(x, y, '~');
      else if (distance <= 1.45) canvas.set(x, y, 's');
    }
  }

  plantGrid(canvas, { x0: 27, y0: 27, x1: 59, y1: 59 });
}

/** The market in the north-east quarter: stalls in rows, with wide aisles. */
function drawMarket(canvas: Canvas): void {
  canvas.fill({ x0: 69, y0: 28, x1: 99, y1: 50 }, 'p');
  for (let y = 30; y <= 46; y += 6) {
    for (let x = 71; x <= 95; x += 8) {
      canvas.fill({ x0: x, y0: y, x1: x + 4, y1: y + 1 }, 'M');
    }
  }
}

/**
 * A house: four walls, a wooden floor and one doorway.
 *
 * The inside is part of the public street plan, not a home somebody owns —
 * private houses are Phase 7, and they will be their own interiors.
 */
function drawHouse(canvas: Canvas, rect: Rect, door: 'n' | 's'): void {
  canvas.fill(rect, 'd');
  canvas.outline(rect, '#');
  const doorX = Math.floor((rect.x0 + rect.x1) / 2);
  const doorY = door === 'n' ? rect.y0 : rect.y1;
  canvas.set(doorX, doorY, '+');
  canvas.set(doorX + 1, doorY, '+');
}

/** The two residential quarters, each two rows of houses along a lane. */
function drawHomes(canvas: Canvas): void {
  for (const originX of [28, 69]) {
    // The lane between the two rows.
    canvas.fill({ x0: originX - 2, y0: 83, x1: originX + 30, y1: 84 }, ',');

    for (const offset of [0, 10, 20]) {
      const x0 = originX + offset;
      drawHouse(canvas, { x0, y0: 70, x1: x0 + 7, y1: 78 }, 's');
      drawHouse(canvas, { x0, y0: 88, x1: x0 + 7, y1: 96 }, 'n');
    }
  }
}

/** Orchards in the band between the ring road and the wall. */
function drawOrchards(canvas: Canvas): void {
  plantGrid(canvas, { x0: 5, y0: 5, x1: 122, y1: 21 });
  plantGrid(canvas, { x0: 5, y0: 106, x1: 122, y1: 122 });
  plantGrid(canvas, { x0: 5, y0: 27, x1: 21, y1: 100 });
  plantGrid(canvas, { x0: 106, y0: 27, x1: 122, y1: 100 });
}

/**
 * Trees every four tiles, and only on grass.
 *
 * The spacing is what makes this safe: three walkable tiles between any two
 * trees means a lattice can never close a pocket of the map off, however it
 * lands next to a street or a wall.
 */
function plantGrid(canvas: Canvas, rect: Rect): void {
  for (let y = rect.y0; y <= rect.y1; y += 4) {
    for (let x = rect.x0; x <= rect.x1; x += 4) {
      if (canvas.at(x, y) === '.') canvas.set(x, y, 'T');
    }
  }
}

/** Draw the whole district and hand back its rows. */
export function buildStarterDistrict(): string[] {
  const canvas = new Canvas(CITY_SIZE_TILES, CITY_SIZE_TILES, '.');
  drawWalls(canvas);
  drawPark(canvas);
  drawStreets(canvas);
  drawSquare(canvas);
  drawMarket(canvas);
  drawHomes(canvas);
  drawOrchards(canvas);
  return canvas.toRows();
}
