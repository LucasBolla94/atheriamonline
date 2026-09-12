import { STARTER_CITY } from './city.js';

/**
 * World constants.
 *
 * These numbers are decided in `docs/SPEC.md` and `docs/DECISIONS.md`.
 * Changing one here changes it everywhere, which is the point: there must be
 * exactly one definition of "how big is a tile".
 */

/** Width and height of one tile, in pixels, at 1x zoom. See D-001. */
export const TILE_SIZE_PX = 32;

/** Width and height of one chunk, measured in tiles. See D-002. */
export const CHUNK_SIZE_TILES = 32;

/** How many times per second the world server advances the simulation. See D-003. */
export const TICK_HZ = 10;

/** How long one tick lasts, in milliseconds. */
export const TICK_MS = 1000 / TICK_HZ;

/**
 * How far a player can see, in tiles. Other players further away than this are
 * not sent to the client at all (interest management).
 */
export const VIEW_RADIUS_TILES = 24;

/**
 * Extra margin added to the view radius before we stop sending updates about
 * someone. Without it, a player standing exactly on the edge would flicker in
 * and out of view.
 */
export const VIEW_MARGIN_TILES = 4;

/**
 * The fastest a player may take a step, in milliseconds. The server rejects
 * movement intents that arrive sooner than this.
 */
export const MIN_STEP_INTERVAL_MS = 180;

/** How often online player positions are written to the database, in ms. */
export const POSITION_SNAPSHOT_INTERVAL_MS = 60_000;

/**
 * Where a brand new character starts: Central Square, by the fountain.
 *
 * Both the API (which creates the character) and the world server (which draws
 * the city) need this, and they must agree, so it is decided once, here.
 */
export const DEFAULT_SPAWN_TILE = STARTER_CITY.spawn;

/**
 * How far an ordinary remark carries, in tiles.
 *
 * Smaller than the view radius on purpose: you can see someone across the
 * square without hearing them, which is what makes standing closer mean
 * something. See D-028.
 */
export const CHAT_RADIUS_TILES = 12;

/** The longest thing anybody may say in one message. */
export const MAX_CHAT_LENGTH = 200;

/**
 * Chat is limited by a bucket of tokens rather than a flat delay: a player may
 * fire off a few lines in a row, and then has to wait. A flat delay makes
 * ordinary conversation feel broken; a bucket only stops a flood.
 */
export const CHAT_BURST = 5;

/** How long it takes for one chat token to come back, in milliseconds. */
export const CHAT_TOKEN_REFILL_MS = 2_000;
