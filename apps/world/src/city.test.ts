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
import { CHUNK_SIZE_TILES, isWalkableChar, isTerrainChar } from '@atheriam/shared';
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

  it('has a city well at the heart of the square', () => {
    expect(charAt(63, 63)).toBe('W');
    expect(charAt(64, 64)).toBe('W');
  });

  it('has houses with doorways, and floorboards inside them', () => {
    const doors = rows
      .join('')
      .split('')
      .filter((char) => char === '+').length;
    const floor = rows
      .join('')
      .split('')
      .filter((char) => char === 'd').length;
    expect(doors).toBeGreaterThanOrEqual(12);
    expect(floor).toBeGreaterThan(200);
  });

  it('has a lake, a market and enough room to walk', () => {
    const all = rows.join('');
    const count = (char: string): number => all.split(char).length - 1;
    expect(count('~')).toBeGreaterThan(100);
    expect(count('M')).toBeGreaterThan(50);
    // A city that is mostly walls is a maze, not a place to meet people.
    const walkable = [...all].filter((char) => isWalkableChar(char)).length;
    expect(walkable / all.length).toBeGreaterThan(0.7);
  });

  it('lets a player enter both cottage rows through their visible south-facing steps', () => {
    for (const x of [31, 41, 51, 72, 82, 92]) {
      for (const y of [78, 96]) {
        expect(charAt(x, y)).toBe('+');
        expect(charAt(x + 1, y)).toBe('+');
        expect(isWalkableChar(charAt(x, y - 1))).toBe(true);
        expect(isWalkableChar(charAt(x, y + 1))).toBe(true);
      }
    }
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
