import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE_TILES, TILE_SIZE_PX } from './constants.js';
import {
  chunkKey,
  chunkOf,
  isAdjacent,
  isValidTile,
  pixelToTile,
  step,
  tileDistance,
  tileToPixel,
  tileWithinChunk,
  directionBetween,
  type Direction,
} from './tile.js';

describe('isValidTile', () => {
  it('accepts whole coordinates', () => {
    expect(isValidTile({ x: 0, y: 0 })).toBe(true);
    expect(isValidTile({ x: -12, y: 900 })).toBe(true);
  });

  it('rejects fractions, NaN and absurd values', () => {
    expect(isValidTile({ x: 1.5, y: 0 })).toBe(false);
    expect(isValidTile({ x: Number.NaN, y: 0 })).toBe(false);
    expect(isValidTile({ x: Number.POSITIVE_INFINITY, y: 0 })).toBe(false);
    expect(isValidTile({ x: 10_000_000, y: 0 })).toBe(false);
  });
});

describe('step', () => {
  it('moves exactly one tile in each of the eight directions', () => {
    const origin = { x: 5, y: 5 };
    const directions: Direction[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    for (const direction of directions) {
      const next = step(origin, direction);
      expect(isAdjacent(origin, next)).toBe(true);
      expect(tileDistance(origin, next)).toBe(1);
    }
  });

  it('lands on eight distinct tiles', () => {
    const origin = { x: 0, y: 0 };
    const directions: Direction[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    const seen = new Set(directions.map((d) => `${step(origin, d).x}:${step(origin, d).y}`));
    expect(seen.size).toBe(8);
  });
});

describe('isAdjacent', () => {
  it('is false for the same tile, so a player cannot "step" nowhere', () => {
    expect(isAdjacent({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe(false);
  });

  it('is true for diagonals', () => {
    expect(isAdjacent({ x: 3, y: 3 }, { x: 4, y: 4 })).toBe(true);
  });

  it('is false for a jump of two tiles, which is how we catch teleporting', () => {
    expect(isAdjacent({ x: 3, y: 3 }, { x: 5, y: 3 })).toBe(false);
    expect(isAdjacent({ x: 3, y: 3 }, { x: 3, y: 5 })).toBe(false);
    expect(isAdjacent({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe(false);
  });
});

describe('tileDistance', () => {
  it('counts a diagonal as one step', () => {
    expect(tileDistance({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
  });

  it('is symmetric', () => {
    const a = { x: -4, y: 7 };
    const b = { x: 11, y: 2 };
    expect(tileDistance(a, b)).toBe(tileDistance(b, a));
  });

  it('is zero for the same tile', () => {
    expect(tileDistance({ x: 9, y: 9 }, { x: 9, y: 9 })).toBe(0);
  });
});

describe('chunkOf and tileWithinChunk', () => {
  it('puts the first chunk at 0,0', () => {
    expect(chunkOf({ x: 0, y: 0 })).toEqual({ cx: 0, cy: 0 });
    expect(chunkOf({ x: CHUNK_SIZE_TILES - 1, y: CHUNK_SIZE_TILES - 1 })).toEqual({ cx: 0, cy: 0 });
  });

  it('moves to the next chunk exactly at the boundary', () => {
    expect(chunkOf({ x: CHUNK_SIZE_TILES, y: 0 })).toEqual({ cx: 1, cy: 0 });
  });

  it('handles negative coordinates without a gap around zero', () => {
    expect(chunkOf({ x: -1, y: -1 })).toEqual({ cx: -1, cy: -1 });
    expect(chunkOf({ x: -CHUNK_SIZE_TILES, y: 0 })).toEqual({ cx: -1, cy: 0 });
  });

  it('always reports a position inside the chunk, even for negatives', () => {
    for (const x of [-65, -33, -32, -1, 0, 1, 31, 32, 64]) {
      const within = tileWithinChunk({ x, y: 0 });
      expect(within.x).toBeGreaterThanOrEqual(0);
      expect(within.x).toBeLessThan(CHUNK_SIZE_TILES);
    }
  });

  it('can rebuild the original tile from its chunk and offset', () => {
    for (const x of [-70, -1, 0, 5, 33, 200]) {
      const chunk = chunkOf({ x, y: 0 });
      const within = tileWithinChunk({ x, y: 0 });
      expect(chunk.cx * CHUNK_SIZE_TILES + within.x).toBe(x);
    }
  });
});

describe('chunkKey', () => {
  it('gives a different key for different chunks', () => {
    expect(chunkKey({ cx: 1, cy: 2 })).not.toBe(chunkKey({ cx: 2, cy: 1 }));
  });

  it('gives the same key for the same chunk', () => {
    expect(chunkKey({ cx: -3, cy: 4 })).toBe(chunkKey({ cx: -3, cy: 4 }));
  });
});

describe('tileToPixel and pixelToTile', () => {
  it('maps a tile to its top-left pixel', () => {
    expect(tileToPixel({ x: 2, y: 3 })).toEqual({ px: 2 * TILE_SIZE_PX, py: 3 * TILE_SIZE_PX });
  });

  it('turns any pixel inside a tile back into that tile', () => {
    const tile = { x: 4, y: 7 };
    const topLeft = tileToPixel(tile);
    expect(pixelToTile(topLeft)).toEqual(tile);
    expect(pixelToTile({ px: topLeft.px + TILE_SIZE_PX - 1, py: topLeft.py + 1 })).toEqual(tile);
  });

  it('works on the negative side of the map', () => {
    expect(pixelToTile({ px: -1, py: -1 })).toEqual({ x: -1, y: -1 });
  });
});

describe('directionBetween', () => {
  it('names the direction of every single step', () => {
    const origin = { x: 10, y: 10 };
    const directions: Direction[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    for (const direction of directions) {
      expect(directionBetween(origin, step(origin, direction))).toBe(direction);
    }
  });

  it('has no answer for standing still', () => {
    expect(directionBetween({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });

  it('has no answer for a jump of more than one tile', () => {
    expect(directionBetween({ x: 1, y: 1 }, { x: 5, y: 1 })).toBeNull();
  });
});
