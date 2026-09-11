/**
 * Talking, in a real browser.
 *
 * Two pages, two accounts, one city. These prove the parts that only a browser
 * can prove: that what one person types reaches the other person's screen, that
 * a block takes it away again, and that a report reaches a moderator's queue.
 */
import { expect, test, type Page } from '@playwright/test';

function unique(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`;
}

const PASSWORD = 'correct horse battery staple';
const ADULT_BIRTHDAY = '1990-05-04';

async function createAccountAndEnter(page: Page): Promise<string> {
  const name = unique('Talker');

  await page.goto('/');
  await page.getByRole('tab', { name: 'Create an account' }).click();
  await page.getByLabel('Email address').fill(`${name.toLowerCase()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill(ADULT_BIRTHDAY);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  await expect(page.locator('.hud')).toContainText(name);
  return name;
}

async function say(page: Page, text: string): Promise<void> {
  await page.getByLabel('Say something').fill(text);
  await page.getByRole('button', { name: 'Say' }).click();
}

test('what you say appears in your own chat', async ({ page }) => {
  await createAccountAndEnter(page);
  await say(page, 'Good evening, Atheriam.');
  await expect(page.locator('.chat__log')).toContainText('Good evening, Atheriam.');
});

test('two players standing together hear each other', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    const speaker = await createAccountAndEnter(first);
    await createAccountAndEnter(second);

    // Both start on the Crown Square, well within earshot.
    await say(first, 'Is anybody about?');

    await expect(second.locator('.chat__log')).toContainText('Is anybody about?');
    await expect(second.locator('.chat__log')).toContainText(speaker);
  } finally {
    await first.close();
    await second.close();
  }
});

test('blocking somebody stops their words arriving', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    const speaker = await createAccountAndEnter(first);
    await createAccountAndEnter(second);

    await say(first, 'before the block');
    await expect(second.locator('.chat__log')).toContainText('before the block');

    // Clicking a name opens what you can do about that person.
    await second.getByRole('button', { name: speaker }).first().click();
    await second.getByRole('button', { name: 'Stop hearing this person' }).click();
    await expect(second.locator('.chat__notice')).toContainText('no longer hear');

    await say(first, 'after the block');
    await second.waitForTimeout(1000);
    await expect(second.locator('.chat__log')).not.toContainText('after the block');
  } finally {
    await first.close();
    await second.close();
  }
});

test('a report can be sent and says thank you', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    const speaker = await createAccountAndEnter(first);
    await createAccountAndEnter(second);

    await say(first, 'something worth reporting');
    await expect(second.locator('.chat__log')).toContainText('something worth reporting');

    await second.getByRole('button', { name: speaker }).first().click();
    await second.getByRole('button', { name: 'Report them to a moderator' }).click();
    await second.getByLabel('What happened?').fill('Shouted at me in the square.');
    await second.getByRole('button', { name: 'Send the report' }).click();

    await expect(second.locator('.chat__notice')).toContainText('moderator will read this');
  } finally {
    await first.close();
    await second.close();
  }
});

test('pressing Enter opens the chat box', async ({ page }) => {
  await createAccountAndEnter(page);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Say something')).toBeFocused();
});
