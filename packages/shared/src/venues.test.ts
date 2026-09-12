import { describe, expect, it } from 'vitest';
import { CITY_BUILDINGS, LOUNGE_ROOMS } from './city.js';
import { INTERIOR_ENTRANCE, INTERIOR_HEIGHT, INTERIOR_WIDTH } from './interior.js';
import { isWalkableChar } from './terrain.js';
import { PUBLIC_VENUES, publicVenue, VENUE_IDS, VENUE_PROP_NAMES } from './venues.js';

describe('furnished public environments', () => {
  it('furnishes exactly the five public buildings and three reservable rooms', () => {
    const expected = [
      ...CITY_BUILDINGS.filter((building) => building.use !== 'shop').map(
        (building) => building.id,
      ),
      ...LOUNGE_ROOMS.map((room) => room.id),
    ];
    expect([...VENUE_IDS].sort()).toEqual(expected.sort());
    expect(publicVenue('unknown')).toBeNull();
    expect(publicVenue(null)).toBeNull();
  });
  it.each(VENUE_IDS)('%s keeps every walking tile connected to a clear entrance and exit', (id) => {
    const venue = PUBLIC_VENUES[id];
    expect(venue.rows).toHaveLength(INTERIOR_HEIGHT);
    for (const row of venue.rows) expect(row).toHaveLength(INTERIOR_WIDTH);
    const seen = new Set<string>(),
      queue = [INTERIOR_ENTRANCE];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]!;
      const key = `${current.x},${current.y}`;
      if (seen.has(key) || !isWalkableChar(venue.rows[current.y]?.[current.x])) continue;
      seen.add(key);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        queue.push({ x: current.x + dx!, y: current.y + dy! });
    }
    let walkable = 0;
    for (let y = 0; y < INTERIOR_HEIGHT; y++)
      for (let x = 0; x < INTERIOR_WIDTH; x++)
        if (isWalkableChar(venue.rows[y]?.[x])) {
          walkable++;
          expect(seen.has(`${x},${y}`)).toBe(true);
        }
    expect(walkable).toBeGreaterThan(180);
    for (let y = 12; y < INTERIOR_HEIGHT; y++)
      for (const x of [9, 10]) expect(seen.has(`${x},${y}`)).toBe(true);
    for (const item of venue.props) {
      expect(VENUE_PROP_NAMES).toContain(item.art);
      for (let y = item.y; y < item.y + item.height; y++)
        for (let x = item.x; x < item.x + item.width; x++) {
          expect(venue.rows[y]?.[x]).toBe('o');
          expect(isWalkableChar(venue.rows[y]?.[x])).toBe(false);
        }
    }
  });
  it('provides enough visible seats for every reserved meeting place', () => {
    for (const room of LOUNGE_ROOMS) {
      const seats = PUBLIC_VENUES[room.id].props.reduce(
        (count, item) =>
          count +
          (item.art === 'bench' || item.art === 'sofa' ? 2 : item.art === 'office-chair' ? 1 : 0),
        0,
      );
      expect(seats).toBe(room.capacity);
    }
  });
});
