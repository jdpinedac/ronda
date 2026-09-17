import { test, expect } from '@playwright/test';

/**
 * The one flow that exercises everything: model download, audio decoding,
 * segmentation, embeddings, clustering, overlap credit and rendering. If
 * this passes, a visitor with the bundled example gets four people and a
 * plausible split.
 */
test('analysing the bundled example yields four speakers', async ({ page }) => {
  await page.goto('analyze.html');
  const analyse = page.locator('#go');
  await expect(analyse).toBeDisabled();

  await page.locator('#example').click();
  await expect(page.locator('#filename')).toHaveText('meeting.wav');
  await expect(page.locator('#count')).toHaveValue('4');
  await expect(analyse).toBeEnabled();
  // A name is text, whatever it contains.
  await page.locator('#names').fill('<b>Ana</b>, Juan, Marta, Pedro');

  await analyse.click();
  await expect(page.locator('#results')).toBeVisible({ timeout: 200_000 });
  await expect(page.locator('#legend li')).toHaveCount(4);
  await expect(page.locator('#legend li .name').first()).toHaveText('<b>Ana</b>');
  expect(await page.locator('#legend b').count()).toBe(0);
  await expect(page.locator('#count-note')).toContainText(/head count|número de personas/);
  await expect(page.locator('#error')).toBeHidden();

  // The biggest share on this recording is a third; nobody should be near zero.
  const shares = await page.locator('#legend .pct').allTextContents();
  const values = shares.map((s) => Number.parseInt(s, 10));
  expect(Math.max(...values)).toBeLessThan(50);
  expect(Math.min(...values)).toBeGreaterThan(10);
});

test('the live page insists on a head count before listening', async ({ page }) => {
  await page.goto('live.html');
  const listen = page.locator('#toggle');
  await expect(listen).toBeDisabled();

  await page.locator('#names').fill('Ana, Juan, Marta');
  await expect(page.locator('#count')).toHaveValue('3');
  await expect(listen).toBeEnabled();
  await expect(page.locator('#count-hint')).toContainText(/From the names|Según los nombres/);

  // The count keeps following the names…
  await page.locator('#names').fill('Ana, Juan, Marta, Pedro');
  await expect(page.locator('#count')).toHaveValue('4');

  // …until the user takes the number over.
  await page.locator('#count').fill('5');
  await page.locator('#names').fill('Ana, Juan');
  await expect(page.locator('#count')).toHaveValue('5');

  await page.locator('#count').fill('1');
  await expect(listen).toBeDisabled();
});

test('every page shows the version it was built from', async ({ page }) => {
  for (const path of ['', 'live.html', 'analyze.html']) {
    await page.goto(path);
    await expect(page.locator('#version')).toContainText(/Ronda \d+\.\d+\.\d+/);
  }
});
