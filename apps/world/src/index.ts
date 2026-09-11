/**
 * Atheriam world server — the process that runs the live city.
 *
 * It keeps every player's position in memory and never writes a database row
 * per step. A position is written down once, when the player leaves.
 *
 * It does not decide who anybody is. A player arrives with a ticket that the
 * API issued to a logged-in account; this process spends the ticket and looks
 * the character up.
 */
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { CHAT_RADIUS_TILES, TICK_HZ, VIEW_RADIUS_TILES, type Direction } from '@atheriam/shared';
import { PROTOCOL_VERSION, WORLD_COMMAND_CHANNEL, decodeWorldCommand } from '@atheriam/protocol';
import { accounts, blocks, characters, connect } from '@atheriam/db';
import { starterDistrict } from './map.js';
import { World, type JoiningCharacter } from './world.js';
import { WorldServer } from './server.js';

const host = process.env['WORLD_HOST'] ?? '0.0.0.0';
const port = Number(process.env['WORLD_PORT'] ?? 3002);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`[world] WORLD_PORT is not a usable port: ${String(process.env['WORLD_PORT'])}`);
  process.exit(1);
}

const database = connect();
const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
const world = new World(starterDistrict);

/**
 * Spend a ticket and find the character it stands for.
 *
 * The ticket is deleted as it is read, in one Redis command, so two
 * connections racing on a stolen ticket cannot both get in.
 */
async function resolveTicket(ticket: string): Promise<JoiningCharacter | null> {
  const raw = await redis.getdel(`ticket:${ticket}`);
  if (raw === null) return null;

  let data: { characterId?: unknown };
  try {
    data = JSON.parse(raw) as { characterId?: unknown };
  } catch {
    return null;
  }
  if (typeof data.characterId !== 'string') return null;

  // The character, and the two things about them that decide what they may do
  // once they are inside: whether a moderator has silenced them, and who they
  // have chosen not to hear.
  const found = await database.db
    .select({
      id: characters.id,
      name: characters.name,
      x: characters.x,
      y: characters.y,
      facing: characters.facing,
      status: accounts.status,
      mutedUntil: accounts.mutedUntil,
    })
    .from(characters)
    .innerJoin(accounts, eq(accounts.id, characters.accountId))
    .where(eq(characters.id, data.characterId))
    .limit(1);

  const character = found[0];
  if (character === undefined) return null;

  // A ban may have been handed down while the ticket was in flight. The API
  // refuses a banned login, but the check is cheap and this is the last door.
  if (character.status === 'banned' || character.status === 'suspended') return null;

  const blocked = await database.db
    .select({ blockedId: blocks.blockedId })
    .from(blocks)
    .where(eq(blocks.blockerId, character.id));

  return {
    id: character.id,
    name: character.name,
    x: character.x,
    y: character.y,
    facing: character.facing as Direction,
    mutedUntilMs: character.mutedUntil?.getTime() ?? null,
    blocked: blocked.map((row) => row.blockedId),
  };
}

async function savePosition(character: {
  id: string;
  x: number;
  y: number;
  facing: Direction;
}): Promise<void> {
  await database.db
    .update(characters)
    .set({
      x: character.x,
      y: character.y,
      facing: character.facing,
      lastSeenAt: new Date(),
    })
    .where(eq(characters.id, character.id));
}

const server = new WorldServer({ host, port, world, resolveTicket, savePosition });
server.start();

/**
 * Listen for what the API decides.
 *
 * A mute, a kick or a block written to the database must take effect in the
 * middle of a conversation, not at next login — that is the moment it matters.
 * A command we cannot read is ignored rather than guessed at.
 */
const commands = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
await commands.subscribe(WORLD_COMMAND_CHANNEL);
commands.on('message', (_channel, raw) => {
  const command = decodeWorldCommand(raw);
  if (command === null) {
    console.warn('[world] ignored a command it could not read.');
    return;
  }

  switch (command.t) {
    case 'kick':
      server.kick(command.characterId, command.reason);
      return;
    case 'mute':
      server.mute(command.characterId, command.untilMs);
      return;
    case 'block':
      server.setBlock(command.blockerId, command.blockedId, command.blocked);
      return;
  }
});

console.warn(
  `[world] listening on ws://${host}:${port} — protocol v${PROTOCOL_VERSION}, ` +
    `${TICK_HZ} Hz, view radius ${VIEW_RADIUS_TILES} tiles, ` +
    `chat radius ${CHAT_RADIUS_TILES} tiles, ` +
    `map ${starterDistrict.width}x${starterDistrict.height} tiles.`,
);

async function shutdown(signal: string): Promise<void> {
  console.warn(`[world] ${signal} received, telling players goodbye.`);
  await server.stop();
  redis.disconnect();
  commands.disconnect();
  await database.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
