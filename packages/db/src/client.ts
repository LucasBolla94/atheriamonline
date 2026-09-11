/**
 * Opening a connection to PostgreSQL.
 *
 * The connection string comes from the environment and is never written down
 * in the repository — that is the "never commit secrets" rule, and this is
 * where it is easiest to break by accident.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  /** Close every connection. Call this when the process is shutting down. */
  readonly close: () => Promise<void>;
}

/** Read the connection string, and say something useful when it is missing. */
export function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill it in, then ' +
        'start the database with: docker compose -f infra/docker-compose.yml up -d',
    );
  }
  return url;
}

export function connect(url: string = databaseUrl(), maxConnections = 10): DatabaseHandle {
  const sql = postgres(url, { max: maxConnections, onnotice: () => {} });
  return {
    db: drizzle(sql, { schema }),
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
