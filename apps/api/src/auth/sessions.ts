/**
 * Sessions and world tickets, both kept in Redis.
 *
 * A **session** says "this browser is logged in as this account". It lives in
 * an HttpOnly cookie, so JavaScript on the page cannot read it.
 *
 * A **ticket** is a single-use, short-lived string used to open the WebSocket.
 * The session cookie is deliberately never used for that: a WebSocket
 * handshake is not protected the way a normal request is, and a ticket that
 * dies in thirty seconds and can only be used once is far less useful to
 * anyone who steals it.
 */
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/** How long a login lasts without being used. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** How long a world ticket is valid. Long enough to connect, no longer. */
export const TICKET_TTL_SECONDS = 30;

export interface SessionData {
  readonly accountId: string;
  readonly characterId: string;
}

export interface TicketData {
  readonly accountId: string;
  readonly characterId: string;
  readonly characterName: string;
}

/**
 * A random, unguessable string.
 *
 * 32 bytes of randomness from the operating system. Not a counter, not a
 * timestamp, not a UUID v4 built from a weak generator.
 */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function sessionKey(token: string): string {
  return `session:${token}`;
}

function ticketKey(token: string): string {
  return `ticket:${token}`;
}

export class SessionStore {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /** Log somebody in. Returns the token to put in the cookie. */
  async create(data: SessionData): Promise<string> {
    const token = newToken();
    await this.redis.set(sessionKey(token), JSON.stringify(data), 'EX', SESSION_TTL_SECONDS);
    return token;
  }

  /**
   * Look up a session and push its expiry back, so an active player is not
   * logged out in the middle of playing.
   */
  async read(token: string): Promise<SessionData | null> {
    if (token.length === 0) return null;
    const raw = await this.redis.get(sessionKey(token));
    if (raw === null) return null;

    const data = parse<SessionData>(raw);
    if (data === null) return null;

    await this.redis.expire(sessionKey(token), SESSION_TTL_SECONDS);
    return data;
  }

  /** Log somebody out. Safe to call with a token that is already gone. */
  async destroy(token: string): Promise<void> {
    if (token.length === 0) return;
    await this.redis.del(sessionKey(token));
  }

  /** Issue a ticket for opening the WebSocket. */
  async issueTicket(data: TicketData): Promise<string> {
    const token = newToken();
    await this.redis.set(ticketKey(token), JSON.stringify(data), 'EX', TICKET_TTL_SECONDS);
    return token;
  }

  /**
   * Spend a ticket. It works exactly once: reading it also deletes it, in a
   * single Redis command, so two connections racing on the same stolen ticket
   * cannot both win.
   */
  async spendTicket(token: string): Promise<TicketData | null> {
    if (token.length === 0) return null;
    const raw = await this.redis.getdel(ticketKey(token));
    if (raw === null) return null;
    return parse<TicketData>(raw);
  }
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A value we cannot read is treated as no value at all, never as a
    // half-understood session.
    return null;
  }
}
