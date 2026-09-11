/**
 * Talking to the HTTP API.
 *
 * Every call sends the session cookie (`credentials: 'include'`) and every
 * call returns either the answer or a message a person can read. Nothing here
 * throws for an ordinary refusal: "that password is wrong" is a normal answer,
 * not an exception.
 */

/** Where the API lives. In production Caddy serves it under /api. */
function apiBase(): string {
  const fromEnv = import.meta.env['VITE_API_URL'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  if (import.meta.env.DEV) return `${window.location.protocol}//${window.location.hostname}:3001`;
  return window.location.origin;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; message: string };

export interface CharacterSummary {
  readonly name: string;
  readonly x?: number;
  readonly y?: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  // Only say "this is JSON" when we are actually sending some. A POST with no
  // body and a JSON content type is refused outright: the server is told to
  // expect JSON and then receives nothing.
  const headers =
    init.body === undefined
      ? init.headers
      : { 'Content-Type': 'application/json', ...init.headers };

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      credentials: 'include',
      ...(headers === undefined ? {} : { headers }),
    });
  } catch {
    return {
      ok: false,
      error: 'unreachable',
      message: 'Could not reach Atheriam. Please check your connection.',
    };
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = readString(body, 'error') ?? 'unknown';
    const message = readString(body, 'message') ?? 'Something went wrong. Please try again.';
    return { ok: false, error, message };
  }

  return { ok: true, data: body as T };
}

function readString(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly dateOfBirth: string;
  readonly characterName: string;
  readonly confirmsAdult: true;
}

export async function register(
  input: RegisterInput,
): Promise<ApiResult<{ character: CharacterSummary }>> {
  return request('/api/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

export async function logIn(
  email: string,
  password: string,
): Promise<ApiResult<{ character: CharacterSummary }>> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logOut(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
}

/** Who am I? Used when the page loads, to skip the login screen. */
export async function me(): Promise<ApiResult<{ character: CharacterSummary }>> {
  return request('/api/me');
}

/** "I do not want to hear from this person." Takes effect at once. */
export async function blockPlayer(name: string): Promise<ApiResult<{ ok: true }>> {
  return request('/api/players/block', { method: 'POST', body: JSON.stringify({ name }) });
}

/** Undo a block. */
export async function unblockPlayer(name: string): Promise<ApiResult<{ ok: true }>> {
  return request('/api/players/unblock', { method: 'POST', body: JSON.stringify({ name }) });
}

/** Who this player has blocked, by name. */
export async function blockedPlayers(): Promise<ApiResult<{ names: string[] }>> {
  return request('/api/players/blocked');
}

/** Report somebody to the moderators. Silences nobody by itself. */
export async function reportPlayer(name: string, reason: string): Promise<ApiResult<{ ok: true }>> {
  return request('/api/players/report', {
    method: 'POST',
    body: JSON.stringify({ name, reason }),
  });
}

/** Ask for a ticket to open the WebSocket with. */
export async function worldTicket(): Promise<ApiResult<{ ticket: string }>> {
  return request('/api/world/ticket', { method: 'POST' });
}
