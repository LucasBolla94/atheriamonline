import { defineConfig } from 'vitest/config';

/**
 * The integration tests.
 *
 * They need PostgreSQL and Redis running:
 *   docker compose -f infra/docker-compose.yml up -d
 *
 * They are kept apart from `pnpm test` on purpose. The unit tests must run
 * anywhere, instantly, with nothing installed; these prove the things that
 * only a real database can prove.
 */
export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.integration.test.ts'],
    environment: 'node',
    globalSetup: ['./test/integration-setup.ts'],
    // One database, so tests that create accounts must not race each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
