/**
 * The map the world server asks questions of.
 *
 * The map is a grid of characters — see `terrain.ts` in `@atheriam/shared` for
 * what each one means. It never changes while the server is running, so it is
 * read-only from the moment it is built.
 *
 * The client is not sent the map in one piece. It is sent the 32x32 **chunks**
 * around the player, and it throws away the ones it has walked away from
 * (`docs/SPEC.md` section 7). This class is where a chunk is cut out.
 */
import {
  CHUNK_SIZE_TILES,
  SOLID_CHAR,
  isWalkableChar,
  type ChunkPos,
  type TilePos,
} from '@atheriam/shared';
import { CITY_SPAWN, buildStarterDistrict } from './city.js';

/**
 * A read-only map of tiles. The world server asks it questions; it never
 * changes during play.
 */
export class GameMap {
  readonly width: number;
  readonly height: number;
  private readonly rows: readonly string[];
  /** Chunks are cut once and kept, because every player asks for the same ones. */
  private readonly chunkCache = new Map<string, string[]>();

  constructor(rows: readonly string[]) {
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

  /** What this tile is made of. Anything outside the map is solid stone. */
  charAt(pos: TilePos): string {
    if (!this.contains(pos)) return SOLID_CHAR;
    return this.rows[pos.y]?.[pos.x] ?? SOLID_CHAR;
  }

  /** True when a player is allowed to stand on this tile. */
  isWalkable(pos: TilePos): boolean {
    if (!this.contains(pos)) return false;
    return isWalkableChar(this.rows[pos.y]?.[pos.x]);
  }

  /** How many chunks wide and tall the map is, rounding up. */
  get chunksAcross(): { cx: number; cy: number } {
    return {
      cx: Math.ceil(this.width / CHUNK_SIZE_TILES),
      cy: Math.ceil(this.height / CHUNK_SIZE_TILES),
    };
  }

  /** True when this chunk has any part of the map in it. */
  hasChunk(chunk: ChunkPos): boolean {
    const across = this.chunksAcross;
    return chunk.cx >= 0 && chunk.cy >= 0 && chunk.cx < across.cx && chunk.cy < across.cy;
  }

  /**
   * One 32x32 square of the map, as rows of characters.
   *
   * A chunk that runs past the edge of the map is padded with solid stone, so
   * every chunk the client receives is exactly 32x32 and the client never has
   * to think about the edge of the world.
   */
  chunkRows(chunk: ChunkPos): readonly string[] | null {
    if (!this.hasChunk(chunk)) return null;

    const key = `${chunk.cx}:${chunk.cy}`;
    const cached = this.chunkCache.get(key);
    if (cached !== undefined) return cached;

    const originX = chunk.cx * CHUNK_SIZE_TILES;
    const originY = chunk.cy * CHUNK_SIZE_TILES;
    const rows: string[] = [];

    for (let y = 0; y < CHUNK_SIZE_TILES; y += 1) {
      const source = this.rows[originY + y];
      if (source === undefined) {
        rows.push(SOLID_CHAR.repeat(CHUNK_SIZE_TILES));
        continue;
      }
      const slice = source.slice(originX, originX + CHUNK_SIZE_TILES);
      rows.push(slice.padEnd(CHUNK_SIZE_TILES, SOLID_CHAR));
    }

    this.chunkCache.set(key, rows);
    return rows;
  }
}

/** The city every player walks in. */
export const starterDistrict = new GameMap(buildStarterDistrict());

/**
 * Where a new player appears: the Crown Square, or the nearest tile to it
 * somebody can actually stand on.
 */
export function spawnPoint(map: GameMap): TilePos {
  const preferred = map.isWalkable(CITY_SPAWN)
    ? CITY_SPAWN
    : { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
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
