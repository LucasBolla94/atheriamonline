/**
 * Apply any migrations the database has not seen yet.
 *
 * Run it with:  pnpm db:migrate
 *
 * It is safe to run twice: Drizzle keeps a record of what it has already
 * applied and skips those.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { connect, databaseUrl } from './client.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main(): Promise<void> {
  const url = databaseUrl();
  // Migrations must run one at a time, so a single connection is correct here.
  const handle = connect(url, 1);
  try {
    console.warn('[db] applying migrations…');
    await migrate(handle.db, { migrationsFolder });
    console.warn('[db] the database is up to date.');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('[db] migration failed:', error);
  process.exit(1);
});
