import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests.
 *
 * These start the real world server and the real client, then drive an actual
 * browser. They are slow compared with the Vitest suite, so they cover only
 * the things that cannot be proved any other way: that the page loads, that a
 * player can enter the city, and that the character moves when asked.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-landscape',
      use: { ...devices['Pixel 5 landscape'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @atheriam/world dev',
      port: 3002,
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @atheriam/client dev',
      port: 5173,
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
