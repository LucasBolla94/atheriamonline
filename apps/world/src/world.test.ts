import { beforeEach, describe, expect, it } from 'vitest';
import { MIN_STEP_INTERVAL_MS, VIEW_RADIUS_TILES } from '@atheriam/shared';
import { GameMap } from './map.js';
import { World, type JoiningCharacter } from './world.js';

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

/**
 * A character as the API would hand one over: a real id, a real name, and the
 * tile they were standing on when they last logged out.
 */
function character(id: string, name: string, x = 1, y = 1): JoiningCharacter {
  return { id, name, x, y, facing: 's' };
}

function newWorld(): World {
  return new World(testMap);
}

describe('joining', () => {
  it('places a player on a walkable tile', () => {
    const world = newWorld();
    const result = world.join(character('al1', 'Aldric'), 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(testMap.isWalkable({ x: result.player.x, y: result.player.y })).toBe(true);
    }
  });

  it('refuses a name that is already in the world, ignoring case', () => {
    const world = newWorld();
    expect(world.join(character('al1', 'Aldric'), 1000).ok).toBe(true);
    const second = world.join(character('al2', 'aLdRiC'), 1000);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('already-online');
  });

  it('refuses to put the same character in the world twice', () => {
    // Two copies of one person would be two inventories later, which is
    // exactly how items get duplicated.
    const world = newWorld();
    expect(world.join(character('al1', 'Aldric'), 0).ok).toBe(true);
    const second = world.join(character('al1', 'Aldric'), 0);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('already-online');
    expect(world.playerCount).toBe(1);
  });

  it('puts a returning player back where they logged out', () => {
    const world = newWorld();
    const result = world.join(character('al1', 'Aldric', 7, 5), 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.player).toMatchObject({ x: 7, y: 5 });
  });

  it('moves a returning player to the spawn if a building now stands there', () => {
    // (4,2) is inside the block on the test map.
    const world = newWorld();
    const result = world.join(character('al1', 'Aldric', 4, 2), 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(testMap.isWalkable({ x: result.player.x, y: result.player.y })).toBe(true);
      expect({ x: result.player.x, y: result.player.y }).not.toEqual({ x: 4, y: 2 });
    }
  });

  it('keeps the character id it was given, so the database row still matches', () => {
    const world = newWorld();
    const result = world.join(character('character-uuid', 'Aldric'), 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.player.id).toBe('character-uuid');
  });

  it('frees the name again when the player leaves', () => {
    const world = newWorld();
    const first = world.join(character('al1', 'Aldric'), 1000);
    expect(first.ok).toBe(true);
    if (first.ok) world.leave(first.player.id);
    expect(world.join(character('al1', 'Aldric'), 1000).ok).toBe(true);
  });

  it('refuses new players once the world is full', () => {
    const world = new World(testMap, { maxPlayers: 1 });
    expect(world.join(character('al1', 'Aldric'), 0).ok).toBe(true);
    const second = world.join(character('br1', 'Bryn'), 0);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('server-full');
  });

  it('does not lose count of players', () => {
    const world = newWorld();
    world.join(character('al1', 'Aldric'), 0);
    world.join(character('br1', 'Bryn'), 0);
    expect(world.playerCount).toBe(2);
    world.leave('al1');
    expect(world.playerCount).toBe(1);
    // Leaving twice must not make the count go wrong.
    world.leave('al1');
    expect(world.playerCount).toBe(1);
  });
});

describe('stepping — the rules a modified client cannot get around', () => {
  let world: World;

  beforeEach(() => {
    world = newWorld();
    const joined = world.join(character('al1', 'Aldric'), 0);
    expect(joined.ok).toBe(true);
  });

  function placeAt(x: number, y: number): void {
    const player = world.get('al1');
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
    expect(world.handleStep('al1', 'n', 0)).toBe('blocked');
    expect(world.get('al1')).toMatchObject({ x: 1, y: 1 });
  });

  it('refuses a step off the edge of the map', () => {
    // The map is walled, so the wall is hit first; the check still has to hold
    // for a map without a border, which is why bounds are checked separately.
    const openMap = new GameMap(['...', '...', '...']);
    const open = new World(openMap);
    open.join(character('al1', 'Bryn', 0, 0), 0);
    const player = open.get('al1');
    expect(player).toBeDefined();
    if (player === undefined) return;
    player.x = 0;
    player.y = 0;
    player.lastStepAtMs = -MIN_STEP_INTERVAL_MS;
    expect(open.handleStep('al1', 'w', 0)).toBe('out-of-bounds');
  });

  it('refuses a second step taken too soon — the speed limit', () => {
    placeAt(1, 1);
    expect(world.handleStep('al1', 'e', 1000)).toBeNull();
    expect(world.handleStep('al1', 'e', 1000 + MIN_STEP_INTERVAL_MS - 1)).toBe('too-fast');
    expect(world.handleStep('al1', 'e', 1000 + MIN_STEP_INTERVAL_MS)).toBeNull();
  });

  it('refuses a diagonal that cuts the corner of a building', () => {
    // Standing just below-left of the block at (4,2): moving north-east would
    // slip through the corner between (4,3) wall and (3,2) open.
    placeAt(3, 3);
    expect(world.handleStep('al1', 'e', 0)).toBe('blocked');
    placeAt(3, 4);
    // (4,4) is open and (3,3)/(4,3) — (4,3) is wall, so the diagonal is refused.
    expect(world.handleStep('al1', 'ne', 0)).toBe('blocked');
  });

  it('moves exactly one tile and turns to face that way', () => {
    placeAt(1, 1);
    expect(world.handleStep('al1', 'e', 0)).toBeNull();
    expect(world.get('al1')).toMatchObject({ x: 2, y: 1, facing: 'e' });
  });

  it('never moves a player more than one tile per accepted step', () => {
    placeAt(1, 1);
    let now = 0;
    let previous = { x: 1, y: 1 };
    for (let i = 0; i < 5; i += 1) {
      now += MIN_STEP_INTERVAL_MS;
      const refused = world.handleStep('al1', 'e', now);
      const player = world.get('al1');
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
    world.join(character('al1', 'Aldric'), 0);
    const player = world.get('al1');
    if (player !== undefined) {
      player.x = 1;
      player.y = 1;
      player.lastStepAtMs = -MIN_STEP_INTERVAL_MS;
    }
  });

  it('refuses a destination inside a wall', () => {
    expect(world.handleWalkTo('al1', { x: 4, y: 2 })).toBe('blocked');
  });

  it('refuses a destination outside the map', () => {
    expect(world.handleWalkTo('al1', { x: 999, y: 999 })).toBe('out-of-bounds');
  });

  it('refuses a destination that is not a whole tile', () => {
    expect(world.handleWalkTo('al1', { x: 1.5, y: 1 })).toBe('out-of-bounds');
  });

  it('accepts a reachable destination and walks there one tile per step', () => {
    expect(world.handleWalkTo('al1', { x: 7, y: 5 })).toBeNull();

    let now = 0;
    for (let tick = 0; tick < 200; tick += 1) {
      now += MIN_STEP_INTERVAL_MS;
      world.advance(now);
      const player = world.get('al1');
      if (player !== undefined && player.x === 7 && player.y === 5) break;
    }

    expect(world.get('al1')).toMatchObject({ x: 7, y: 5 });
  });

  it('walks around a building instead of through it', () => {
    expect(world.handleWalkTo('al1', { x: 7, y: 2 })).toBeNull();

    let now = 0;
    const visited: string[] = [];
    for (let tick = 0; tick < 200; tick += 1) {
      now += MIN_STEP_INTERVAL_MS;
      world.advance(now);
      const player = world.get('al1');
      if (player === undefined) break;
      visited.push(`${player.x},${player.y}`);
      if (player.x === 7 && player.y === 2) break;
    }

    expect(world.get('al1')).toMatchObject({ x: 7, y: 2 });
    // Never standing on the building.
    for (const tile of ['4,2', '5,2', '4,3', '5,3']) {
      expect(visited).not.toContain(tile);
    }
  });

  it('has no route to a walkable tile that is sealed off', () => {
    const sealed = new GameMap(['#####', '#...#', '##.##', '#...#', '#####']);
    const sealedWorld = new World(sealed);
    // Wall the middle so the two halves are cut apart.
    const blocked = new GameMap(['#####', '#...#', '#####', '#...#', '#####']);
    const blockedWorld = new World(blocked);
    blockedWorld.join(character('al1', 'Aldric', 1, 1), 0);
    const player = blockedWorld.get('al1');
    if (player !== undefined) {
      player.x = 1;
      player.y = 1;
    }
    expect(blockedWorld.handleWalkTo('al1', { x: 1, y: 3 })).toBe('no-path');
    // The sealed map is connected, so the same trip is fine there.
    sealedWorld.join(character('al1', 'Bryn', 1, 1), 0);
    expect(sealedWorld.handleWalkTo('al1', { x: 1, y: 3 })).toBeNull();
  });

  it('stops where the player asks', () => {
    expect(world.handleWalkTo('al1', { x: 7, y: 5 })).toBeNull();
    expect(world.handleStop('al1')).toBeNull();
    world.advance(MIN_STEP_INTERVAL_MS * 10);
    expect(world.get('al1')).toMatchObject({ x: 1, y: 1 });
  });

  it('lets a keyboard step cancel the route', () => {
    expect(world.handleWalkTo('al1', { x: 7, y: 5 })).toBeNull();
    expect(world.handleStep('al1', 'e', MIN_STEP_INTERVAL_MS)).toBeNull();
    const before = world.get('al1');
    world.advance(MIN_STEP_INTERVAL_MS * 2);
    const after = world.get('al1');
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
  });

  it('respects the speed limit while following a route', () => {
    expect(world.handleWalkTo('al1', { x: 7, y: 5 })).toBeNull();
    const start = world.get('al1');
    expect(start).toMatchObject({ x: 1, y: 1 });
    // Ticking many times at the same instant must not move the player at all
    // beyond the first free step.
    world.advance(0);
    const afterFirst = { x: world.get('al1')?.x, y: world.get('al1')?.y };
    for (let i = 0; i < 20; i += 1) world.advance(0);
    expect({ x: world.get('al1')?.x, y: world.get('al1')?.y }).toEqual(afterFirst);
  });
});

describe('what a player is allowed to see', () => {
  it('shows a nearby player', () => {
    const big = new GameMap(Array.from({ length: 80 }, () => '.'.repeat(80)));
    const world = new World(big);
    world.join(character('al1', 'Aldric'), 0);
    world.join(character('br1', 'Bryn'), 0);
    const a = world.get('al1');
    const b = world.get('br1');
    if (a === undefined || b === undefined) throw new Error('players missing');
    a.x = 10;
    a.y = 10;
    b.x = 12;
    b.y = 10;

    const view = world.viewFor('al1');
    expect(view?.players.map((p) => p.name)).toEqual(['Bryn']);
  });

  it('does not send a player who is far away', () => {
    const big = new GameMap(Array.from({ length: 80 }, () => '.'.repeat(80)));
    const world = new World(big);
    world.join(character('al1', 'Aldric'), 0);
    world.join(character('br1', 'Bryn'), 0);
    const a = world.get('al1');
    const b = world.get('br1');
    if (a === undefined || b === undefined) throw new Error('players missing');
    a.x = 5;
    a.y = 5;
    b.x = 5 + VIEW_RADIUS_TILES * 3;
    b.y = 5;

    expect(world.viewFor('al1')?.players).toEqual([]);
  });

  it('never includes you in your own list of other players', () => {
    const world = newWorld();
    world.join(character('al1', 'Aldric'), 0);
    const view = world.viewFor('al1');
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
    world.join(character('al1', 'Aldric'), 0);
    expect(world.revision).not.toBe(before);
  });

  it('changes when somebody leaves', () => {
    const world = newWorld();
    world.join(character('al1', 'Aldric'), 0);
    const before = world.revision;
    world.leave('al1');
    expect(world.revision).not.toBe(before);
  });

  it('changes when somebody moves', () => {
    const world = newWorld();
    world.join(character('al1', 'Aldric'), 0);
    const before = world.revision;
    // East from the spawn corner is open ground; north is the city wall.
    expect(world.handleStep('al1', 'e', MIN_STEP_INTERVAL_MS * 10)).toBeNull();
    expect(world.revision).not.toBe(before);
  });

  it('does not change when nothing happens', () => {
    const world = newWorld();
    world.join(character('al1', 'Aldric'), 0);
    const before = world.revision;
    world.advance(MIN_STEP_INTERVAL_MS);
    world.advance(MIN_STEP_INTERVAL_MS * 2);
    expect(world.revision).toBe(before);
  });

  it('does not change when a step is refused', () => {
    const world = newWorld();
    world.join(character('al1', 'Aldric'), 0);
    const player = world.get('al1');
    if (player !== undefined) {
      player.x = 1;
      player.y = 1;
      player.lastStepAtMs = -MIN_STEP_INTERVAL_MS;
    }
    const before = world.revision;
    expect(world.handleStep('al1', 'n', 0)).toBe('blocked');
    expect(world.revision).toBe(before);
  });
});

/**
 * Talking.
 *
 * The map used above is only nine tiles wide, which is closer together than
 * anybody can whisper, so these use a wide open field instead: the point of
 * most of them is who is too far away to hear.
 */
describe('saying something', () => {
  const field = new GameMap(Array.from({ length: 60 }, () => '.'.repeat(60)));

  function fieldWorld(): World {
    return new World(field);
  }

  function join(world: World, id: string, name: string, x: number, y: number): void {
    const result = world.join({ id, name, x, y, facing: 's' }, 0);
    expect(result.ok).toBe(true);
  }

  it('is heard by the speaker, so they know it was accepted', () => {
    const world = fieldWorld();
    join(world, 'al1', 'Aldric', 10, 10);

    const result = world.handleSay('al1', 'Good evening', 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listeners).toEqual(['al1']);
  });

  it('is heard by somebody standing close by', () => {
    const world = fieldWorld();
    join(world, 'al1', 'Aldric', 10, 10);
    join(world, 'br1', 'Bryn', 12, 11);

    const result = world.handleSay('al1', 'Good evening', 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listeners).toContain('br1');
  });

  it('does not carry across the city', () => {
    const world = fieldWorld();
    join(world, 'al1', 'Aldric', 10, 10);
    join(world, 'br1', 'Bryn', 50, 50);

    const result = world.handleSay('al1', 'Good evening', 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listeners).not.toContain('br1');
  });

  it('is not heard by somebody who has blocked the speaker', () => {
    const world = fieldWorld();
    join(world, 'al1', 'Aldric', 10, 10);
    const bryn = world.join(
      { id: 'br1', name: 'Bryn', x: 11, y: 10, facing: 's', blocked: ['al1'] },
      0,
    );
    expect(bryn.ok).toBe(true);

    const result = world.handleSay('al1', 'Good evening', 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listeners).toEqual(['al1']);
  });

  it('is heard again once the block is lifted', () => {
    const world = fieldWorld();
    join(world, 'al1', 'Aldric', 10, 10);
    world.join({ id: 'br1', name: 'Bryn', x: 11, y: 10, facing: 's', blocked: ['al1'] }, 0);

    world.block('br1', 'al1', false);

    const result = world.handleSay('al1', 'Good evening', 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listeners).toContain('br1');
  });

  it('is refused from somebody a moderator has muted', () => {
    const world = fieldWorld();
    world.join({ id: 'al1', name: 'Aldric', x: 10, y: 10, facing: 's', mutedUntilMs: 5_000 }, 0);

    const result = world.handleSay('al1', 'Good evening', 1_000);
    expect(result).toEqual({ ok: false, reason: 'muted' });
  });

  it('is allowed again once the mute has run out', () => {
    const world = fieldWorld();
    world.join({ id: 'al1', name: 'Aldric', x: 10, y: 10, facing: 's', mutedUntilMs: 5_000 }, 0);

    expect(world.handleSay('al1', 'Good evening', 5_001).ok).toBe(true);
  });

  it('can be silenced and un-silenced while the player is standing there', () => {
    const world = fieldWorld();
    join(world, 'al1', 'Aldric', 10, 10);

    world.mute('al1', 10_000);
    expect(world.handleSay('al1', 'Good evening', 0).ok).toBe(false);

    world.mute('al1', null);
    expect(world.handleSay('al1', 'Good evening', 0).ok).toBe(true);
  });

  it('cleans up what was typed before anybody else sees it', () => {
    const world = fieldWorld();
    join(world, 'al1', 'Aldric', 10, 10);

    const result = world.handleSay('al1', '  hello   there\nfriend  ', 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('hello there friend');
  });

  it('refuses a message with nothing in it', () => {
    const world = fieldWorld();
    join(world, 'al1', 'Aldric', 10, 10);
    expect(world.handleSay('al1', '     ', 0)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses somebody who is not in the world at all', () => {
    const world = fieldWorld();
    expect(world.handleSay('nobody', 'hello', 0)).toEqual({ ok: false, reason: 'not-joined' });
  });

  it('stops a flood, and lets them speak again after a pause', () => {
    const world = fieldWorld();
    join(world, 'al1', 'Aldric', 10, 10);

    let refused = 0;
    for (let i = 0; i < 20; i += 1) {
      if (!world.handleSay('al1', `message ${i}`, 0).ok) refused += 1;
    }
    expect(refused).toBeGreaterThan(0);

    expect(world.handleSay('al1', 'later', 60_000).ok).toBe(true);
  });
});

describe('resident appearances', () => {
  it('makes a stationary appearance change visible without changing position', () => {
    const world = newWorld();
    world.join(character('look', 'Resident'), 1000);
    const before = world.revision;
    world.setAppearance('look', 4);
    expect(world.get('look')).toMatchObject({ x: 1, y: 1, appearance: 4 });
    expect(world.revision).toBeGreaterThan(before);
  });

  it('ignores unavailable appearances', () => {
    const world = newWorld();
    world.join(character('look', 'Resident'), 1000);
    for (const value of [-1, 6, 1.5, NaN]) world.setAppearance('look', value);
    expect(world.get('look')?.appearance).toBe(0);
  });
});
