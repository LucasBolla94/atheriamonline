/**
 * Which pieces of the map a player is allowed to have.
 *
 * A player is sent the chunks their view touches and nothing else. Two things
 * come out of that, and both matter:
 *
 *  - bandwidth stays flat as the city grows, because the number of chunks a
 *    player holds depends on how far they can see, never on how big the world
 *    is;
 *  - a modified client cannot read the map it has not been given, so the city
 *    cannot be scraped by standing in the square.
 *
 * There is no socket and no state in this file, so every rule in it can be
 * tested by calling a function.
 */
import {
  CHUNK_SIZE_TILES,
  VIEW_MARGIN_TILES,
  VIEW_RADIUS_TILES,
  chunkKey,
  chunkOf,
  type ChunkPos,
  type TilePos,
} from '@atheriam/shared';
import type { GameMap } from './map.js';

/**
 * How far from the player, in tiles, a chunk still counts as interesting.
 *
 * The margin is what stops a chunk being sent, dropped and sent again while
 * somebody paces back and forth across a chunk border.
 */
export const CHUNK_VIEW_TILES = VIEW_RADIUS_TILES + VIEW_MARGIN_TILES;

/**
 * Every chunk of the map that a player standing here can see part of.
 *
 * Chunks that fall outside the map are left out rather than sent as stone:
 * the client already treats what it has not been given as solid.
 */
export function chunksInView(map: GameMap, centre: TilePos): ChunkPos[] {
  const topLeft = chunkOf({ x: centre.x - CHUNK_VIEW_TILES, y: centre.y - CHUNK_VIEW_TILES });
  const bottomRight = chunkOf({ x: centre.x + CHUNK_VIEW_TILES, y: centre.y + CHUNK_VIEW_TILES });

  const chunks: ChunkPos[] = [];
  for (let cy = topLeft.cy; cy <= bottomRight.cy; cy += 1) {
    for (let cx = topLeft.cx; cx <= bottomRight.cx; cx += 1) {
      const chunk = { cx, cy };
      if (map.hasChunk(chunk)) chunks.push(chunk);
    }
  }
  return chunks;
}

/** What changed between the chunks a client holds and the ones it should hold. */
export interface ChunkDifference {
  readonly toSend: ChunkPos[];
  readonly toDrop: ChunkPos[];
}

/**
 * Work out the smallest set of messages that brings a client up to date.
 *
 * `held` is the set of chunk keys the client already has. It is not changed
 * here: the caller updates it once the messages have actually been sent, so a
 * dropped socket never leaves us believing a client knows something it does
 * not.
 */
export function diffChunks(
  held: ReadonlySet<string>,
  wanted: readonly ChunkPos[],
): ChunkDifference {
  const wantedKeys = new Set(wanted.map((chunk) => chunkKey(chunk)));

  const toSend = wanted.filter((chunk) => !held.has(chunkKey(chunk)));
  const toDrop: ChunkPos[] = [];
  for (const key of held) {
    if (wantedKeys.has(key)) continue;
    const parsed = parseChunkKey(key);
    if (parsed !== null) toDrop.push(parsed);
  }

  return { toSend, toDrop };
}

/** Turn a chunk key back into coordinates. Returns null for a key we did not write. */
export function parseChunkKey(key: string): ChunkPos | null {
  const [rawX, rawY, ...rest] = key.split(':');
  if (rawX === undefined || rawY === undefined || rest.length > 0) return null;
  const cx = Number(rawX);
  const cy = Number(rawY);
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) return null;
  return { cx, cy };
}

/** The size of one chunk, re-exported so callers need only this module. */
export const CHUNK_SIZE = CHUNK_SIZE_TILES;
