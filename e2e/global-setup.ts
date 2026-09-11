/**
 * Preparing a database for the browser tests.
 *
 * The browser tests run the real API, the real world server and the real
 * client. They get their own database and their own Redis database number, so
 * a test run can never touch the world you are playing in.
 */
import { readFileSync } from 'node:fs';
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
    PUBLIC_ORIGIN: 'http://127.0.0.1:5173',
    // Every browser test comes from the same address and makes an account, so
    // the real limits would stop the suite rather than an attacker. The limits
    // themselves are tested directly in routes.integration.test.ts.
    GENERAL_RATE_LIMIT_PER_MINUTE: '10000',
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
  };
}

export default async function globalSetup(): Promise<void> {
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
