/**
 * The starter district of Atheriam.
 *
 * This map is drawn by hand for this project. Nothing here is taken from, or
 * modelled on, any other game — see `docs/SPEC.md` section 2.
 *
 * Phase 3 replaces this single fixed map with streamed 32x32 chunks. The shape
 * of the data is kept deliberately dull so that swap is easy.
 *
 * One character is one tile:
 *   '.' grass   walkable
 *   ',' road    walkable
 *   '#' wall    blocked
 *   '~' water   blocked
 */
import type { TilePos } from '@atheriam/shared';

const ROWS: readonly string[] = [
  '########################################',
  '#......................................#',
  '#..####........................####....#',
  '#..#..#........,,......,,......#..#....#',
  '#..#..#........,,......,,......####....#',
  '#..####........,,......,,..............#',
  '#..............,,......,,..............#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#..............,,......,,..............#',
  '#......~~~~....,,......,,....####......#',
  '#.....~~~~~~...,,......,,....#..#......#',
  '#.....~~~~~~...,,......,,....#..#......#',
  '#......~~~~....,,......,,....####......#',
  '#..............,,......,,..............#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,#',
  '#..............,,......,,..............#',
  '#....####......,,......,,......####....#',
  '#....#..#......,,......,,......#..#....#',
  '#....#..#......................#..#....#',
  '#....####......................####....#',
  '#......................................#',
  '########################################',
];

const WALKABLE_CHARS = new Set(['.', ',']);

/**
 * A read-only map of tiles. The world server asks it questions; it never
 * changes during play.
 */
export class GameMap {
  readonly width: number;
  readonly height: number;
  private readonly rows: readonly string[];

  constructor(rows: readonly string[] = ROWS) {
    const first = rows[0];
    if (first === undefined) {
      throw new Error('A map must have at least one row.');
    }
    this.height = rows.length;
    this.width = first.length;
    // A ragged map would cause out-of-bounds bugs that only appear on one
    // row, which is exactly the kind of bug that is expensive to find later.
    for (const [index, row] of rows.entries()) {
      if (row.length !== this.width) {
        throw new Error(
          `Map row ${index} is ${row.length} tiles wide, expected ${this.width}. ` +
            'Every row must be the same width.',
        );
      }
    }
    this.rows = rows;
  }

  /** True when the tile is inside the map at all. */
  contains(pos: TilePos): boolean {
    return pos.x >= 0 && pos.y >= 0 && pos.x < this.width && pos.y < this.height;
  }

  /** True when a player is allowed to stand on this tile. */
  isWalkable(pos: TilePos): boolean {
    if (!this.contains(pos)) return false;
    const char = this.rows[pos.y]?.[pos.x];
    return char !== undefined && WALKABLE_CHARS.has(char);
  }

  /** The rows, for sending to the client. */
  toPatch(): { width: number; height: number; rows: string[] } {
    return { width: this.width, height: this.height, rows: [...this.rows] };
  }
}

/** The map every player starts on, until Phase 3 brings the real city. */
export const starterDistrict = new GameMap();

/**
 * Where a new player appears: the middle of the main crossroads, or the
 * nearest walkable tile to it.
 */
export function spawnPoint(map: GameMap): TilePos {
  const preferred: TilePos = { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  if (map.isWalkable(preferred)) return preferred;

  // Spiral outwards until we find somewhere legal. A map with no walkable
  // tile at all is a broken map, and we say so rather than loop forever.
  for (let radius = 1; radius < Math.max(map.width, map.height); radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const candidate = { x: preferred.x + dx, y: preferred.y + dy };
        if (map.isWalkable(candidate)) return candidate;
      }
    }
  }
  throw new Error('This map has no walkable tile.');
}
