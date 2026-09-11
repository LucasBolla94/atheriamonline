import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every package keeps its tests next to the code it tests.
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    // Integration tests need a real PostgreSQL and Redis, so they have their
    // own command: `pnpm test:integration`. `pnpm test` must run anywhere,
    // instantly, with nothing installed.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['{apps,packages}/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.integration.test.ts'],
    },
  },
});
