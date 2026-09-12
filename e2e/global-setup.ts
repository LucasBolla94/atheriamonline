/**
 * Preparing a database for the browser tests.
 *
 * The browser tests run the real API, the real world server and the real
 * client. They get their own database and their own Redis database number, so
 * a test run can never touch the world you are playing in.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export const E2E_DATABASE_NAME = 'atheriam_e2e';
export const E2E_REDIS_DB = 14;

/**
 * Ports of their own.
 *
 * The live game runs on this machine too, on 3001 and 3002. Without separate
 * ports the browser tests either refuse to start or, worse, quietly drive the
 * real servers and make test accounts in the real city.
 */
export const E2E_API_PORT = 3101;
export const E2E_WORLD_PORT = 3102;
export const E2E_CLIENT_PORT = 5273;

/**
 * Where the browser tests read email from.
 *
 * Nothing is sent: the API appends each message to this file as JSON. It is
 * how a test can follow a password reset link without a mailbox, and the
 * reason the API refuses to use an outbox in production.
 */
export const E2E_OUTBOX = join(root, 'test-results', 'outbox.jsonl');

/**
 * Read `.env` without adding a dependency.
 *
 * Only `KEY=value` lines matter; anything else is a comment or blank.
 */
export function readEnvFile(): Record<string, string> {
  let contents: string;
  try {
    contents = readFileSync(join(root, '.env'), 'utf8');
  } catch {
    throw new Error(
      'There is no .env file. Copy .env.example to .env, then start the ' +
        'database with: docker compose -f infra/docker-compose.yml up -d',
    );
  }

  const values: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

export function e2eEnv(): Record<string, string> {
  const base = readEnvFile();

  const databaseUrl = new URL(base['DATABASE_URL'] ?? '');
  databaseUrl.pathname = `/${E2E_DATABASE_NAME}`;

  const redisUrl = new URL(base['REDIS_URL'] ?? 'redis://localhost:6379');
  redisUrl.pathname = `/${E2E_REDIS_DB}`;

  return {
    ...base,
    NODE_ENV: 'development',
    LOG_LEVEL: 'warn',
    DATABASE_URL: databaseUrl.toString(),
    REDIS_URL: redisUrl.toString(),
    API_PORT: String(E2E_API_PORT),
    WORLD_PORT: String(E2E_WORLD_PORT),
    PUBLIC_ORIGIN: `http://127.0.0.1:${E2E_CLIENT_PORT}`,
    // The browser has to be told where these are, or it would use the
    // development defaults and talk to whatever else is on this machine.
    VITE_API_URL: `http://127.0.0.1:${E2E_API_PORT}`,
    VITE_WORLD_URL: `ws://127.0.0.1:${E2E_WORLD_PORT}`,
    VITE_PORT: String(E2E_CLIENT_PORT),
    MAIL_OUTBOX: E2E_OUTBOX,
    // Every browser test comes from the same address and makes an account, so
    // the real limits would stop the suite rather than an attacker. The limits
    // themselves are tested directly in routes.integration.test.ts.
    GENERAL_RATE_LIMIT_PER_MINUTE: '10000',
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
  };
}

/**
 * Build the test database from nothing.
 *
 * This is run by `pretest:e2e`, **before** Playwright starts any servers.
 * That order matters: the API reads from the database as it starts, and it
 * used to start against a database that was about to be dropped from under it.
 */
export async function prepareDatabase(): Promise<void> {
  // A fresh outbox, so a test never reads an email from a previous run.
  mkdirSync(dirname(E2E_OUTBOX), { recursive: true });
  writeFileSync(E2E_OUTBOX, '');

  const base = readEnvFile();
  const adminUrl = base['DATABASE_URL'];
  if (adminUrl === undefined) {
    throw new Error('DATABASE_URL is missing from .env.');
  }

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${E2E_DATABASE_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${E2E_DATABASE_NAME}`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const target = e2eEnv()['DATABASE_URL'] ?? '';
  const sql = postgres(target, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: join(root, 'packages', 'db', 'migrations') });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Check the servers Playwright started are talking to a database that exists.
 *
 * Nothing is dropped here. By the time this runs the API is already connected,
 * and pulling the database out from under a running server is how you get an
 * error about a missing table instead of an error about the real problem.
 */
export default async function globalSetup(): Promise<void> {
  const target = e2eEnv()['DATABASE_URL'] ?? '';
  const sql = postgres(target, { max: 1, onnotice: () => {} });
  try {
    await sql`SELECT 1 FROM item_definitions LIMIT 1`;
  } catch {
    throw new Error(
      `The test database ${E2E_DATABASE_NAME} is not ready. ` +
        'Run `pnpm test:e2e`, which prepares it first, rather than calling ' +
        'playwright directly.',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
