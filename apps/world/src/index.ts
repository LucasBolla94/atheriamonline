/**
 * Atheriam world server — the process that runs the live city.
 *
 * It keeps every player's position in memory and never writes a database row
 * per step. Durable saving is a separate, slower job that arrives in Phase 2.
 */
import { TICK_HZ, VIEW_RADIUS_TILES } from '@atheriam/shared';
import { PROTOCOL_VERSION } from '@atheriam/protocol';
import { starterDistrict } from './map.js';
import { World } from './world.js';
import { WorldServer } from './server.js';

const host = process.env['WORLD_HOST'] ?? '0.0.0.0';
const port = Number(process.env['WORLD_PORT'] ?? 3002);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`[world] WORLD_PORT is not a usable port: ${String(process.env['WORLD_PORT'])}`);
  process.exit(1);
}

const world = new World(starterDistrict);
const server = new WorldServer({ host, port, world });
server.start();

console.warn(
  `[world] listening on ws://${host}:${port} — protocol v${PROTOCOL_VERSION}, ` +
    `${TICK_HZ} Hz, view radius ${VIEW_RADIUS_TILES} tiles, ` +
    `map ${starterDistrict.width}x${starterDistrict.height} tiles.`,
);

async function shutdown(signal: string): Promise<void> {
  console.warn(`[world] ${signal} received, telling players goodbye.`);
  await server.stop();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
