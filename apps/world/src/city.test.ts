/**
 * The starter district has to be a place a person can actually walk around.
 *
 * The test that matters most here is the last one: every tile somebody could
 * stand on must be reachable from the spawn. A street drawn one tile short, a
 * house with its door in a wall, a lake that swallows a road — all of those
 * look fine on screen and are only found by walking the whole city, which is
 * what a flood fill does in a millisecond.
 */
import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE_TILES,
  CITY_BUILDINGS,
  CITY_FURNITURE,
  STARTER_CITY,
  isWalkableChar,
  isTerrainChar,
} from '@atheriam/shared';
import { CITY_SIZE_TILES, CITY_SPAWN, buildStarterDistrict } from './city.js';

const rows = buildStarterDistrict();

function charAt(x: number, y: number): string {
  return rows[y]?.[x] ?? '#';
}

describe('the starter district', () => {
  it('is a square whose side is a whole number of chunks', () => {
    expect(rows).toHaveLength(CITY_SIZE_TILES);
    expect(CITY_SIZE_TILES % CHUNK_SIZE_TILES).toBe(0);
    for (const row of rows) expect(row).toHaveLength(CITY_SIZE_TILES);
  });

  it('is built only from tiles the game knows about', () => {
    for (const row of rows) {
      for (const char of row) {
        expect(isTerrainChar(char), `unknown tile "${char}"`).toBe(true);
      }
    }
  });

  it('is drawn the same way every time, so two servers agree', () => {
    expect(buildStarterDistrict()).toEqual(rows);
  });

  it('is walled in on all four sides, so nobody can walk off the edge', () => {
    const last = CITY_SIZE_TILES - 1;
    for (let i = 0; i < CITY_SIZE_TILES; i += 1) {
      expect(isWalkableChar(charAt(i, 0))).toBe(false);
      expect(isWalkableChar(charAt(i, last))).toBe(false);
      expect(isWalkableChar(charAt(0, i))).toBe(false);
      expect(isWalkableChar(charAt(last, i))).toBe(false);
    }
  });

  it('puts the spawn on ground a person can stand on', () => {
    expect(isWalkableChar(charAt(CITY_SPAWN.x, CITY_SPAWN.y))).toBe(true);
  });

  it('has a fountain and a generous, clear arrival area in Central Square', () => {
    expect(CITY_SIZE_TILES).toBe(160);
    expect(charAt(STARTER_CITY.fountain.x, STARTER_CITY.fountain.y)).toBe('W');
    for (let y = CITY_SPAWN.y - 3; y <= CITY_SPAWN.y + 3; y++) {
      for (let x = CITY_SPAWN.x - 3; x <= CITY_SPAWN.x + 3; x++) {
        expect(isWalkableChar(charAt(x, y))).toBe(true);
      }
    }
  });

  it('gives square furniture solid footprints and accessible fronts', () => {
    for (const item of CITY_FURNITURE) {
      for (let x = item.x; x < item.x + item.width; x++) {
        expect(charAt(x, item.y)).toBe('o');
        expect(isWalkableChar(charAt(x, item.y))).toBe(false);
        expect(isWalkableChar(charAt(x, item.y + item.height))).toBe(true);
      }
    }
  });

  it('gives all fifteen buildings solid footprints and reachable front entrances', () => {
    expect(rows.join('').split('+').length - 1).toBe(30);
    for (const b of CITY_BUILDINGS) {
      for (let y = b.y; y < b.y + b.height; y++) {
        for (let x = b.x; x < b.x + b.width; x++) expect(charAt(x, y)).toBe('#');
      }
      for (const x of [b.entrance.x - 1, b.entrance.x]) {
        expect(charAt(x, b.entrance.y)).toBe('+');
        expect(isWalkableChar(charAt(x, b.entrance.y + 1))).toBe(true);
      }
    }
  });

  it('has a lake, footbridge, pier and ample walkable space', () => {
    const all = rows.join('');
    expect(all.split('~').length - 1).toBeGreaterThan(300);
    expect(charAt(80, 120)).toBe('b');
    expect(charAt(80, 134)).toBe('b');
    const walkable = [...all].filter((char) => isWalkableChar(char)).length;
    expect(walkable / all.length).toBeGreaterThan(0.7);
  });

  it('lets a player reach every single tile they could stand on', () => {
    const seen = new Set<number>();
    const queue = [CITY_SPAWN];
    seen.add(CITY_SPAWN.y * CITY_SIZE_TILES + CITY_SPAWN.x);

    while (queue.length > 0) {
      const here = queue.pop();
      if (here === undefined) break;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const x = here.x + dx;
          const y = here.y + dy;
          if (x < 0 || y < 0 || x >= CITY_SIZE_TILES || y >= CITY_SIZE_TILES) continue;
          if (!isWalkableChar(charAt(x, y))) continue;
          // A diagonal may not squeeze between two corners: the world server
          // refuses that move, so the flood fill must refuse it too or it
          // would call a tile reachable that nobody can reach.
          if (dx !== 0 && dy !== 0) {
            if (!isWalkableChar(charAt(here.x + dx, here.y))) continue;
            if (!isWalkableChar(charAt(here.x, here.y + dy))) continue;
          }
          const key = y * CITY_SIZE_TILES + x;
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({ x, y });
        }
      }
    }

    const unreachable: string[] = [];
    for (let y = 0; y < CITY_SIZE_TILES; y += 1) {
      for (let x = 0; x < CITY_SIZE_TILES; x += 1) {
        if (!isWalkableChar(charAt(x, y))) continue;
        if (seen.has(y * CITY_SIZE_TILES + x)) continue;
        unreachable.push(`${x},${y}`);
      }
    }

    expect(unreachable.slice(0, 20)).toEqual([]);
  });
});
