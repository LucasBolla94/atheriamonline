import { test, expect } from '@playwright/test';
import { PROTOCOL_VERSION } from '../packages/protocol/src/index.js';
import { E2E_WORLD_PORT } from './global-setup.js';

for (const incompatible of ['ticket', 'join', 'welcome'] as const) {
  test(`${incompatible} version mismatch offers a working refresh without losing the account`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    let injectMismatch = true;
    if (incompatible === 'ticket')
      await page.route('**/api/world/ticket', (route) =>
        route.continue(
          injectMismatch
            ? { postData: JSON.stringify({ protocolVersion: PROTOCOL_VERSION - 1 }) }
            : {},
        ),
      );
    await page.routeWebSocket(`ws://127.0.0.1:${E2E_WORLD_PORT}`, (socket) => {
      const server = socket.connectToServer();
      const rewrite = (raw: string | Buffer) => {
        const message = JSON.parse(String(raw));
        if (injectMismatch && message.t === incompatible)
          message.protocolVersion = PROTOCOL_VERSION - 1;
        return JSON.stringify(message);
      };
      socket.onMessage((message) => server.send(rewrite(message)));
      server.onMessage((message) => socket.send(rewrite(message)));
    });
    const name = `Up${incompatible}${Date.now().toString().slice(-7)}`;
    await page.goto('/play/?create=1');
    await page.getByLabel('Email address').fill(`${name}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill('a strong city password');
    await page.getByLabel('Your name in the city').fill(name);
    await page.getByLabel('Date of birth').fill('1990-01-01');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page.getByRole('alert')).toContainText('The city has been updated.');
    await expect(page.locator('.hud')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
    injectMismatch = false;
    await page.getByRole('button', { name: 'Load the latest version', exact: true }).click();
    await expect(page.locator('.hud')).toContainText(name);
    await page.getByRole('button', { name: /^Purse/ }).click();
    await expect(page.getByRole('dialog')).toContainText('50.00 c');
    await expect(page.getByRole('dialog')).toContainText('You are carrying 3 things');
    await expect(
      page.getByRole('button', { name: 'Load the latest version', exact: true }),
    ).toHaveCount(0);
  });
}
