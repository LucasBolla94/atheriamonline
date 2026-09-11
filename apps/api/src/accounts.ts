/**
 * Creating and checking accounts.
 *
 * This is where the database, the password rules and the age gate meet. The
 * HTTP layer above it does no thinking of its own: it reads a request, calls
 * one of these functions, and turns the answer into a status code.
 */
import { eq } from 'drizzle-orm';
import { accounts, characters, type Account, type Character, type Database } from '@atheriam/db';
import { checkAge } from './auth/age.js';
import { normaliseEmail } from './auth/email.js';
import { checkPassword, hashPassword, verifyPassword } from './auth/password.js';

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  /** `YYYY-MM-DD`. */
  readonly dateOfBirth: string;
  readonly characterName: string;
  /** Where a brand new character is placed. */
  readonly spawn: { readonly x: number; readonly y: number };
}

export type RegisterFailure =
  | 'under-age'
  | 'bad-date-of-birth'
  | 'password-too-short'
  | 'password-too-long'
  | 'password-same-as-email'
  | 'email-taken'
  | 'name-taken';

export type RegisterResult =
  { ok: true; account: Account; character: Character } | { ok: false; reason: RegisterFailure };

export type LoginFailure = 'wrong-credentials' | 'suspended' | 'banned' | 'no-character';

export type LoginResult =
  { ok: true; account: Account; character: Character } | { ok: false; reason: LoginFailure };

export function normaliseName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Create an account and its character together.
 *
 * Both rows are written in one transaction. An account with no character is a
 * broken state that would let somebody log in and find nobody to play, so it
 * must not be possible to create one, even if the second insert fails.
 */
export async function register(db: Database, input: RegisterInput): Promise<RegisterResult> {
  const age = checkAge(input.dateOfBirth);
  if (!age.ok) {
    return { ok: false, reason: age.reason === 'under-age' ? 'under-age' : 'bad-date-of-birth' };
  }

  const passwordProblem = checkPassword(input.password, input.email);
  if (passwordProblem === 'too-short') return { ok: false, reason: 'password-too-short' };
  if (passwordProblem === 'too-long') return { ok: false, reason: 'password-too-long' };
  if (passwordProblem === 'same-as-email') return { ok: false, reason: 'password-same-as-email' };

  const emailNormalised = normaliseEmail(input.email);
  const nameNormalised = normaliseName(input.characterName);
  const passwordHash = await hashPassword(input.password);

  try {
    return await db.transaction(async (tx) => {
      const insertedAccounts = await tx
        .insert(accounts)
        .values({
          email: input.email.trim(),
          emailNormalised,
          passwordHash,
          dateOfBirth: input.dateOfBirth,
        })
        .returning();

      const account = insertedAccounts[0];
      if (account === undefined) throw new Error('The account row was not returned.');

      const insertedCharacters = await tx
        .insert(characters)
        .values({
          accountId: account.id,
          name: input.characterName.trim(),
          nameNormalised,
          x: input.spawn.x,
          y: input.spawn.y,
        })
        .returning();

      const character = insertedCharacters[0];
      if (character === undefined) throw new Error('The character row was not returned.');

      return { ok: true as const, account, character };
    });
  } catch (error: unknown) {
    // The database, not this code, is the thing that decides whether a name is
    // free: two people can register the same name at the same moment, and only
    // the unique index sees both.
    const constraint = uniqueConstraintOf(error);
    if (constraint === 'accounts_email_normalised_key') return { ok: false, reason: 'email-taken' };
    if (constraint === 'characters_name_normalised_key') return { ok: false, reason: 'name-taken' };
    throw error;
  }
}

/** Check an email and password, and find the character they belong to. */
export async function login(db: Database, email: string, password: string): Promise<LoginResult> {
  const emailNormalised = normaliseEmail(email);
  const found = await db
    .select()
    .from(accounts)
    .where(eq(accounts.emailNormalised, emailNormalised))
    .limit(1);

  const account = found[0];
  if (account === undefined) {
    // Spend roughly the same time as a real check would, so that the speed of
    // the answer does not reveal whether the email exists.
    await verifyPassword(DUMMY_HASH, password);
    return { ok: false, reason: 'wrong-credentials' };
  }

  const correct = await verifyPassword(account.passwordHash, password);
  if (!correct) return { ok: false, reason: 'wrong-credentials' };

  if (account.status === 'banned') return { ok: false, reason: 'banned' };
  if (account.status === 'suspended') return { ok: false, reason: 'suspended' };

  const ownedCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.accountId, account.id))
    .limit(1);

  const character = ownedCharacters[0];
  if (character === undefined) return { ok: false, reason: 'no-character' };

  await db.update(accounts).set({ lastLoginAt: new Date() }).where(eq(accounts.id, account.id));

  return { ok: true, account, character };
}

/** Look up the character belonging to an account. */
export async function characterOf(db: Database, accountId: string): Promise<Character | null> {
  const found = await db
    .select()
    .from(characters)
    .where(eq(characters.accountId, accountId))
    .limit(1);
  return found[0] ?? null;
}

/**
 * Write a character's position down.
 *
 * This is called on logout, on disconnect, and by a slow background job — never
 * once per step. See `docs/SPEC.md` section 7.
 */
export async function saveCharacterPosition(
  db: Database,
  characterId: string,
  position: { x: number; y: number; facing: Character['facing'] },
): Promise<void> {
  await db
    .update(characters)
    .set({ x: position.x, y: position.y, facing: position.facing, lastSeenAt: new Date() })
    .where(eq(characters.id, characterId));
}

/**
 * A real argon2id hash of a value nobody knows, used to burn the same amount
 * of time when the email does not exist.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Zm9yY2luZ2FkZWxheXZhbHVlbm90YXJlYWw';

/** The name of the unique index a database error was caused by, if any. */
function uniqueConstraintOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  if (candidate.code !== '23505') return null;
  const name = candidate.constraint_name ?? candidate.constraint;
  return typeof name === 'string' ? name : null;
}
