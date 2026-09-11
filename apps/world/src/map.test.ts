import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE_TILES } from '@atheriam/shared';
import { GameMap, spawnPoint, starterDistrict } from './map.js';

describe('GameMap', () => {
  it('refuses a map whose rows are not all the same width', () => {
    expect(() => new GameMap(['###', '##'])).toThrow(/same width/);
  });

  it('refuses an empty map', () => {
    expect(() => new GameMap([])).toThrow();
  });

  it('knows what is inside it', () => {
    const map = new GameMap(['...', '...']);
    expect(map.contains({ x: 0, y: 0 })).toBe(true);
    expect(map.contains({ x: 2, y: 1 })).toBe(true);
    expect(map.contains({ x: 3, y: 0 })).toBe(false);
    expect(map.contains({ x: -1, y: 0 })).toBe(false);
  });

  it('treats grass and road as walkable, wall and water as solid', () => {
    const map = new GameMap(['.,#~']);
    expect(map.isWalkable({ x: 0, y: 0 })).toBe(true);
    expect(map.isWalkable({ x: 1, y: 0 })).toBe(true);
    expect(map.isWalkable({ x: 2, y: 0 })).toBe(false);
    expect(map.isWalkable({ x: 3, y: 0 })).toBe(false);
  });

  it('says a tile outside the map is not walkable rather than crashing', () => {
    const map = new GameMap(['...']);
    expect(map.isWalkable({ x: 99, y: 99 })).toBe(false);
    expect(map.isWalkable({ x: -5, y: 0 })).toBe(false);
  });
});

describe('the starter district', () => {
  it('is fully walled in, so nobody can walk off the edge', () => {
    const { width, height } = starterDistrict;
    for (let x = 0; x < width; x += 1) {
      expect(starterDistrict.isWalkable({ x, y: 0 })).toBe(false);
      expect(starterDistrict.isWalkable({ x, y: height - 1 })).toBe(false);
    }
    for (let y = 0; y < height; y += 1) {
      expect(starterDistrict.isWalkable({ x: 0, y })).toBe(false);
      expect(starterDistrict.isWalkable({ x: width - 1, y })).toBe(false);
    }
  });

  it('is at least one chunk across, so chunk streaming has something to do', () => {
    expect(starterDistrict.width).toBeGreaterThanOrEqual(CHUNK_SIZE_TILES);
  });

  it('spawns players somewhere they can stand', () => {
    const spawn = spawnPoint(starterDistrict);
    expect(starterDistrict.isWalkable(spawn)).toBe(true);
  });

  it('cuts every chunk to exactly the size the protocol promises', () => {
    const across = starterDistrict.chunksAcross;
    for (let cy = 0; cy < across.cy; cy += 1) {
      for (let cx = 0; cx < across.cx; cx += 1) {
        const rows = starterDistrict.chunkRows({ cx, cy });
        expect(rows).toHaveLength(CHUNK_SIZE_TILES);
        for (const row of rows ?? []) expect(row.length).toBe(CHUNK_SIZE_TILES);
      }
    }
  });

  it('has no chunk outside its own edges', () => {
    const across = starterDistrict.chunksAcross;
    expect(starterDistrict.chunkRows({ cx: across.cx, cy: 0 })).toBeNull();
    expect(starterDistrict.chunkRows({ cx: 0, cy: -1 })).toBeNull();
  });

  it('gives the same chunk back, so cutting it twice costs nothing', () => {
    const first = starterDistrict.chunkRows({ cx: 1, cy: 1 });
    expect(starterDistrict.chunkRows({ cx: 1, cy: 1 })).toBe(first);
  });

  it('pads a chunk that runs past the edge of a small map with stone', () => {
    const map = new GameMap(['...', '...']);
    const rows = map.chunkRows({ cx: 0, cy: 0 });
    expect(rows).toHaveLength(CHUNK_SIZE_TILES);
    expect(rows?.[0]).toBe('...' + '#'.repeat(CHUNK_SIZE_TILES - 3));
    expect(rows?.[CHUNK_SIZE_TILES - 1]).toBe('#'.repeat(CHUNK_SIZE_TILES));
  });
});

describe('spawnPoint', () => {
  it('finds a walkable tile even when the middle is blocked', () => {
    const map = new GameMap(['.....', '.....', '..#..', '.....', '.....']);
    expect(map.isWalkable(spawnPoint(map))).toBe(true);
  });

  it('says so clearly when a map has nowhere to stand', () => {
    expect(() => spawnPoint(new GameMap(['###', '###']))).toThrow(/no walkable tile/);
  });
});
