/**
 * Forgetting a password, in a real browser.
 *
 * This is the whole loop: ask for a link, read the email the server actually
 * sent, open it, choose a new password, and log in with it. The email is read
 * from the outbox file — nothing is sent anywhere.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { E2E_OUTBOX } from './global-setup.js';

function unique(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`;
}

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a completely different password';

interface NewPlayer {
  readonly name: string;
  readonly email: string;
}

async function createAccount(page: Page): Promise<NewPlayer> {
  const name = unique('Forgot');
  const email = `${name.toLowerCase()}@example.com`;

  await page.goto('/play/');
  await page.getByRole('tab', { name: 'Create an account' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('1990-05-04');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toContainText(name);

  return { name, email };
}

/** The reset link the server sent to this address, from the outbox file. */
function linkSentTo(email: string): string {
  const messages = readFileSync(E2E_OUTBOX, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { to: string; text: string })
    .filter((message) => message.to.toLowerCase() === email.toLowerCase());

  const last = messages[messages.length - 1];
  if (last === undefined) throw new Error(`No email was sent to ${email}.`);

  const found = /(https?:\/\/\S+\?reset=[A-Za-z0-9_-]+)/.exec(last.text);
  if (found?.[1] === undefined) throw new Error(`No link in the email: ${last.text}`);
  return found[1];
}

test('somebody who forgets their password can get back in', async ({ page }) => {
  const player = await createAccount(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('tab', { name: 'Log in' })).toBeVisible();

  // Ask for the link.
  await page.getByRole('button', { name: 'I have forgotten my password' }).click();
  await expect(page.getByRole('heading', { name: 'Choosing a new password' })).toBeVisible();
  await page.getByLabel('Email address').fill(player.email);
  await page.getByRole('button', { name: 'Send me a link' }).click();
  await expect(page.getByRole('status')).toContainText('a link is on its way');

  // Open it, exactly as a person would from their mailbox. The link points at
  // the real site, so only its query is taken.
  const link = new URL(linkSentTo(player.email));
  await page.goto(`/${link.search}`);

  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByLabel('Type it again').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save my new password' }).click();

  await expect(page.getByRole('status')).toContainText('password is changed');

  // The new one works.
  await page.getByLabel('Email address').fill(player.email);
  await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Enter the city' }).click();
  await expect(page.locator('.hud')).toContainText(player.name);
});

test('the old password stops working once it has been changed', async ({ page }) => {
  const player = await createAccount(page);
  await page.getByRole('button', { name: 'Log out' }).click();

  await page.getByRole('button', { name: 'I have forgotten my password' }).click();
  await page.getByLabel('Email address').fill(player.email);
  await page.getByRole('button', { name: 'Send me a link' }).click();
  await expect(page.getByRole('status')).toBeVisible();

  const link = new URL(linkSentTo(player.email));
  await page.goto(`/${link.search}`);
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByLabel('Type it again').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save my new password' }).click();
  await expect(page.getByRole('status')).toBeVisible();

  await page.getByLabel('Email address').fill(player.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Enter the city' }).click();

  await expect(page.getByRole('alert')).toContainText('do not match');
});

test('two different passwords are refused before anything is sent', async ({ page }) => {
  const player = await createAccount(page);
  await page.getByRole('button', { name: 'Log out' }).click();

  await page.getByRole('button', { name: 'I have forgotten my password' }).click();
  await page.getByLabel('Email address').fill(player.email);
  await page.getByRole('button', { name: 'Send me a link' }).click();
  await expect(page.getByRole('status')).toBeVisible();

  const link = new URL(linkSentTo(player.email));
  await page.goto(`/${link.search}`);
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByLabel('Type it again').fill('something else entirely');
  await page.getByRole('button', { name: 'Save my new password' }).click();

  await expect(page.getByRole('alert')).toContainText('do not match');
});

test('a link that has already been used says so plainly', async ({ page }) => {
  const player = await createAccount(page);
  await page.getByRole('button', { name: 'Log out' }).click();

  await page.getByRole('button', { name: 'I have forgotten my password' }).click();
  await page.getByLabel('Email address').fill(player.email);
  await page.getByRole('button', { name: 'Send me a link' }).click();
  await expect(page.getByRole('status')).toBeVisible();

  const link = new URL(linkSentTo(player.email));
  await page.goto(`/${link.search}`);
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByLabel('Type it again').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save my new password' }).click();
  await expect(page.getByRole('status')).toBeVisible();

  // Somebody opens the same link again — from their history, or because the
  // email was forwarded.
  await page.goto(`/${link.search}`);
  await page.getByLabel('New password').fill('one more password again');
  await page.getByLabel('Type it again').fill('one more password again');
  await page.getByRole('button', { name: 'Save my new password' }).click();

  await expect(page.getByRole('alert')).toContainText('already been used');
});

test('the way in is offered on the login form, not hidden', async ({ page }) => {
  await page.goto('/play/');
  await expect(page.getByRole('button', { name: 'I have forgotten my password' })).toBeVisible();
});
