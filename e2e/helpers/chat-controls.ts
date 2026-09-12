import { expect, type Page } from '@playwright/test';

/** The same actual keyboard regression runs locally and on the published client. */
export async function verifyChatControls(page: Page): Promise<void> {
  const input = page.getByLabel('Say something');
  const location = page.locator('.location-card');
  const before = await location.innerText();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  // Real key events reproduce Phaser captures; fill() bypasses this bug.
  await input.pressSequentially('wasd WASD', { delay: 80 });
  await expect(input).toHaveValue('wasd WASD');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(input).toBeFocused();
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('wasd WASD');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => input.evaluate((node: HTMLInputElement) => node.selectionStart)).toBe(8);
  await expect(location).toHaveText(before, { useInnerText: true });
  await page.keyboard.press('Enter');
  await expect(input).not.toBeFocused();
  await expect(page.locator('.chat')).toHaveClass(/chat--folded/);
  await page.keyboard.down('d');
  try {
    await expect(location).not.toHaveText(before, { useInnerText: true });
  } finally {
    await page.keyboard.up('d');
  }
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await expect(page.locator('.chat__log')).toContainText('wasd WASD');
  await expect(input).toHaveValue('');
  // Empty Enter must also close, and opening again must focus a visible input.
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat')).toHaveClass(/chat--folded/);
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).not.toBeFocused();
}
