import { defineConfig, devices } from '@playwright/test';

/**
 * The smoke test for the live site.
 *
 * This one does not start any servers: it drives a real browser against
 * https://atheriam.online exactly as a player would, over the real
 * certificate, through Caddy, into the real database.
 *
 *   pnpm test:live
 *
 * It creates one throwaway account each run and says so in its name, so the
 * accounts it leaves behind are obvious.
 */
export default defineConfig({
  testDir: './e2e-live',
  testMatch: '**/*.spec.ts',
  // Long, because making an account can have to wait out the live site's
  // registration rate limit — which is a real limit doing its job, not a
  // problem to be configured away.
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env['ATHERIAM_URL'] ?? 'https://atheriam.online',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-landscape', use: { ...devices['Pixel 5 landscape'] } },
  ],
});
