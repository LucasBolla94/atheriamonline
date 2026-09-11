import { describe, expect, it } from 'vitest';
import { SOLID_CHAR, TERRAIN, TERRAIN_CHARS, isTerrainChar, isWalkableChar } from './terrain.js';

describe('the terrain alphabet', () => {
  it('describes every character exactly once', () => {
    expect(new Set(TERRAIN_CHARS).size).toBe(TERRAIN_CHARS.length);
    for (const char of TERRAIN_CHARS) {
      expect(TERRAIN[char].char).toBe(char);
      expect(TERRAIN[char].name.length).toBeGreaterThan(0);
    }
  });

  it('uses one character per tile, so a row of text is a row of the map', () => {
    for (const char of TERRAIN_CHARS) expect(char).toHaveLength(1);
  });

  it('lets a player walk on ground and not through walls', () => {
    expect(isWalkableChar('.')).toBe(true);
    expect(isWalkableChar(',')).toBe(true);
    expect(isWalkableChar('+')).toBe(true);
    expect(isWalkableChar('#')).toBe(false);
    expect(isWalkableChar('~')).toBe(false);
    expect(isWalkableChar('T')).toBe(false);
  });

  it('treats anything it does not recognise as solid', () => {
    // A typo in a map must stop a player, never open a hole in a wall.
    expect(isWalkableChar('?')).toBe(false);
    expect(isWalkableChar('')).toBe(false);
    expect(isWalkableChar(undefined)).toBe(false);
    expect(isWalkableChar('constructor')).toBe(false);
  });

  it('knows which characters belong to the game', () => {
    expect(isTerrainChar('.')).toBe(true);
    expect(isTerrainChar('?')).toBe(false);
    expect(isTerrainChar('toString')).toBe(false);
  });

  it('uses a solid character for everything outside the map', () => {
    expect(isWalkableChar(SOLID_CHAR)).toBe(false);
  });
});
