// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '.e2e-client/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused variables are an error, but a leading underscore says
      // "I know, it is on purpose".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The economy must never use floating point money. Enforced by types,
      // but this catches the obvious mistake early.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Money is BIGINT minor units. Do not parse floats.' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Config files and tests may be looser.
    files: ['**/*.config.{js,ts}', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    /*
     * Tools run by hand from a terminal.
     *
     * They are plain Node scripts, not part of the game, so they use the
     * things a Node script uses: `process`, `fetch`, timers and `console`.
     * Printing is the entire point of a load test.
     */
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
);
