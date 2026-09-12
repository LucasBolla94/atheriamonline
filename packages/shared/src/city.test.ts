import { describe, expect, it } from 'vitest';
import { CITY_BUILDINGS, STARTER_CITY, buildingAtEntrance, cityBuilding } from './city.js';

describe('the first city property supply', () => {
  it('has exactly ten saleable addresses and five municipal venues', () => {
    expect(CITY_BUILDINGS).toHaveLength(15);
    expect(CITY_BUILDINGS.filter((b) => b.kind === 'commercial')).toHaveLength(10);
    expect(CITY_BUILDINGS.filter((b) => b.kind === 'public')).toHaveLength(5);
    expect(new Set(CITY_BUILDINGS.map((b) => b.id)).size).toBe(15);
    for (const b of CITY_BUILDINGS) {
      expect(b.cityId).toBe(STARTER_CITY.id);
      expect(BigInt(b.priceMinor) > 0n).toBe(b.kind === 'commercial');
    }
  });

  it('keeps every building separate and inside the city boundary', () => {
    for (const a of CITY_BUILDINGS) {
      expect(a.x).toBeGreaterThan(1);
      expect(a.y).toBeGreaterThan(1);
      expect(a.x + a.width).toBeLessThan(STARTER_CITY.size - 2);
      expect(a.entrance.y + 1).toBeLessThan(STARTER_CITY.size - 2);
      for (const b of CITY_BUILDINGS) {
        if (a.id === b.id) continue;
        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('resolves real door tiles and rejects nearby pavement or an unknown address', () => {
    for (const b of CITY_BUILDINGS) {
      expect(cityBuilding(b.id)).toBe(b);
      expect(buildingAtEntrance(b.entrance.x, b.entrance.y)).toBe(b);
      expect(buildingAtEntrance(b.entrance.x - 1, b.entrance.y)).toBe(b);
      expect(buildingAtEntrance(b.entrance.x, b.entrance.y + 1)).toBeUndefined();
    }
    expect(cityBuilding('unknown')).toBeUndefined();
  });
});
