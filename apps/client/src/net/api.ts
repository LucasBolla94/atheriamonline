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

/** One movement of money in or out of the purse. */
export interface PurseEntry {
  readonly amount: string;
  readonly display: string;
  readonly reason: string;
  readonly at: string;
}

export interface Purse {
  /** Minor units, as a string. Never a number: JSON cannot be trusted with money. */
  readonly amount: string;
  readonly display: string;
  readonly history: readonly PurseEntry[];
}

/** What is in your purse, and how it got there. */
export async function purse(): Promise<ApiResult<Purse>> {
  return request('/api/me/purse');
}

export interface InventoryItem {
  readonly id: string;
  readonly definitionId: string;
  readonly name: string;
  readonly kind: string;
  readonly description: string;
}

/** Everything you are carrying. */
export async function inventory(): Promise<ApiResult<{ items: InventoryItem[] }>> {
  return request('/api/me/inventory');
}

/** Collect today's reward. Asking twice in a day is not a second payment. */
export async function claimDailyReward(): Promise<
  ApiResult<{ claimed: boolean; display: string; purse: string }>
> {
  return request('/api/me/daily-reward', { method: 'POST' });
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

/** A trade, as one of the two people sees it. */
export interface TradeView {
  readonly id: string;
  readonly them: { id: string; name: string };
  readonly yourItems: Array<{ id: string; name: string }>;
  readonly theirItems: Array<{ id: string; name: string }>;
  readonly yourMoney: string;
  readonly theirMoney: string;
  readonly yourMoneyDisplay: string;
  readonly theirMoneyDisplay: string;
  readonly youConfirmed: boolean;
  readonly theyConfirmed: boolean;
  readonly status: string;
  readonly purse: string;
}

type TradeAnswer = ApiResult<{ trade: TradeView | null; completed?: boolean }>;

/** The trade you are in, or nothing. */
export async function currentTrade(): Promise<TradeAnswer> {
  return request('/api/trades/current');
}

/** Ask somebody to trade. */
export async function startTrade(name: string): Promise<TradeAnswer> {
  return request('/api/trades', { method: 'POST', body: JSON.stringify({ name }) });
}

/** Put one of your things on the table. */
export async function offerItem(tradeId: string, itemId: string): Promise<TradeAnswer> {
  return request(`/api/trades/${tradeId}/offer-item`, {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}

/** Take one of your things back. */
export async function withdrawItem(tradeId: string, itemId: string): Promise<TradeAnswer> {
  return request(`/api/trades/${tradeId}/withdraw-item`, {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}

/** Say how much money is on your side. A total, not a change. */
export async function offerMoney(tradeId: string, amount: string): Promise<TradeAnswer> {
  return request(`/api/trades/${tradeId}/money`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

/** "I am happy with this." */
export async function confirmTrade(tradeId: string): Promise<TradeAnswer> {
  return request(`/api/trades/${tradeId}/confirm`, { method: 'POST' });
}

/** Call the whole thing off. */
export async function cancelTrade(tradeId: string): Promise<TradeAnswer> {
  return request(`/api/trades/${tradeId}/cancel`, { method: 'POST' });
}

/** Ask for a ticket to open the WebSocket with. */
export async function worldTicket(): Promise<ApiResult<{ ticket: string }>> {
  return request('/api/world/ticket', { method: 'POST' });
}
