/**
 * Creating the first moderator account.
 *
 * Run it with:  pnpm db:seed
 *
 * It does nothing unless you tell it who the moderator is, and it never
 * invents a password. A seed script with a default password in it is a way in
 * that nobody remembers leaving open.
 *
 *   SEED_MODERATOR_EMAIL=you@example.com \
 *   SEED_MODERATOR_PASSWORD='a long password you chose' \
 *   SEED_MODERATOR_NAME=Aldric \
 *   SEED_MODERATOR_DOB=1990-05-04 \
 *   pnpm db:seed
 */
import { eq } from 'drizzle-orm';
import { accounts, connect } from '@atheriam/db';
import { register } from './accounts.js';
import { normaliseEmail } from './auth/email.js';
import { DEFAULT_SPAWN } from './routes.js';

function required(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? null : value;
}

async function main(): Promise<void> {
  const email = required('SEED_MODERATOR_EMAIL');
  const password = required('SEED_MODERATOR_PASSWORD');
  const name = required('SEED_MODERATOR_NAME');
  const dateOfBirth = required('SEED_MODERATOR_DOB');

  if (email === null || password === null || name === null || dateOfBirth === null) {
    console.warn(
      'Nothing to seed.\n\n' +
        'To create the first moderator, set all four of these and run it again:\n' +
        '  SEED_MODERATOR_EMAIL     the email address to log in with\n' +
        '  SEED_MODERATOR_PASSWORD  a password you choose, at least 10 characters\n' +
        '  SEED_MODERATOR_NAME      the name to appear in the city\n' +
        '  SEED_MODERATOR_DOB       date of birth, as YYYY-MM-DD\n',
    );
    return;
  }

  const handle = connect();
  try {
    const existing = await handle.db
      .select()
      .from(accounts)
      .where(eq(accounts.emailNormalised, normaliseEmail(email)))
      .limit(1);

    if (existing[0] !== undefined) {
      // Running the seed twice must not change an account that already exists,
      // and must certainly not reset anybody's password.
      console.warn(`An account already exists for ${email}. Nothing was changed.`);
      return;
    }

    const result = await register(handle.db, {
      email,
      password,
      dateOfBirth,
      characterName: name,
      spawn: DEFAULT_SPAWN,
    });

    if (!result.ok) {
      console.error(`Could not create the account: ${result.reason}`);
      process.exitCode = 1;
      return;
    }

    await handle.db
      .update(accounts)
      .set({ isModerator: true })
      .where(eq(accounts.id, result.account.id));

    console.warn(`Created ${name} (${email}) as a moderator.`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
