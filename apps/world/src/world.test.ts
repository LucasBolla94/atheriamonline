import { beforeEach, describe, expect, it } from 'vitest';
import { MIN_STEP_INTERVAL_MS, VIEW_RADIUS_TILES } from '@atheriam/shared';
import { GameMap } from './map.js';
import { World } from './world.js';

/**
 * A small, obvious map for the tests. Reading it top to bottom:
 *   row 0 and row 6 are solid wall
 *   row 3 is an open corridor
 *   the block at (4,2)-(5,3) is an island the player must walk around
 */
const TEST_ROWS = [
  '#########',
  '#.......#',
  '#...##..#',
  '#...##..#',
  '#.......#',
  '#.......#',
  '#########',
];

const testMap = new GameMap(TEST_ROWS);

/** Ids that read clearly in a failure message. */
function sequentialIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `p${n}`;
  };
}

function newWorld(): World {
  return new World(testMap, { makeId: sequentialIds() });
}

describe('joining', () => {
  it('places a new player on a walkable tile', () => {
    const world = newWorld();
    const result = world.join('Aldric', 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(testMap.isWalkable({ x: result.player.x, y: result.player.y })).toBe(true);
    }
  });

  it('refuses a name that is already in the world, ignoring case', () => {
    const world = newWorld();
    expect(world.join('Aldric', 1000).ok).toBe(true);
    const second = world.join('aLdRiC', 1000);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('name-taken');
  });

  it('frees the name again when the player leaves', () => {
    const world = newWorld();
    const first = world.join('Aldric', 1000);
    expect(first.ok).toBe(true);
    if (first.ok) world.leave(first.player.id);
    expect(world.join('Aldric', 1000).ok).toBe(true);
  });

  it('refuses new players once the world is full', () => {
    const world = new World(testMap, { maxPlayers: 1, makeId: sequentialIds() });
    expect(world.join('Aldric', 0).ok).toBe(true);
    const second = world.join('Bryn', 0);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('server-full');
  });

  it('does not lose count of players', () => {
    const world = newWorld();
    world.join('Aldric', 0);
    world.join('Bryn', 0);
    expect(world.playerCount).toBe(2);
    world.leave('p1');
    expect(world.playerCount).toBe(1);
    // Leaving twice must not make the count go wrong.
    world.leave('p1');
    expect(world.playerCount).toBe(1);
  });
});

describe('stepping — the rules a modified client cannot get around', () => {
  let world: World;

  beforeEach(() => {
    world = newWorld();
    const joined = world.join('Aldric', 0);
    expect(joined.ok).toBe(true);
  });

  function placeAt(x: number, y: number): void {
    const player = world.get('p1');
    expect(player).toBeDefined();
    if (player === undefined) return;
    player.x = x;
    player.y = y;
    player.lastStepAtMs = -MIN_STEP_INTERVAL_MS;
  }

  it('refuses a step from someone who never joined', () => {
    expect(world.handleStep('nobody', 'n', 0)).toBe('not-joined');
  });

  it('refuses a step into a wall', () => {
    placeAt(1, 1);
    expect(world.handleStep('p1', 'n', 0)).toBe('blocked');
    expect(world.get('p1')).toMatchObject({ x: 1, y: 1 });
  });

  it('refuses a step off the edge of the map', () => {
    // The map is walled, so the wall is hit first; the check still has to hold
    // for a map without a border, which is why bounds are checked separately.
    const openMap = new GameMap(['...', '...', '...']);
    const open = new World(openMap, { makeId: sequentialIds() });
    open.join('Bryn', 0);
    const player = open.get('p1');
    expect(player).toBeDefined();
    if (player === undefined) return;
    player.x = 0;
    player.y = 0;
    player.lastStepAtMs = -MIN_STEP_INTERVAL_MS;
    expect(open.handleStep('p1', 'w', 0)).toBe('out-of-bounds');
  });

  it('refuses a second step taken too soon — the speed limit', () => {
    placeAt(1, 1);
    expect(world.handleStep('p1', 'e', 1000)).toBeNull();
    expect(world.handleStep('p1', 'e', 1000 + MIN_STEP_INTERVAL_MS - 1)).toBe('too-fast');
    expect(world.handleStep('p1', 'e', 1000 + MIN_STEP_INTERVAL_MS)).toBeNull();
  });

  it('refuses a diagonal that cuts the corner of a building', () => {
    // Standing just below-left of the block at (4,2): moving north-east would
    // slip through the corner between (4,3) wall and (3,2) open.
    placeAt(3, 3);
    expect(world.handleStep('p1', 'e', 0)).toBe('blocked');
    placeAt(3, 4);
    // (4,4) is open and (3,3)/(4,3) — (4,3) is wall, so the diagonal is refused.
    expect(world.handleStep('p1', 'ne', 0)).toBe('blocked');
  });

  it('moves exactly one tile and turns to face that way', () => {
    placeAt(1, 1);
    expect(world.handleStep('p1', 'e', 0)).toBeNull();
    expect(world.get('p1')).toMatchObject({ x: 2, y: 1, facing: 'e' });
  });

  it('never moves a player more than one tile per accepted step', () => {
    placeAt(1, 1);
    let now = 0;
    let previous = { x: 1, y: 1 };
    for (let i = 0; i < 5; i += 1) {
      now += MIN_STEP_INTERVAL_MS;
      const refused = world.handleStep('p1', 'e', now);
      const player = world.get('p1');
      expect(player).toBeDefined();
      if (player === undefined || refused !== null) break;
      expect(Math.abs(player.x - previous.x) + Math.abs(player.y - previous.y)).toBeLessThanOrEqual(
        2,
      );
      previous = { x: player.x, y: player.y };
    }
  });
});

describe('walking to a tile — the server owns the route', () => {
  let world: World;

  beforeEach(() => {
    world = newWorld();
    world.join('Aldric', 0);
    const player = world.get('p1');
    if (player !== undefined) {
      player.x = 1;
      player.y = 1;
      player.lastStepAtMs = -MIN_STEP_INTERVAL_MS;
    }
  });

  it('refuses a destination inside a wall', () => {
    expect(world.handleWalkTo('p1', { x: 4, y: 2 })).toBe('blocked');
  });

  it('refuses a destination outside the map', () => {
    expect(world.handleWalkTo('p1', { x: 999, y: 999 })).toBe('out-of-bounds');
  });

  it('refuses a destination that is not a whole tile', () => {
    expect(world.handleWalkTo('p1', { x: 1.5, y: 1 })).toBe('out-of-bounds');
  });

  it('accepts a reachable destination and walks there one tile per step', () => {
    expect(world.handleWalkTo('p1', { x: 7, y: 5 })).toBeNull();

    let now = 0;
    for (let tick = 0; tick < 200; tick += 1) {
      now += MIN_STEP_INTERVAL_MS;
      world.advance(now);
      const player = world.get('p1');
      if (player !== undefined && player.x === 7 && player.y === 5) break;
    }

    expect(world.get('p1')).toMatchObject({ x: 7, y: 5 });
  });

  it('walks around a building instead of through it', () => {
    expect(world.handleWalkTo('p1', { x: 7, y: 2 })).toBeNull();

    let now = 0;
    const visited: string[] = [];
    for (let tick = 0; tick < 200; tick += 1) {
      now += MIN_STEP_INTERVAL_MS;
      world.advance(now);
      const player = world.get('p1');
      if (player === undefined) break;
      visited.push(`${player.x},${player.y}`);
      if (player.x === 7 && player.y === 2) break;
    }

    expect(world.get('p1')).toMatchObject({ x: 7, y: 2 });
    // Never standing on the building.
    for (const tile of ['4,2', '5,2', '4,3', '5,3']) {
      expect(visited).not.toContain(tile);
    }
  });

  it('has no route to a walkable tile that is sealed off', () => {
    const sealed = new GameMap(['#####', '#...#', '##.##', '#...#', '#####']);
    const sealedWorld = new World(sealed, { makeId: sequentialIds() });
    // Wall the middle so the two halves are cut apart.
    const blocked = new GameMap(['#####', '#...#', '#####', '#...#', '#####']);
    const blockedWorld = new World(blocked, { makeId: sequentialIds() });
    blockedWorld.join('Aldric', 0);
    const player = blockedWorld.get('p1');
    if (player !== undefined) {
      player.x = 1;
      player.y = 1;
    }
    expect(blockedWorld.handleWalkTo('p1', { x: 1, y: 3 })).toBe('no-path');
    // The sealed map is connected, so the same trip is fine there.
    sealedWorld.join('Bryn', 0);
    expect(sealedWorld.handleWalkTo('p1', { x: 1, y: 3 })).toBeNull();
  });

  it('stops where the player asks', () => {
    expect(world.handleWalkTo('p1', { x: 7, y: 5 })).toBeNull();
    expect(world.handleStop('p1')).toBeNull();
    world.advance(MIN_STEP_INTERVAL_MS * 10);
    expect(world.get('p1')).toMatchObject({ x: 1, y: 1 });
  });

  it('lets a keyboard step cancel the route', () => {
    expect(world.handleWalkTo('p1', { x: 7, y: 5 })).toBeNull();
    expect(world.handleStep('p1', 'e', MIN_STEP_INTERVAL_MS)).toBeNull();
    const before = world.get('p1');
    world.advance(MIN_STEP_INTERVAL_MS * 2);
    const after = world.get('p1');
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
  });

  it('respects the speed limit while following a route', () => {
    expect(world.handleWalkTo('p1', { x: 7, y: 5 })).toBeNull();
    const start = world.get('p1');
    expect(start).toMatchObject({ x: 1, y: 1 });
    // Ticking many times at the same instant must not move the player at all
    // beyond the first free step.
    world.advance(0);
    const afterFirst = { x: world.get('p1')?.x, y: world.get('p1')?.y };
    for (let i = 0; i < 20; i += 1) world.advance(0);
    expect({ x: world.get('p1')?.x, y: world.get('p1')?.y }).toEqual(afterFirst);
  });
});

describe('what a player is allowed to see', () => {
  it('shows a nearby player', () => {
    const big = new GameMap(Array.from({ length: 80 }, () => '.'.repeat(80)));
    const world = new World(big, { makeId: sequentialIds() });
    world.join('Aldric', 0);
    world.join('Bryn', 0);
    const a = world.get('p1');
    const b = world.get('p2');
    if (a === undefined || b === undefined) throw new Error('players missing');
    a.x = 10;
    a.y = 10;
    b.x = 12;
    b.y = 10;

    const view = world.viewFor('p1');
    expect(view?.players.map((p) => p.name)).toEqual(['Bryn']);
  });

  it('does not send a player who is far away', () => {
    const big = new GameMap(Array.from({ length: 80 }, () => '.'.repeat(80)));
    const world = new World(big, { makeId: sequentialIds() });
    world.join('Aldric', 0);
    world.join('Bryn', 0);
    const a = world.get('p1');
    const b = world.get('p2');
    if (a === undefined || b === undefined) throw new Error('players missing');
    a.x = 5;
    a.y = 5;
    b.x = 5 + VIEW_RADIUS_TILES * 3;
    b.y = 5;

    expect(world.viewFor('p1')?.players).toEqual([]);
  });

  it('never includes you in your own list of other players', () => {
    const world = newWorld();
    world.join('Aldric', 0);
    const view = world.viewFor('p1');
    expect(view?.you.name).toBe('Aldric');
    expect(view?.players).toEqual([]);
  });

  it('has nothing to show someone who is not in the world', () => {
    expect(newWorld().viewFor('ghost')).toBeNull();
  });
});

describe('the tick counter', () => {
  it('only ever goes up', () => {
    const world = newWorld();
    const first = world.tick;
    world.advance(0);
    world.advance(100);
    expect(world.tick).toBe(first + 2);
  });
});

describe('the revision counter', () => {
  // This exists because of a real bug: the server used to refresh clients only
  // when somebody moved, so a player already standing in the world was never
  // told that a new player had arrived.
  it('changes when somebody joins', () => {
    const world = newWorld();
    const before = world.revision;
    world.join('Aldric', 0);
    expect(world.revision).not.toBe(before);
  });

  it('changes when somebody leaves', () => {
    const world = newWorld();
    world.join('Aldric', 0);
    const before = world.revision;
    world.leave('p1');
    expect(world.revision).not.toBe(before);
  });

  it('changes when somebody moves', () => {
    const world = newWorld();
    world.join('Aldric', 0);
    const before = world.revision;
    world.handleStep('p1', 'n', MIN_STEP_INTERVAL_MS * 10);
    expect(world.revision).not.toBe(before);
  });

  it('does not change when nothing happens', () => {
    const world = newWorld();
    world.join('Aldric', 0);
    const before = world.revision;
    world.advance(MIN_STEP_INTERVAL_MS);
    world.advance(MIN_STEP_INTERVAL_MS * 2);
    expect(world.revision).toBe(before);
  });

  it('does not change when a step is refused', () => {
    const world = newWorld();
    world.join('Aldric', 0);
    const player = world.get('p1');
    if (player !== undefined) {
      player.x = 1;
      player.y = 1;
      player.lastStepAtMs = -MIN_STEP_INTERVAL_MS;
    }
    const before = world.revision;
    expect(world.handleStep('p1', 'n', 0)).toBe('blocked');
    expect(world.revision).toBe(before);
  });
});
