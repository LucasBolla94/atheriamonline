/**
 * Preparing a real database for the integration tests.
 *
 * These tests talk to a real PostgreSQL and a real Redis, because the things
 * they check — a unique index catching two people registering at once, a
 * transaction rolling back, a ticket that can only be spent once — do not
 * exist in a fake.
 *
 * They use their own database (`atheriam_test`) and their own Redis database
 * number, so running them can never touch the data you are playing with.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const migrationsFolder = join(root, 'packages', 'db', 'migrations');

/**
 * Read `.env`, the way the browser tests already do.
 *
 * Without this, `pnpm test:integration` fails with "DATABASE_URL is not set"
 * unless the person running it happens to have exported the settings into
 * their shell first — which is a thing to remember, and therefore a thing to
 * forget. The environment still wins, so CI can point these somewhere else.
 */
function settingFromEnvFile(name: string): string | undefined {
  let contents: string;
  try {
    contents = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    return undefined;
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    if (trimmed.slice(0, separator).trim() !== name) continue;
    return trimmed.slice(separator + 1).trim();
  }
  return undefined;
}

/** The name of the database the tests are allowed to destroy. */
export const TEST_DATABASE_NAME = 'atheriam_test';

/** The Redis database number the tests are allowed to wipe. */
export const TEST_REDIS_DB = 15;

function baseUrl(): string {
  const url = process.env['DATABASE_URL'] ?? settingFromEnvFile('DATABASE_URL');
  if (url === undefined || url.length === 0) {
    throw new Error(
      'DATABASE_URL is not set, and there is no .env file with it in.\n' +
        'Copy .env.example to .env, then start the database:\n' +
        '  docker compose -f infra/docker-compose.yml up -d',
    );
  }
  return url;
}

export function testDatabaseUrl(): string {
  const url = new URL(baseUrl());
  url.pathname = `/${TEST_DATABASE_NAME}`;
  return url.toString();
}

export function testRedisUrl(): string {
  const url = new URL(
    process.env['REDIS_URL'] ?? settingFromEnvFile('REDIS_URL') ?? 'redis://localhost:6379',
  );
  url.pathname = `/${TEST_REDIS_DB}`;
  return url.toString();
}

export async function setup(): Promise<void> {
  const admin = postgres(baseUrl(), { max: 1, onnotice: () => {} });
  try {
    // Start from nothing every run, so a test can never pass because of a row
    // some earlier run left behind.
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DATABASE_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DATABASE_NAME}`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
