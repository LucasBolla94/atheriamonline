/**
 * Build the database the browser tests use, before anything else starts.
 *
 * Run by `pretest:e2e`. It is a separate step, and not part of Playwright's
 * own setup, because Playwright starts the servers first: a database dropped
 * after the API has connected to it produces a confusing error about a missing
 * table rather than a clear one about the order things happened in.
 */
import { spawnSync } from 'node:child_process';
import { e2eEnv, prepareDatabase } from './global-setup.js';

// Workspace imports resolve built exports. Never test yesterday's protocol or
// schema after editing shared source files.
const packages = spawnSync(
  'pnpm',
  ['--filter', './packages/**', '--workspace-concurrency=1', 'build'],
  { stdio: 'inherit' },
);
if (packages.status !== 0) process.exit(packages.status ?? 1);

await prepareDatabase();
console.warn('[e2e] the test database is ready.');

// Build before Playwright starts API/world/browser processes: their combined
// memory plus Vite's compiler exceeds this small host's available RAM.
const client = spawnSync(
  'pnpm',
  [
    '--filter',
    '@atheriam/client',
    'exec',
    'vite',
    'build',
    '--outDir',
    '../../.e2e-client',
    '--emptyOutDir',
  ],
  { env: { ...process.env, ...e2eEnv(), NODE_ENV: 'production' }, stdio: 'inherit' },
);
if (client.status !== 0) process.exit(client.status ?? 1);
