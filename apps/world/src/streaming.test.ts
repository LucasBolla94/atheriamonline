import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE_TILES, chunkKey } from '@atheriam/shared';
import { GameMap, starterDistrict } from './map.js';
import { CHUNK_VIEW_TILES, chunksInView, diffChunks, parseChunkKey } from './streaming.js';

/** A map four chunks by four chunks, all grass. */
const wide = new GameMap(
  Array.from({ length: CHUNK_SIZE_TILES * 4 }, () => '.'.repeat(CHUNK_SIZE_TILES * 4)),
);

describe('chunksInView', () => {
  it('gives a player the chunk they are standing in', () => {
    const chunks = chunksInView(wide, { x: 40, y: 40 });
    expect(chunks.map(chunkKey)).toContain('1:1');
  });

  it('never hands out a chunk that is not part of the map', () => {
    for (const chunk of chunksInView(wide, { x: 1, y: 1 })) {
      expect(chunk.cx).toBeGreaterThanOrEqual(0);
      expect(chunk.cy).toBeGreaterThanOrEqual(0);
      expect(wide.hasChunk(chunk)).toBe(true);
    }
  });

  it('covers everything the player can see, and stops there', () => {
    const centre = { x: 64, y: 64 };
    const chunks = chunksInView(starterDistrict, centre);
    const keys = new Set(chunks.map(chunkKey));

    // Every tile within view must belong to a chunk we are sending.
    for (const [dx, dy] of [
      [-CHUNK_VIEW_TILES, 0],
      [CHUNK_VIEW_TILES, 0],
      [0, -CHUNK_VIEW_TILES],
      [0, CHUNK_VIEW_TILES],
    ] as const) {
      const cx = Math.floor((centre.x + dx) / CHUNK_SIZE_TILES);
      const cy = Math.floor((centre.y + dy) / CHUNK_SIZE_TILES);
      expect(keys.has(`${cx}:${cy}`)).toBe(true);
    }

    // And the city is bigger than what one player is given.
    const across = starterDistrict.chunksAcross;
    expect(chunks.length).toBeLessThan(across.cx * across.cy);
  });

  it('sends fewer chunks in a corner than in the middle', () => {
    expect(chunksInView(wide, { x: 2, y: 2 }).length).toBeLessThan(
      chunksInView(wide, { x: 64, y: 64 }).length,
    );
  });
});

describe('diffChunks', () => {
  it('sends everything to a client that holds nothing', () => {
    const wanted = chunksInView(wide, { x: 40, y: 40 });
    const { toSend, toDrop } = diffChunks(new Set(), wanted);
    expect(toSend).toHaveLength(wanted.length);
    expect(toDrop).toEqual([]);
  });

  it('sends nothing at all to a client that is already up to date', () => {
    const wanted = chunksInView(wide, { x: 40, y: 40 });
    const held = new Set(wanted.map(chunkKey));
    expect(diffChunks(held, wanted)).toEqual({ toSend: [], toDrop: [] });
  });

  it('takes back the chunks a player has walked away from', () => {
    const before = chunksInView(wide, { x: 8, y: 8 });
    const after = chunksInView(wide, { x: 120, y: 120 });
    const { toSend, toDrop } = diffChunks(new Set(before.map(chunkKey)), after);

    expect(toDrop.map(chunkKey)).toContain('0:0');
    expect(toSend.map(chunkKey)).toContain('3:3');
  });

  it('ignores a key it did not write, rather than sending nonsense', () => {
    const { toDrop } = diffChunks(new Set(['not a chunk']), []);
    expect(toDrop).toEqual([]);
  });
});

describe('parseChunkKey', () => {
  it('reads back what chunkKey writes, negatives included', () => {
    expect(parseChunkKey(chunkKey({ cx: -3, cy: 7 }))).toEqual({ cx: -3, cy: 7 });
  });

  it('refuses anything that is not a key', () => {
    expect(parseChunkKey('1')).toBeNull();
    expect(parseChunkKey('1:2:3')).toBeNull();
    expect(parseChunkKey('a:b')).toBeNull();
  });
});
