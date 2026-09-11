/**
 * Trading, in two real browsers.
 *
 * The point of these is the thing no unit test can show: that what one person
 * does appears on the other person's screen, without either of them refreshing
 * anything, and that the swap really happens.
 */
import { expect, test, type Page } from '@playwright/test';

function unique(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`;
}

const PASSWORD = 'correct horse battery staple';

async function createAccountAndEnter(page: Page): Promise<string> {
  const name = unique('Trader');
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create an account' }).click();
  await page.getByLabel('Email address').fill(`${name.toLowerCase()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Your name in the city').fill(name);
  await page.getByLabel('Date of birth').fill('1990-05-04');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.locator('.hud')).toContainText(name);
  return name;
}

/** Say something, so that the other person has a name to click on. */
async function say(page: Page, text: string): Promise<void> {
  await page.getByLabel('Say something').fill(text);
  await page.getByRole('button', { name: 'Say' }).click();
}

test('two people can swap a thing for a thing', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    const one = await createAccountAndEnter(first);
    await createAccountAndEnter(second);

    // The second player clicks the first one's name in the chat.
    await say(first, 'Anybody want to trade?');
    await expect(second.locator('.chat__log')).toContainText('Anybody want to trade?');
    await second.getByRole('button', { name: one }).first().click();
    await second.getByRole('button', { name: 'Offer to trade' }).click();

    // Both windows open, without either page being reloaded.
    await expect(second.getByRole('dialog')).toContainText('Trading with');
    await expect(first.getByRole('dialog')).toContainText('Trading with');

    // Each puts something on the table.
    await second
      .getByRole('button', { name: /Oak stool.*put on the table/ })
      .first()
      .click();
    await expect(first.getByRole('dialog')).toContainText('Oak stool');

    await first
      .getByRole('button', { name: /Copper pin.*put on the table/ })
      .first()
      .click();
    await expect(second.getByRole('dialog')).toContainText('Copper pin');

    // Both agree, and the swap happens.
    await second.getByRole('button', { name: 'I agree to this' }).click();
    await expect(first.getByRole('dialog')).toContainText('has agreed');

    await first.getByRole('button', { name: 'I agree to this' }).click();

    await expect(first.getByRole('dialog')).toHaveCount(0);
    await expect(second.getByRole('dialog')).toHaveCount(0);

    // The first player now has the stool, which was the second player's.
    await first.getByRole('button', { name: /Purse/ }).click();
    await expect(first.getByRole('dialog')).toContainText('Oak stool');
    await expect(first.getByRole('dialog')).not.toContainText('Copper pin');
  } finally {
    await first.close();
    await second.close();
  }
});

test('agreeing again is needed after anything changes', async ({ browser }) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    const one = await createAccountAndEnter(first);
    await createAccountAndEnter(second);

    await say(first, 'Trade?');
    await expect(second.locator('.chat__log')).toContainText('Trade?');
    await second.getByRole('button', { name: one }).first().click();
    await second.getByRole('button', { name: 'Offer to trade' }).click();
    await expect(first.getByRole('dialog')).toContainText('Trading with');

    await second
      .getByRole('button', { name: /Oak stool.*put on the table/ })
      .first()
      .click();
    await first.getByRole('button', { name: 'I agree to this' }).click();
    await expect(second.getByRole('dialog')).toContainText('has agreed');

    // The oldest trick there is: agree, then take the good thing back.
    await second
      .getByRole('button', { name: /Oak stool.*take back/ })
      .first()
      .click();

    await expect(first.getByRole('dialog')).toContainText('has not agreed yet');
    await expect(first.getByRole('dialog')).toContainText('You have not agreed yet');
  } finally {
    await first.close();
    await second.close();
  }
});

test('money put on the table leaves the purse, and comes back if called off', async ({
  browser,
}) => {
  const first = await browser.newPage();
  const second = await browser.newPage();
  try {
    const one = await createAccountAndEnter(first);
    await createAccountAndEnter(second);

    await say(first, 'Trade?');
    await expect(second.locator('.chat__log')).toContainText('Trade?');
    await second.getByRole('button', { name: one }).first().click();
    await second.getByRole('button', { name: 'Offer to trade' }).click();
    await expect(second.getByRole('dialog')).toContainText('Trading with');

    await second.getByLabel('Crowns to put on the table').fill('20');
    await second.getByRole('button', { name: 'Set', exact: true }).click();

    await expect(second.getByRole('dialog')).toContainText('You have 30.00 c left');
    await expect(first.getByRole('dialog')).toContainText('20.00 c');

    await second.getByRole('button', { name: 'Call it off' }).click();

    await expect(second.getByRole('dialog')).toHaveCount(0);
    await second.getByRole('button', { name: /Purse/ }).click();
    await expect(second.getByRole('dialog')).toContainText('50.00 c');
  } finally {
    await first.close();
    await second.close();
  }
});
