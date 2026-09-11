import { CHUNK_SIZE_TILES, TILE_SIZE_PX } from './constants.js';

/** A position on the world grid, in whole tiles. */
export interface TilePos {
  readonly x: number;
  readonly y: number;
}

/** Which chunk of the map a tile belongs to. */
export interface ChunkPos {
  readonly cx: number;
  readonly cy: number;
}

/** A position on the screen, in pixels. */
export interface PixelPos {
  readonly px: number;
  readonly py: number;
}

/** The eight directions a player may step in, plus staying still. */
export type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const DIRECTION_STEPS: Readonly<Record<Direction, TilePos>> = {
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
  nw: { x: -1, y: -1 },
};

/** True when both coordinates are whole numbers and inside a sane range. */
export function isValidTile(pos: TilePos): boolean {
  return (
    Number.isSafeInteger(pos.x) &&
    Number.isSafeInteger(pos.y) &&
    Math.abs(pos.x) <= 1_000_000 &&
    Math.abs(pos.y) <= 1_000_000
  );
}

/** The tile you reach by taking one step in the given direction. */
export function step(from: TilePos, direction: Direction): TilePos {
  const delta = DIRECTION_STEPS[direction];
  return { x: from.x + delta.x, y: from.y + delta.y };
}

/**
 * True when `b` is exactly one step away from `a` in one of the eight
 * directions. The same tile is NOT adjacent to itself.
 *
 * The server uses this to reject a client that tries to teleport.
 */
export function isAdjacent(a: TilePos, b: TilePos): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx <= 1 && dy <= 1 && dx + dy > 0;
}

/**
 * Distance measured in steps, allowing diagonals (Chebyshev distance).
 * This is the distance that matters for "can I see you" and "can you hear me",
 * because a diagonal step costs the same as a straight one.
 */
export function tileDistance(a: TilePos, b: TilePos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Which chunk holds this tile. Works correctly for negative coordinates. */
export function chunkOf(pos: TilePos): ChunkPos {
  return {
    cx: Math.floor(pos.x / CHUNK_SIZE_TILES),
    cy: Math.floor(pos.y / CHUNK_SIZE_TILES),
  };
}

/**
 * Where this tile sits inside its own chunk, always from 0 to
 * CHUNK_SIZE_TILES - 1.
 */
export function tileWithinChunk(pos: TilePos): TilePos {
  const size = CHUNK_SIZE_TILES;
  return {
    x: ((pos.x % size) + size) % size,
    y: ((pos.y % size) + size) % size,
  };
}

/** A short stable string for a chunk, usable as a map key or a Redis key. */
export function chunkKey(chunk: ChunkPos): string {
  return `${chunk.cx}:${chunk.cy}`;
}

/** The top-left pixel of a tile, used by the renderer. */
export function tileToPixel(pos: TilePos): PixelPos {
  return { px: pos.x * TILE_SIZE_PX, py: pos.y * TILE_SIZE_PX };
}

/** The tile that contains a pixel, used to turn a mouse click into an intent. */
export function pixelToTile(pos: PixelPos): TilePos {
  return {
    x: Math.floor(pos.px / TILE_SIZE_PX),
    y: Math.floor(pos.py / TILE_SIZE_PX),
  };
}

/**
 * Which way you are facing after stepping from `from` to `to`.
 *
 * Returns `null` when the two tiles are not one step apart, because then there
 * is no single direction that describes the move.
 */
export function directionBetween(from: TilePos, to: TilePos): Direction | null {
  if (!isAdjacent(from, to)) return null;
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  for (const [direction, delta] of Object.entries(DIRECTION_STEPS)) {
    if (delta.x === dx && delta.y === dy) return direction as Direction;
  }
  return null;
}
