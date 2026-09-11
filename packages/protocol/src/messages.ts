/**
 * Every message that travels between the browser and the world server.
 *
 * The rule from `docs/SPEC.md` that shapes this whole file:
 *
 *   The client sends **intents** ("I want to walk there").
 *   The server sends **facts** ("this is where everyone is").
 *
 * There is deliberately no message in which the client tells the server that
 * something has already happened. If you ever feel the need to add one, the
 * design is wrong.
 *
 * Every message is validated with zod before it is trusted, on both sides.
 */
import { z } from 'zod';
import { CHUNK_SIZE_TILES } from '@atheriam/shared';

/**
 * Bumped whenever a message shape changes in a way old clients cannot read.
 *
 * 2: joining takes a world ticket from the API instead of a bare name, so the
 *    world server knows which account is connecting.
 * 3: the map is no longer sent whole. The server streams the 32x32 chunks
 *    around the player and tells the client when to forget one.
 */
export const PROTOCOL_VERSION = 3;

/** The eight directions a player may step in. */
export const directionSchema = z.enum(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);

/** A whole-tile coordinate. Fractions are rejected: there is no half a tile. */
const tileCoordinateSchema = z.number().int().min(-1_000_000).max(1_000_000);

export const tilePosSchema = z.object({
  x: tileCoordinateSchema,
  y: tileCoordinateSchema,
});

/**
 * A number the client increases with every intent it sends. The server echoes
 * it back when it refuses one, so the client knows exactly which intent failed
 * instead of guessing.
 */
const sequenceSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * A display name. Kept deliberately narrow: letters, digits, spaces and a few
 * separators. This is the first line of defence against names used to fake
 * system messages or to smuggle markup into other players' screens.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, 'Letters and numbers only, may contain spaces.');

// ---------------------------------------------------------------------------
// Client -> Server. Intents only.
// ---------------------------------------------------------------------------

/**
 * Ask to enter the world, using a ticket obtained from the API.
 *
 * The client does not say who it is — it hands over a ticket, and the world
 * server asks the API's store who that ticket belongs to. A client cannot
 * choose its own name, its own character or its own account.
 */
export const joinIntentSchema = z.object({
  t: z.literal('join'),
  ticket: z.string().min(16).max(256),
});

/** Ask to take exactly one step. Sent by the keyboard controls. */
export const stepIntentSchema = z.object({
  t: z.literal('step'),
  seq: sequenceSchema,
  dir: directionSchema,
});

/**
 * Ask to walk to a tile. The server finds the path and walks it one tile per
 * tick. The client never decides the route: that is gameplay, and gameplay
 * belongs to the server.
 */
export const walkToIntentSchema = z.object({
  t: z.literal('walkTo'),
  seq: sequenceSchema,
  to: tilePosSchema,
});

/** Ask to stop walking now. */
export const stopIntentSchema = z.object({
  t: z.literal('stop'),
  seq: sequenceSchema,
});

/** Round-trip timing. `ts` is the client's clock and is echoed back untouched. */
export const pingSchema = z.object({
  t: z.literal('ping'),
  ts: z.number().int(),
});

export const clientMessageSchema = z.discriminatedUnion('t', [
  joinIntentSchema,
  stepIntentSchema,
  walkToIntentSchema,
  stopIntentSchema,
  pingSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type JoinIntent = z.infer<typeof joinIntentSchema>;
export type StepIntent = z.infer<typeof stepIntentSchema>;
export type WalkToIntent = z.infer<typeof walkToIntentSchema>;

// ---------------------------------------------------------------------------
// Server -> Client. Facts only.
// ---------------------------------------------------------------------------

/**
 * One 32x32 square of the map.
 *
 * The client is never sent the whole city: it is sent the chunks around the
 * player and forgets the rest, which is what keeps the world one continuous
 * space instead of a set of rooms (`docs/SPEC.md` section 7).
 *
 * Each row is a string, one character per tile. What each character means is
 * defined once, in `@atheriam/shared`.
 */
export const chunkSchema = z.object({
  t: z.literal('chunk'),
  cx: z.number().int().min(-32_768).max(32_768),
  cy: z.number().int().min(-32_768).max(32_768),
  rows: z.array(z.string().length(CHUNK_SIZE_TILES)).length(CHUNK_SIZE_TILES),
});

export type ChunkMessage = z.infer<typeof chunkSchema>;

/** Forget this chunk: the player has walked out of range of it. */
export const chunkDropSchema = z.object({
  t: z.literal('chunkDrop'),
  cx: z.number().int().min(-32_768).max(32_768),
  cy: z.number().int().min(-32_768).max(32_768),
});

/** How big the world is, so the client can size its camera and its minimap. */
export const worldInfoSchema = z.object({
  width: z.number().int().min(1).max(65_536),
  height: z.number().int().min(1).max(65_536),
  chunkSize: z.number().int().min(1).max(256),
});

export type WorldInfo = z.infer<typeof worldInfoSchema>;

/** One other player, as seen by this client. */
export const playerViewSchema = z.object({
  id: z.string().min(1).max(64),
  name: displayNameSchema,
  x: tileCoordinateSchema,
  y: tileCoordinateSchema,
  facing: directionSchema,
});

export type PlayerView = z.infer<typeof playerViewSchema>;

/** Sent once, right after a successful join. */
export const welcomeSchema = z.object({
  t: z.literal('welcome'),
  protocolVersion: z.number().int(),
  playerId: z.string().min(1).max(64),
  /** How long one server tick lasts, so the client can smooth movement. */
  tickMs: z.number().int().positive(),
  spawn: tilePosSchema,
  world: worldInfoSchema,
});

/**
 * The state of the world around this player, sent every tick in which
 * something the player can see has changed.
 *
 * `you` is separate from `players` so the client always knows which body is
 * its own without searching by id.
 */
export const snapshotSchema = z.object({
  t: z.literal('snapshot'),
  tick: z.number().int().nonnegative(),
  you: playerViewSchema,
  players: z.array(playerViewSchema).max(500),
});

/**
 * An intent the server refused. The client must snap back to the position in
 * the next snapshot. This is not an error to show the player; it is normal
 * when the network is slow.
 */
export const rejectSchema = z.object({
  t: z.literal('reject'),
  seq: sequenceSchema,
  reason: z.enum([
    'not-joined',
    'not-adjacent',
    'blocked',
    'too-fast',
    'out-of-bounds',
    'no-path',
    'malformed',
  ]),
});

/** The connection is being closed, with a reason a human can read. */
export const byeSchema = z.object({
  t: z.literal('bye'),
  reason: z.enum([
    'bad-ticket',
    'already-online',
    'server-full',
    'kicked',
    'shutdown',
    'protocol-error',
    'idle',
  ]),
});

export const pongSchema = z.object({
  t: z.literal('pong'),
  ts: z.number().int(),
  serverTick: z.number().int().nonnegative(),
});

export const serverMessageSchema = z.discriminatedUnion('t', [
  welcomeSchema,
  chunkSchema,
  chunkDropSchema,
  snapshotSchema,
  rejectSchema,
  byeSchema,
  pongSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type Welcome = z.infer<typeof welcomeSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Reject = z.infer<typeof rejectSchema>;
export type RejectReason = Reject['reason'];
export type Bye = z.infer<typeof byeSchema>;
