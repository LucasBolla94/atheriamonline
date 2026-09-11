import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgres://atheriam:change-me-locally@localhost:5432/atheriam',
  },
  strict: true,
  verbose: true,
});
