import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every package keeps its tests next to the code it tests.
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['{apps,packages}/*/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
});
