/**
 * What a tile is made of.
 *
 * One tile is one character. The same alphabet is read by three places:
 * the world server (to decide what may be walked on), the map itself (which
 * is written as rows of characters), and the browser (to decide what colour
 * to draw). Keeping it here means those three can never disagree.
 *
 * Adding a kind of ground is adding one entry to this table. Anything that is
 * not in the table is treated as solid, so a typo in a map blocks a tile
 * instead of quietly opening a hole in a wall.
 */

/** Every character a map row may contain. */
export type TerrainChar =
  | 'o' // permanent public furniture
  | '.' // grass
  | ',' // road
  | 'p' // pavement, the stone of the squares
  | 'b' // bridge
  | 'd' // wooden floor, inside a building
  | '+' // doorway
  | 's' // shore
  | '#' // wall
  | '~' // water
  | 'T' // tree
  | 'F' // fence
  | 'M' // market stall
  | 'W'; // well

export interface Terrain {
  readonly char: TerrainChar;
  /** A name a person can read, used in tests and in tooling. */
  readonly name: string;
  /** May a player stand here? */
  readonly walkable: boolean;
}

const KINDS: readonly Terrain[] = [
  { char: 'o', name: 'public furniture', walkable: false },
  { char: '.', name: 'grass', walkable: true },
  { char: ',', name: 'road', walkable: true },
  { char: 'p', name: 'pavement', walkable: true },
  { char: 'b', name: 'bridge', walkable: true },
  { char: 'd', name: 'floorboards', walkable: true },
  { char: '+', name: 'doorway', walkable: true },
  { char: 's', name: 'shore', walkable: true },
  { char: '#', name: 'wall', walkable: false },
  { char: '~', name: 'water', walkable: false },
  { char: 'T', name: 'tree', walkable: false },
  { char: 'F', name: 'fence', walkable: false },
  { char: 'M', name: 'market stall', walkable: false },
  { char: 'W', name: 'well', walkable: false },
];

/** Every terrain, by its character. */
export const TERRAIN: Readonly<Record<TerrainChar, Terrain>> = Object.fromEntries(
  KINDS.map((kind) => [kind.char, kind]),
) as Record<TerrainChar, Terrain>;

/** The character used for anything outside the map, or not understood. */
export const SOLID_CHAR: TerrainChar = '#';

/** True when this character is one the game knows about. */
export function isTerrainChar(char: string): char is TerrainChar {
  return Object.prototype.hasOwnProperty.call(TERRAIN, char);
}

/**
 * May a player stand on this character?
 *
 * An unknown character is solid. That is the safe direction: a broken map
 * stops a player, it does not let them walk through a wall or off the world.
 */
export function isWalkableChar(char: string | undefined): boolean {
  if (char === undefined || !isTerrainChar(char)) return false;
  return TERRAIN[char].walkable;
}

/** Every character, for tests and tooling. */
export const TERRAIN_CHARS: readonly TerrainChar[] = KINDS.map((kind) => kind.char);
