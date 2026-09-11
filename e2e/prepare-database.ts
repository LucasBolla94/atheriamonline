/**
 * Build the database the browser tests use, before anything else starts.
 *
 * Run by `pretest:e2e`. It is a separate step, and not part of Playwright's
 * own setup, because Playwright starts the servers first: a database dropped
 * after the API has connected to it produces a confusing error about a missing
 * table rather than a clear one about the order things happened in.
 */
import { prepareDatabase } from './global-setup.js';

await prepareDatabase();
console.warn('[e2e] the test database is ready.');
