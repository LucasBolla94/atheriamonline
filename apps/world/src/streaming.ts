/**
 * Which pieces of the map a player is allowed to have.
 *
 * Terrain covers the bounded camera extent around the authoritative resident.
 * It is separate from player visibility and chat range. Wide screens may see
 * more public city terrain; private realms always use their own map.
 * Chunks nearest the resident are sent first to improve initial presentation.
 *
 * There is no socket and no state in this file, so every rule in it can be
 * tested by calling a function.
 */
import {
  CHUNK_SIZE_TILES,
  VIEW_MARGIN_TILES,
  VIEW_RADIUS_TILES,
  MAX_TERRAIN_VIEW_TILES,
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
export interface TerrainView {
  radiusX: number;
  radiusY: number;
}

export function chunksInView(map: GameMap, centre: TilePos, view?: TerrainView): ChunkPos[] {
  const radiusX = Math.max(
    CHUNK_VIEW_TILES,
    Math.min(MAX_TERRAIN_VIEW_TILES, view?.radiusX ?? CHUNK_VIEW_TILES),
  );
  const radiusY = Math.max(
    CHUNK_VIEW_TILES,
    Math.min(MAX_TERRAIN_VIEW_TILES, view?.radiusY ?? CHUNK_VIEW_TILES),
  );
  const topLeft = chunkOf({ x: centre.x - radiusX, y: centre.y - radiusY });
  const bottomRight = chunkOf({ x: centre.x + radiusX, y: centre.y + radiusY });

  const chunks: ChunkPos[] = [];
  for (let cy = topLeft.cy; cy <= bottomRight.cy; cy += 1) {
    for (let cx = topLeft.cx; cx <= bottomRight.cx; cx += 1) {
      const chunk = { cx, cy };
      if (map.hasChunk(chunk)) chunks.push(chunk);
    }
  }
  const distance = (chunk: ChunkPos) =>
    (chunk.cx * CHUNK_SIZE_TILES + CHUNK_SIZE_TILES / 2 - centre.x) ** 2 +
    (chunk.cy * CHUNK_SIZE_TILES + CHUNK_SIZE_TILES / 2 - centre.y) ** 2;
  return chunks.sort((a, b) => distance(a) - distance(b));
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
