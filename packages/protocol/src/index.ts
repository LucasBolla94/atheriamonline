/**
 * The protocol package holds every message that travels between the browser
 * and the servers, together with its zod schema.
 *
 * Rule from `docs/SPEC.md`: the client sends **intents**, the server sends
 * **state**. There is no message where the client tells the server what
 * happened.
 *
 * Filled in during Phase 1.
 */

/** Bumped whenever a message shape changes in a way old clients cannot read. */
export const PROTOCOL_VERSION = 1;
