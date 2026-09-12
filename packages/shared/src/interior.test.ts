import { describe, expect, it } from 'vitest';
import {
  INTERIOR_ROWS,
  INTERIOR_WIDTH,
  INTERIOR_HEIGHT,
  INTERIOR_ENTRANCE,
  canDecorateInterior,
} from './interior.js';
import { isWalkableChar } from './terrain.js';

describe('commercial interior floor plan', () => {
  it('gives a visitor walkable arrival and an unobstructed exit aisle', () => {
    expect(INTERIOR_ROWS).toHaveLength(INTERIOR_HEIGHT);
    for (const row of INTERIOR_ROWS) expect(row).toHaveLength(INTERIOR_WIDTH);
    expect(isWalkableChar(INTERIOR_ROWS[INTERIOR_ENTRANCE.y]?.[INTERIOR_ENTRANCE.x])).toBe(true);
    for (let y = 12; y < INTERIOR_HEIGHT; y++)
      for (const x of [9, 10]) {
        expect(isWalkableChar(INTERIOR_ROWS[y]?.[x])).toBe(true);
        expect(canDecorateInterior({ x, y })).toBe(false);
      }
  });
  it('allows usable floor space and refuses out-of-bounds or fractional positions', () => {
    expect(canDecorateInterior({ x: 3, y: 3 })).toBe(true);
    for (const position of [
      { x: -1, y: 3 },
      { x: 20, y: 3 },
      { x: 2, y: 16 },
      { x: 1.5, y: 3 },
      { x: 0, y: 3 },
      { x: 3, y: 0 },
    ])
      expect(canDecorateInterior(position)).toBe(false);
  });
});
