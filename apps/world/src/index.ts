/**
 * Atheriam world server.
 *
 * This process is in charge of everything that happens live: where players are,
 * who can see whom, and what is said out loud. It keeps all of that in memory
 * and never writes a database row per movement step.
 *
 * The real server is built in Phase 1. For now this file only proves that the
 * process starts and that the shared constants are wired up correctly.
 */
import { TICK_HZ, TICK_MS, VIEW_RADIUS_TILES } from '@atheriam/shared';
import { PROTOCOL_VERSION } from '@atheriam/protocol';

function main(): void {
  console.warn(
    `[world] Atheriam world server — protocol v${PROTOCOL_VERSION}, ` +
      `${TICK_HZ} Hz (${TICK_MS} ms per tick), view radius ${VIEW_RADIUS_TILES} tiles.`,
  );
  console.warn('[world] Not listening yet. The WebSocket server arrives in Phase 1.');
}

main();
