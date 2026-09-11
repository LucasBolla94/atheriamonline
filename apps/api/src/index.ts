/**
 * Atheriam HTTP API.
 *
 * This process owns everything that must survive a restart and must never be
 * half-done: accounts, and later money and items. Every operation that touches
 * two rows happens in one database transaction.
 */
import { Redis } from 'ioredis';
import { connect } from '@atheriam/db';
import { readConfig } from './config.js';
import { buildServer } from './server.js';

const config = readConfig();
const database = connect(config.databaseUrl);
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

const app = await buildServer({ config, db: database.db, redis });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  app.log.error(error, 'The API could not start.');
  await shutdown();
  process.exit(1);
}

async function shutdown(): Promise<void> {
  await app.close();
  redis.disconnect();
  await database.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      app.log.info(`${signal} received, shutting down.`);
      await shutdown();
      process.exit(0);
    })();
  });
}
