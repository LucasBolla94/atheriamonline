/**
 * Finding a route across the map.
 *
 * This lives on the server, never on the client. The client asks "I want to be
 * there"; the server decides whether that is possible and by which route. A
 * modified client cannot walk through a wall by sending its own path, because
 * it is never asked for one.
 */
import { isAdjacent, type TilePos } from '@atheriam/shared';
import type { GameMap } from './map.js';

/**
 * The most tiles we will look at before giving up. It bounds how much CPU one
 * player can cost the whole server with a single click, which matters because
 * the world loop must never stall.
 */
export const MAX_SEARCH_TILES = 8192;

/** The longest route we will hand back. */
export const MAX_PATH_LENGTH = 256;

const NEIGHBOUR_OFFSETS: readonly TilePos[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

function key(pos: TilePos): number {
  // Packing two coordinates into one number keeps the visited set fast.
  return pos.y * 100_000 + pos.x;
}

/**
 * True when stepping from `from` to `to` is allowed.
 *
 * Diagonals are only allowed when both tiles beside them are open. Without
 * this, a player can slip through the corner where two walls meet, which looks
 * like walking through a solid building.
 */
export function canStep(map: GameMap, from: TilePos, to: TilePos): boolean {
  if (!isAdjacent(from, to)) return false;
  if (!map.isWalkable(to)) return false;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx !== 0 && dy !== 0) {
    const sideA = { x: from.x + dx, y: from.y };
    const sideB = { x: from.x, y: from.y + dy };
    if (!map.isWalkable(sideA) || !map.isWalkable(sideB)) return false;
  }
  return true;
}

/**
 * The shortest route from `from` to `to`, not including the tile the player is
 * already standing on. Returns `null` when there is no route.
 *
 * Breadth-first search: on a grid where every step costs the same, it finds the
 * shortest path and is simple enough to be obviously correct. If the city ever
 * grows tiles that cost more to cross, this becomes A*.
 */
export function findPath(map: GameMap, from: TilePos, to: TilePos): TilePos[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (!map.isWalkable(to)) return null;

  const cameFrom = new Map<number, TilePos | null>();
  const queue: TilePos[] = [from];
  cameFrom.set(key(from), null);
  let head = 0;
  let examined = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === undefined) break;

    examined += 1;
    if (examined > MAX_SEARCH_TILES) return null;

    if (current.x === to.x && current.y === to.y) {
      return rebuild(cameFrom, current);
    }

    for (const offset of NEIGHBOUR_OFFSETS) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      const nextKey = key(next);
      if (cameFrom.has(nextKey)) continue;
      if (!canStep(map, current, next)) continue;
      cameFrom.set(nextKey, current);
      queue.push(next);
    }
  }

  return null;
}

function rebuild(cameFrom: Map<number, TilePos | null>, end: TilePos): TilePos[] | null {
  const path: TilePos[] = [];
  let cursor: TilePos | null = end;
  while (cursor !== null) {
    path.push(cursor);
    const previous = cameFrom.get(key(cursor));
    cursor = previous ?? null;
  }
  path.pop(); // drop the starting tile: the player is already there
  path.reverse();
  return path.length > MAX_PATH_LENGTH ? null : path;
}
