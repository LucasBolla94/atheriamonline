import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { connect, type DatabaseHandle } from '@atheriam/db';
import { testDatabaseUrl } from '../../../test/integration-setup.js';
import { characterOf, login, register, saveCharacterPosition } from './accounts.js';

const handle: DatabaseHandle = connect(testDatabaseUrl(), 4);
const db = handle.db;

const SPAWN = { x: 20, y: 12 } as const;
const GOOD_PASSWORD = 'correct horse battery staple';
const ADULT_BIRTHDAY = '1990-05-04';

async function newAccount(suffix: string) {
  return register(db, {
    email: `player-${suffix}@example.com`,
    password: GOOD_PASSWORD,
    dateOfBirth: ADULT_BIRTHDAY,
    characterName: `Player${suffix}`,
    spawn: SPAWN,
  });
}

beforeEach(async () => {
  // `characters` goes first only for clarity; the foreign key cascades anyway.
  await db.execute(sql`TRUNCATE TABLE characters, accounts RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await handle.close();
});

describe('register', () => {
  it('creates an account and its character together', async () => {
    const result = await newAccount('aa');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.account.email).toBe('player-aa@example.com');
    expect(result.character.name).toBe('Playeraa');
    expect(result.character.x).toBe(SPAWN.x);
    expect(result.character.accountId).toBe(result.account.id);
  });

  it('never stores the password', async () => {
    const result = await newAccount('bb');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.passwordHash).not.toContain('correct horse');
    expect(result.account.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('refuses somebody under 18, and writes nothing', async () => {
    const result = await register(db, {
      email: 'child@example.com',
      password: GOOD_PASSWORD,
      dateOfBirth: '2020-01-01',
      characterName: 'Child',
      spawn: SPAWN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('under-age');

    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM accounts`);
    expect(rows[0]?.['n']).toBe(0);
  });

  it('refuses a second account with the same email, whatever the capitals', async () => {
    expect((await newAccount('cc')).ok).toBe(true);
    const second = await register(db, {
      email: 'PLAYER-CC@EXAMPLE.COM',
      password: GOOD_PASSWORD,
      dateOfBirth: ADULT_BIRTHDAY,
      characterName: 'SomebodyElse',
      spawn: SPAWN,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('email-taken');
  });

  it('refuses a character name somebody already has', async () => {
    expect((await newAccount('dd')).ok).toBe(true);
    const second = await register(db, {
      email: 'other@example.com',
      password: GOOD_PASSWORD,
      dateOfBirth: ADULT_BIRTHDAY,
      characterName: 'PLAYERDD',
      spawn: SPAWN,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('name-taken');
  });

  it('leaves no half-made account behind when the name is taken', async () => {
    expect((await newAccount('ee')).ok).toBe(true);
    await register(db, {
      email: 'leftover@example.com',
      password: GOOD_PASSWORD,
      dateOfBirth: ADULT_BIRTHDAY,
      characterName: 'Playeree',
      spawn: SPAWN,
    });

    // The second attempt failed on the character, so its account must have
    // been rolled back with it. An account with no character is a player who
    // can log in and find nobody to play.
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM accounts`);
    expect(rows[0]?.['n']).toBe(1);
  });

  it('lets two people register the same name at the same moment, and only one wins', async () => {
    // This is the case a check-then-insert would get wrong: both would look,
    // both would see the name free, and both would insert.
    const attempts = await Promise.allSettled([
      register(db, {
        email: 'race-a@example.com',
        password: GOOD_PASSWORD,
        dateOfBirth: ADULT_BIRTHDAY,
        characterName: 'Contested',
        spawn: SPAWN,
      }),
      register(db, {
        email: 'race-b@example.com',
        password: GOOD_PASSWORD,
        dateOfBirth: ADULT_BIRTHDAY,
        characterName: 'Contested',
        spawn: SPAWN,
      }),
    ]);

    const succeeded = attempts.filter((a) => a.status === 'fulfilled' && a.value.ok).length;
    expect(succeeded).toBe(1);

    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM characters`);
    expect(rows[0]?.['n']).toBe(1);
  });
});

describe('login', () => {
  it('accepts the right password and finds the character', async () => {
    await newAccount('ff');
    const result = await login(db, 'player-ff@example.com', GOOD_PASSWORD);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.character.name).toBe('Playerff');
  });

  it('ignores the capitals in the email', async () => {
    await newAccount('gg');
    expect((await login(db, ' PLAYER-GG@EXAMPLE.COM ', GOOD_PASSWORD)).ok).toBe(true);
  });

  it('refuses the wrong password', async () => {
    await newAccount('hh');
    const result = await login(db, 'player-hh@example.com', 'not the password');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong-credentials');
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    const unknown = await login(db, 'nobody@example.com', GOOD_PASSWORD);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe('wrong-credentials');
  });

  it('refuses a banned account even with the right password', async () => {
    const created = await newAccount('ii');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await db.execute(sql`UPDATE accounts SET status = 'banned' WHERE id = ${created.account.id}`);

    const result = await login(db, 'player-ii@example.com', GOOD_PASSWORD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('banned');
  });

  it('records when somebody last logged in', async () => {
    const created = await newAccount('jj');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.account.lastLoginAt).toBeNull();

    await login(db, 'player-jj@example.com', GOOD_PASSWORD);

    const rows = await db.execute(
      sql`SELECT last_login_at FROM accounts WHERE id = ${created.account.id}`,
    );
    expect(rows[0]?.['last_login_at']).not.toBeNull();
  });
});

describe('saving where a character is', () => {
  it('writes the position down', async () => {
    const created = await newAccount('kk');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await saveCharacterPosition(db, created.character.id, { x: 33, y: 7, facing: 'ne' });

    const character = await characterOf(db, created.account.id);
    expect(character).toMatchObject({ x: 33, y: 7, facing: 'ne' });
  });

  it('remembers it across a reconnection', async () => {
    const created = await newAccount('ll');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await saveCharacterPosition(db, created.character.id, { x: 5, y: 5, facing: 'w' });
    const again = await login(db, 'player-ll@example.com', GOOD_PASSWORD);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.character).toMatchObject({ x: 5, y: 5, facing: 'w' });
  });
});
