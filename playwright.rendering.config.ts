import { defineConfig } from '@playwright/test';

/** Real engine rendering without accounts, databases or a running game server. */
export default defineConfig({
  testDir: './e2e-rendering',
  workers: 1,
  timeout: 60_000,
  use: {
    viewport: { width: 800, height: 600 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});
