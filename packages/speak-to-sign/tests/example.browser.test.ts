import { expect, test } from '@playwright/test';

test('a voice is enrolled and an action is confirmed, from the microphone to the checked verdict', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#actions li')).toHaveCount(3);

  // Three enrollment clips. Each recording ends by itself at the pause after the speech.
  const enroll = page.locator('#enroll-record');
  for (const clip of [1, 2, 3]) {
    await expect(enroll).toHaveText(`Record clip ${clip} of 3`);
    await enroll.click();
    if (clip < 3) await expect(page.locator('#enroll-status')).toHaveText(`Clip ${clip} of 3 is ready.`, { timeout: 60_000 });
  }
  await expect(page.locator('#enroll-status')).toHaveText('Your voice is enrolled.', { timeout: 60_000 });

  // The fake verifier "hears" the second sentence. The server checks its signed verdict.
  await page.locator('#fake-said').selectOption({ index: 1 });
  await page.locator('#confirm-record').click();
  await expect(page.locator('#confirm-status')).toHaveText('Confirmed: "Cancel my order".', { timeout: 60_000 });

  // Other words confirm nothing.
  await page.locator('#fake-said').selectOption({ label: 'Other words' });
  await page.locator('#confirm-record').click();
  await expect(page.locator('#confirm-status')).toContainText('Not confirmed (words).', { timeout: 60_000 });
  expect(errors).toEqual([]);
});
