import { describe, expect, it } from 'vitest';
import { CITY_SEATS, LOUNGE_ROOMS, VENUE_IDS, PUBLIC_VENUES, venueSeats } from '@atheriam/shared';
import { World } from './world.js';
import { GameMap, starterDistrict } from './map.js';

function city() {
  const world = new World(starterDistrict, { seats: CITY_SEATS });
  world.join({ id: 'alice', name: 'Alice', x: 68, y: 82, facing: 'n' }, 1000);
  world.join({ id: 'bob', name: 'Bob', x: 68, y: 80, facing: 's' }, 1000);
  return world;
}

describe('authoritative social actions', () => {
  it('shares a wave with nearby observers and ends it on the server clock', () => {
    const world = city();
    world.handleWalkTo('alice', { x: 80, y: 85 });
    expect(world.handleSocial('alice', 'wave', undefined, 1000)).toBeNull();
    expect(world.get('alice')?.path).toEqual([]);
    expect(world.viewFor('bob')?.players[0]).toMatchObject({
      pose: 'wave',
      poseSince: 1000,
      facing: 's',
    });
    world.advance(2799);
    expect(world.get('alice')?.pose).toBe('wave');
    const revision = world.revision;
    world.advance(2800);
    expect(world.revision).toBeGreaterThan(revision);
    expect(world.viewFor('bob')?.players[0]?.pose).toBeUndefined();
  });

  it('allows one occupant per seat and preserves the safe standing tile', () => {
    const world = city();
    expect(world.handleSocial('alice', 'sit', '68:81', 1000)).toBeNull();
    expect(world.viewFor('bob')?.players[0]).toMatchObject({
      x: 68,
      y: 82,
      pose: 'sit',
      seat: { x: 68, y: 81 },
    });
    expect(world.handleSocial('bob', 'sit', '68:81', 1000)).toBe('blocked');
    expect(world.handleSocial('alice', 'stand', undefined, 1001)).toBeNull();
    expect(world.handleSocial('bob', 'sit', '68:81', 1001)).toBeNull();
  });

  it('refuses invented and distant seats without changing position or pose', () => {
    const world = city();
    expect(world.handleSocial('alice', 'sit', '79:77', 1000)).toBe('blocked');
    expect(world.handleSocial('alice', 'sit', '72:72', 1000)).toBe('not-adjacent');
    expect(world.get('alice')).toMatchObject({ x: 68, y: 82, pose: 'stand', seat: null });
    expect(world.handleSocial('missing', 'wave', undefined, 1000)).toBe('not-joined');
  });

  it('movement stands up and releases the seat without walking through furniture', () => {
    const world = city();
    world.handleSocial('alice', 'sit', '68:81', 1000);
    expect(world.handleStep('alice', 'n', 1200)).toBe('blocked');
    expect(world.get('alice')?.pose).toBe('sit');
    expect(world.handleStep('alice', 's', 1200)).toBeNull();
    expect(world.get('alice')).toMatchObject({ x: 68, y: 83, pose: 'stand', seat: null });
    expect(world.handleSocial('bob', 'sit', '68:81', 1200)).toBeNull();
  });

  it('a valid route releases a seat, while a refused route does not', () => {
    const world = city();
    world.handleSocial('alice', 'sit', '68:81', 1000);
    expect(world.handleWalkTo('alice', { x: 68, y: 81 })).toBe('blocked');
    expect(world.get('alice')?.pose).toBe('sit');
    expect(world.handleWalkTo('alice', { x: 80, y: 85 })).toBeNull();
    expect(world.get('alice')?.pose).toBe('stand');
    expect(world.handleSocial('bob', 'sit', '68:81', 1200)).toBeNull();
  });

  it('disconnect releases the seat and joining starts standing', () => {
    const world = city();
    world.handleSocial('alice', 'sit', '68:81', 1000);
    world.leave('alice');
    expect(world.handleSocial('bob', 'sit', '68:81', 1001)).toBeNull();
    world.join({ id: 'alice', name: 'Alice', x: 68, y: 82, facing: 's' }, 1002);
    expect(world.get('alice')).toMatchObject({ pose: 'stand', seat: null });
  });

  it('limits action spam but always allows standing up', () => {
    const world = city();
    world.handleSocial('alice', 'wave', undefined, 1000);
    expect(world.handleSocial('alice', 'sit', '68:81', 1100)).toBe('too-fast');
    expect(world.handleSocial('alice', 'stand', undefined, 1100)).toBeNull();
    expect(world.handleSocial('alice', 'wave', undefined, 2999)).toBe('too-fast');
    expect(world.handleSocial('alice', 'wave', undefined, 3000)).toBeNull();
  });

  it('each public seat has an adjacent standing tile and meeting seating matches capacity', () => {
    for (const id of VENUE_IDS) {
      const map = new GameMap(PUBLIC_VENUES[id].rows);
      const seats = venueSeats(id);
      expect(new Set(seats.map((seat) => seat.id)).size).toBe(seats.length);
      for (const seat of seats) {
        expect(map.isWalkable(seat)).toBe(false);
        expect(
          [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ].some(([dx, dy]) => map.isWalkable({ x: seat.x + dx!, y: seat.y + dy! })),
        ).toBe(true);
      }
      const room = LOUNGE_ROOMS.find((entry) => entry.id === id);
      if (room) expect(seats.length).toBe(room.capacity);
    }
  });
});
