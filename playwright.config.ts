import { defineConfig, devices } from '@playwright/test';
import { E2E_API_PORT, E2E_CLIENT_PORT, E2E_WORLD_PORT, e2eEnv } from './e2e/global-setup.js';

/**
 * Browser tests.
 *
 * These start the real API, the real world server and the real client, then
 * drive an actual browser. They are slow compared with the Vitest suite, so
 * they cover only what cannot be proved any other way: that a person can make
 * an account, enter the city, and walk.
 *
 * They need PostgreSQL and Redis running:
 *   docker compose -f infra/docker-compose.yml up -d
 */
const env = e2eEnv();

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: `http://127.0.0.1:${E2E_CLIENT_PORT}`,
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-landscape', use: { ...devices['Pixel 5 landscape'] } },
  ],

  webServer: [
    {
      command: 'pnpm --filter @atheriam/api dev',
      port: E2E_API_PORT,
      env,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @atheriam/world dev',
      port: E2E_WORLD_PORT,
      env,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @atheriam/client dev',
      port: E2E_CLIENT_PORT,
      env,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
