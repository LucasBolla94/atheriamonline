/**
 * The db package: the Drizzle schema, the migrations and the seed data.
 *
 * Nothing outside this package writes SQL. Everything else asks this package.
 */
export * from './schema.js';
export * from './client.js';

/** Bumped by hand when a migration changes the shape of the database. */
export const SCHEMA_VERSION = 1;
