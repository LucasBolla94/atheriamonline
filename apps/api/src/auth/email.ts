/**
 * Email addresses.
 *
 * We keep the spelling the person typed, and we compare on a lower-cased copy
 * so that "Aldric@example.com" and "aldric@example.com" are one account and
 * not two.
 */
import { z } from 'zod';

export const emailSchema = z.string().trim().min(3).max(254).email();

/** The form used for comparison and for the unique index in the database. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
