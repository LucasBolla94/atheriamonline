/**
 * What a player may say, and how often.
 *
 * Two separate jobs live here, both pure so they can be tested without a
 * socket:
 *
 *  - cleaning the text. Whatever arrives is somebody's typing, and some of it
 *    is an attempt to fake a system message or to break another player's
 *    screen. It is trimmed, flattened to a single line, and stripped of the
 *    invisible characters used to spoof names and to reverse a line.
 *  - the rate limit. A bucket of tokens, not a flat delay: a person may say
 *    three things quickly and then has to slow down, which is how conversation
 *    actually works. A flat delay would make ordinary talk feel broken while
 *    barely inconveniencing a script.
 */
import { CHAT_BURST, CHAT_TOKEN_REFILL_MS, MAX_CHAT_LENGTH } from '@atheriam/shared';

/**
 * Ranges of characters that are invisible, or that reorder the text around
 * them: control codes, the soft hyphen, the zero-width spaces, the
 * bidirectional overrides and the byte order mark.
 *
 * They are written as numbers rather than as a regular expression because a
 * regular expression full of escapes is unreadable, and this list is something
 * a person should be able to check.
 */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], // C0 control codes, including newlines and tabs
  [0x007f, 0x009f], // delete, and the C1 control codes
  [0x00ad, 0x00ad], // soft hyphen
  [0x200b, 0x200f], // zero-width spaces and the first bidi marks
  [0x202a, 0x202e], // bidi embedding and override
  [0x2060, 0x206f], // word joiner and the invisible maths operators
  [0xfeff, 0xfeff], // byte order mark
];

function isInvisible(codePoint: number): boolean {
  return INVISIBLE_RANGES.some(([first, last]) => codePoint >= first && codePoint <= last);
}

/**
 * Tidy up what somebody typed.
 *
 * Invisible characters become spaces rather than being deleted: deleting them
 * would glue two halves of a word into a word nobody wrote, which is exactly
 * what somebody hiding a banned word is counting on.
 *
 * Returns `null` when nothing usable is left — a message of only spaces is not
 * a message.
 */
export function cleanChatText(raw: string): string | null {
  let visible = '';
  for (const character of raw) {
    visible += isInvisible(character.codePointAt(0) ?? 0) ? ' ' : character;
  }

  const flattened = visible.replace(/\s+/gu, ' ').trim();
  if (flattened.length === 0) return null;
  return flattened.slice(0, MAX_CHAT_LENGTH);
}

/** How many messages a player has left, and when that was last worked out. */
export interface ChatAllowance {
  tokens: number;
  lastRefillMs: number;
}

/** A player who has just arrived may speak immediately. */
export function newChatAllowance(nowMs: number): ChatAllowance {
  return { tokens: CHAT_BURST, lastRefillMs: nowMs };
}

/**
 * Take one token if there is one, refilling first.
 *
 * Returns false when the player is talking too fast. The caller turns that
 * into a refusal; nothing is thrown, because a flood is ordinary traffic and
 * not an exception.
 */
export function takeChatToken(allowance: ChatAllowance, nowMs: number): boolean {
  const elapsed = Math.max(0, nowMs - allowance.lastRefillMs);
  const earned = Math.floor(elapsed / CHAT_TOKEN_REFILL_MS);

  if (earned > 0) {
    allowance.tokens = Math.min(CHAT_BURST, allowance.tokens + earned);
    allowance.lastRefillMs += earned * CHAT_TOKEN_REFILL_MS;
  }

  // A full bucket does not need to remember an old refill time. Without this,
  // an hour of silence would be banked and spent all at once.
  if (allowance.tokens >= CHAT_BURST) allowance.lastRefillMs = nowMs;

  if (allowance.tokens <= 0) return false;
  allowance.tokens -= 1;
  return true;
}
