/**
 * Turning bytes on a socket into messages we are willing to act on.
 *
 * Nothing here throws. A hostile client is normal traffic, not an exception,
 * so every failure comes back as a value the caller has to look at.
 */
import { clientMessageSchema, serverMessageSchema } from './messages.js';
import type { ClientMessage, ServerMessage } from './messages.js';

/** Either a message we trust, or the reason we do not. */
export type Decoded<T> = { ok: true; message: T } | { ok: false; error: string };

/**
 * The largest message we will even try to parse, in bytes. A client that sends
 * more than this is not playing the game, so we do not spend memory on it.
 */
export const MAX_MESSAGE_BYTES = 8 * 1024;

function parseJson(raw: string): Decoded<unknown> {
  if (raw.length > MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'message too large' };
  }
  try {
    return { ok: true, message: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
}

/** Read something a client sent us. Used by the world server. */
export function decodeClientMessage(raw: string): Decoded<ClientMessage> {
  const json = parseJson(raw);
  if (!json.ok) return json;

  const parsed = clientMessageSchema.safeParse(json.message);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid message' };
  }
  return { ok: true, message: parsed.data };
}

/**
 * Read something the server sent us. Used by the browser.
 *
 * We validate our own server's messages too. It costs almost nothing and it
 * means a client left open across a deployment fails loudly instead of
 * rendering nonsense.
 */
export function decodeServerMessage(raw: string): Decoded<ServerMessage> {
  const json = parseJson(raw);
  if (!json.ok) return json;

  const parsed = serverMessageSchema.safeParse(json.message);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid message' };
  }
  return { ok: true, message: parsed.data };
}

/** Write a message for the wire. */
export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
