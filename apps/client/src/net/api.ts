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

export function setAppearance(appearance: number): Promise<ApiResult<{ appearance: number }>> {
  return request('/api/me/appearance', { method: 'POST', body: JSON.stringify({ appearance }) });
}

export interface CharacterSummary {
  readonly appearance?: number;
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
  readonly appearance?: number;
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

/** One piece of furniture standing in a house. */
export interface PlacedItem {
  readonly id: string;
  readonly definitionId: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

export interface HouseView {
  readonly id: string;
  readonly access: 'nobody' | 'welcomed' | 'everyone';
  readonly welcomed: string[];
  readonly contents: PlacedItem[];
  readonly yours: boolean;
}

/** Your own house, made the first time you ask for it. */
export async function myHouse(): Promise<ApiResult<HouseView>> {
  return request('/api/houses/mine');
}

/** What is in a house you are allowed into. */
export async function houseById(id: string): Promise<ApiResult<HouseView>> {
  return request(`/api/houses/${id}`);
}

/** Go home. */
export async function goHome(): Promise<ApiResult<{ id: string }>> {
  return request('/api/houses/mine/enter', { method: 'POST' });
}

/** Call on somebody. */
export async function visitHouse(name: string): Promise<ApiResult<{ id: string }>> {
  return request('/api/houses/visit', { method: 'POST', body: JSON.stringify({ name }) });
}

/** Back out into the street. */
export async function leaveHouse(): Promise<ApiResult<{ ok: true }>> {
  return request('/api/houses/leave', { method: 'POST' });
}

/** Change who may come in. */
export async function setHouseAccess(
  access: 'nobody' | 'welcomed' | 'everyone',
): Promise<ApiResult<{ access: string }>> {
  return request('/api/houses/mine/access', { method: 'POST', body: JSON.stringify({ access }) });
}

/** Welcome somebody in, or stop doing so. */
export async function welcomeToHouse(name: string): Promise<ApiResult<{ welcomed: string[] }>> {
  return request('/api/houses/mine/welcome', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function unwelcomeFromHouse(name: string): Promise<ApiResult<{ welcomed: string[] }>> {
  return request('/api/houses/mine/unwelcome', { method: 'POST', body: JSON.stringify({ name }) });
}

/** Put a piece of furniture down. It leaves your inventory. */
export async function placeFurniture(
  itemId: string,
  x: number,
  y: number,
  rotation: number,
): Promise<ApiResult<{ contents: PlacedItem[] }>> {
  return request('/api/houses/mine/place', {
    method: 'POST',
    body: JSON.stringify({ itemId, x, y, rotation }),
  });
}

/** Turn a piece of furniture on the spot. */
export async function rotateFurniture(
  itemId: string,
  rotation: number,
): Promise<ApiResult<{ contents: PlacedItem[] }>> {
  return request('/api/houses/mine/rotate', {
    method: 'POST',
    body: JSON.stringify({ itemId, rotation }),
  });
}

/** Pick a piece of furniture back up. */
export async function takeBackFurniture(
  itemId: string,
): Promise<ApiResult<{ contents: PlacedItem[] }>> {
  return request('/api/houses/mine/take-back', {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}

/**
 * "I have forgotten my password."
 *
 * The answer is the same whether or not the address is known — the server will
 * not say who has an account, and neither will this.
 */
export async function forgotPassword(email: string): Promise<ApiResult<{ ok: true }>> {
  return request('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
}

/** Choose a new password, using the token from the emailed link. */
export async function resetPassword(
  token: string,
  password: string,
): Promise<ApiResult<{ ok: true }>> {
  return request('/api/auth/reset', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

/** Ask for a ticket to open the WebSocket with. */
export async function worldTicket(): Promise<ApiResult<{ ticket: string }>> {
  return request('/api/world/ticket', { method: 'POST' });
}

export interface PropertyView {
  readonly id: string;
  readonly cityId: string;
  readonly buildingId: string;
  readonly municipal: boolean;
  readonly owned: boolean;
  readonly yours: boolean;
  readonly price: string;
  readonly priceDisplay: string;
  readonly businessName: string;
  readonly description: string;
  readonly access: HouseView['access'];
  readonly published: boolean;
  readonly floorStyle: 'oak' | 'stone' | 'tile';
  readonly wallStyle: 'cream' | 'teal' | 'rose';
  readonly address: import('@atheriam/shared').CityBuilding;
}

export type BusinessSettings = Pick<
  PropertyView,
  'businessName' | 'description' | 'access' | 'published' | 'floorStyle' | 'wallStyle'
>;

export function cityProperties(): Promise<ApiResult<{ properties: PropertyView[] }>> {
  return request('/api/city/properties');
}

export function buyProperty(
  id: string,
  requestKey: string,
): Promise<
  ApiResult<{
    property: PropertyView;
    receiptId: string;
    alreadyDone: boolean;
  }>
> {
  return request(`/api/properties/${id}/buy`, {
    method: 'POST',
    body: JSON.stringify({ requestKey }),
  });
}

export function configureBusiness(
  id: string,
  settings: BusinessSettings,
): Promise<ApiResult<{ property: PropertyView }>> {
  return request(`/api/properties/${id}/settings`, {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}
