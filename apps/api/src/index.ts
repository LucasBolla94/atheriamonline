/**
 * Atheriam HTTP API.
 *
 * This process owns everything that must survive a restart and must never be
 * half-done: accounts, money and items. Every economic operation here happens
 * in one database transaction and carries an idempotency key.
 *
 * The real server is built in Phase 2. For now this file only proves that the
 * process starts and that the workspace packages are wired up correctly.
 */
import { CURRENCY_NAME, MINOR_UNITS_PER_CROWN } from '@atheriam/economy';
import { SCHEMA_VERSION } from '@atheriam/db';
import { PROTOCOL_VERSION } from '@atheriam/protocol';

function main(): void {
  console.warn(
    `[api] Atheriam API — protocol v${PROTOCOL_VERSION}, schema v${SCHEMA_VERSION}, ` +
      `currency ${CURRENCY_NAME} (${MINOR_UNITS_PER_CROWN} minor units each).`,
  );
  console.warn('[api] Not listening yet. Fastify and the database arrive in Phase 2.');
}

main();
