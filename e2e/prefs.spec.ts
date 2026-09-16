import { test, expect } from '@playwright/test';

/**
 * Language and theme are chosen in the footer and remembered by the browser.
 * Language reloads the page with the other strings; theme applies at once and,
 * on "auto", follows the system.
 */
test('the language switch changes the strings and is remembered', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('html')).toHaveAttribute('lang', /es|en/);
  await page.locator('#prefs [data-locale="en"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#tagline')).toContainText('Put it in the middle of the table');
  await page.goto('live.html');
  await expect(page.locator('#count-label')).toHaveText('How many people are at the table?');
  await page.locator('#prefs [data-locale="es"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('#count-label')).toHaveText('¿Cuántas personas hay en la mesa?');
});

test('the theme switch darkens the page and is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('analyze.html');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.locator('#prefs [data-theme="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const dark = await bg();
  expect(dark).not.toBe(light);
  await expect(page.locator('meta[name="theme-color"]')).not.toHaveAttribute('content', '#F2E8D6');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).toBe(dark);
  // Auto follows the system.
  await page.locator('#prefs [data-theme="auto"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
