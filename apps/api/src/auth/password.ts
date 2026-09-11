/**
 * Passwords.
 *
 * Hashing is argon2id (see D-004). A password is never stored, never logged,
 * and never sent back to anyone — including to the person who owns it.
 */
import argon2 from 'argon2';

/**
 * Long enough to be worth having, short enough that a password manager's
 * output still fits. Length matters far more than which characters are in it,
 * so there is no rule demanding a capital letter and a symbol: those rules
 * push people towards "Password1!" and nothing better.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Settings for argon2id. Higher numbers are safer and slower; these are the
 * current OWASP suggestion and take roughly 50 ms on a small server.
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export type PasswordProblem = 'too-short' | 'too-long' | 'same-as-email';

/** Check a password before we bother hashing it. */
export function checkPassword(password: string, email: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too-short';
  if (password.length > MAX_PASSWORD_LENGTH) return 'too-long';
  if (password.toLowerCase() === email.toLowerCase()) return 'same-as-email';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

/**
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing when the stored value is not a hash we
 * understand — a corrupt row must not become a way in.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
