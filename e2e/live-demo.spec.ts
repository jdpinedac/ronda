import { test, expect } from '@playwright/test';

/**
 * The live page fed the bundled recording through a fake microphone
 * (?demo=1), watched for long enough for people to overtake one another.
 * Early on the groups churn as evidence accumulates, and a person's row can
 * legitimately move. What must not happen: more rows than people, a name or
 * colour appearing that was not there once four rows exist, or a row's colour
 * changing under its name.
 */
test('live rows keep their colour and name while shares move', async ({ page }) => {
  await page.goto('live.html?demo=1');
  await page.locator('#names').fill('Ana, Juan, Marta, Pedro');
  await expect(page.locator('#count')).toHaveValue('4');
  await page.locator('#toggle').click();

  // With names typed, the table is asked to introduce itself first. Skipping
  // gives the grouping this test has always exercised.
  await expect(page.locator('#intro')).toBeVisible();
  await expect(page.locator('#intro-name')).toHaveText('Ana');
  await page.locator('#intro-skip').click();
  await expect(page.locator('#intro')).toBeHidden();
  await expect(page.locator('#hint')).toContainText(/Sin presentación|Without introductions/);

  // Wait for the first update with at least two rows, then sample every few seconds.
  await expect(page.locator('#legend li')).toHaveCount(2, { timeout: 60_000 }).catch(() => undefined);
  await expect.poll(async () => page.locator('#legend li').count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);

  type Row = { name: string; colour: string; ms: string };
  const snapshot = async (): Promise<Row[]> => page.locator('#legend li').evaluateAll((rows) => rows.map((li) => ({
    name: li.querySelector('.name')!.textContent!,
    colour: (li.querySelector('.dot') as HTMLElement).style.background,
    ms: li.querySelector('.stat')!.textContent!,
  })));
  const toSeconds = (t: string) => { const [m, s] = t.split(':').map(Number); return m! * 60 + s!; };

  const samples: Row[][] = [];
  for (let i = 0; i < 8; i++) {
    samples.push(await snapshot());
    await page.waitForTimeout(5_000);
  }
  const colourOf = new Map<string, string>();
  let full: Set<string> | null = null;
  for (const [i, rows] of samples.entries()) {
    expect(rows.length, `rows at sample ${i}`).toBeLessThanOrEqual(4);
    for (const row of rows) {
      expect(['Ana', 'Juan', 'Marta', 'Pedro'], `name at sample ${i}`).toContain(row.name);
      const seen = colourOf.get(row.name);
      if (seen) expect(row.colour, `${row.name} colour at sample ${i}`).toBe(seen);
      colourOf.set(row.name, row.colour);
      expect(toSeconds(row.ms)).toBeGreaterThanOrEqual(0);
    }
    if (rows.length === 4) {
      const names = new Set(rows.map((r) => r.name));
      if (full) expect([...names].sort(), `names once four rows exist, sample ${i}`).toEqual([...full].sort());
      full = names;
    }
  }
  expect(samples[samples.length - 1]![0]!.name).toBe('Ana');

  // Stop is a pause: the tally stays, and the choice is resume or reset.
  await page.locator('#toggle').click();
  await expect(page.locator('#toggle')).toHaveText(/Reanudar|Resume/);
  await expect(page.locator('#reset')).toBeVisible();
  const keptRows = await page.locator('#legend li').count();
  expect(keptRows).toBeGreaterThanOrEqual(2);
  const keptTime = await page.locator('#center-time').textContent();

  await page.locator('#toggle').click();
  await expect(page.locator('#toggle')).toHaveText(/Detener|Stop/);
  await expect(page.locator('#reset')).toBeHidden();
  await page.waitForTimeout(6_000);
  await page.locator('#toggle').click();
  await expect(page.locator('#toggle')).toHaveText(/Reanudar|Resume/);
  expect(toSeconds((await page.locator('#center-time').textContent())!)).toBeGreaterThanOrEqual(toSeconds(keptTime!));
  expect(await page.locator('#legend li').count()).toBeGreaterThanOrEqual(keptRows);

  // Export what the session kept: embeddings and timing, never audio.
  await expect(page.locator('#export')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^ronda-diagnostics-.*\.json$/);
  const bundle = JSON.parse((await (await file.createReadStream()).toArray()).join('')) as { format: string; vectors: number[][]; identities: number[]; spans: unknown[] };
  expect(bundle.format).toBe('ronda-diagnostics/1');
  expect(bundle.vectors.length).toBeGreaterThan(0);
  expect(bundle.vectors.length).toBe(bundle.identities.length);
  expect(JSON.stringify(bundle)).not.toContain('Ana');

  await page.locator('#reset').click();
  await expect(page.locator('#toggle')).toHaveText(/Escuchar|Listen/);
  await expect(page.locator('#legend li')).toHaveCount(0);
  await expect(page.locator('#center-time')).toHaveText('0:00');
  await expect(page.locator('#count')).toBeEnabled();
});

/**
 * The introductions themselves: the first name is up, Next stays disabled
 * until enough voice has been heard, then the second name is up. The demo
 * recording is a meeting, not a round of introductions, so the profiles it
 * builds mean nothing; what is checked is the mechanics, with real audio.
 */
test('the introductions go through the names in order and wait for enough voice', async ({ page }) => {
  await page.goto('live.html?demo=1');
  await page.locator('#names').fill('Ana, Juan, Marta');
  await page.locator('#toggle').click();

  await expect(page.locator('#intro')).toBeVisible();
  await expect(page.locator('#intro-name')).toHaveText('Ana');
  await expect(page.locator('#intro-next')).toHaveText(/Siguiente|Next/);
  await expect(page.locator('#badge-text')).toHaveText(/Presentación|Introductions/);
  // Nothing has been heard yet; the button waits for 5 s of one voice.
  await expect(page.locator('#intro-next')).toBeDisabled();
  await expect(page.locator('#legend li')).toHaveCount(0);
  await expect(page.locator('#intro-next')).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#center-time')).toHaveText('0:00');

  await page.locator('#intro-next').click();
  await expect(page.locator('#intro-name')).toHaveText('Juan');
  await expect(page.locator('#intro-next')).toBeDisabled();
  await page.locator('#intro-next').click({ force: true }).catch(() => undefined);
  await expect(page.locator('#intro-name')).toHaveText('Juan');

  // Finish the round: Juan, then Marta, then the conversation is counted
  // against the three profiles and "someone joined" becomes available.
  await expect(page.locator('#intro-next')).toBeEnabled({ timeout: 60_000 });
  await page.locator('#intro-next').click();
  await expect(page.locator('#intro-name')).toHaveText('Marta');
  await expect(page.locator('#intro-next')).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#intro-next')).toHaveText(/Empezar a contar|Start counting/);
  await page.locator('#intro-next').click();
  await expect(page.locator('#intro')).toBeHidden();
  await expect(page.locator('#legend li')).toHaveCount(3);
  await expect(page.locator('#add-wrap')).toBeVisible();

  // Someone joins: a fourth row, and their turn to introduce themselves.
  await page.locator('#add-person').click();
  await page.locator('#add-name').fill('<i>Pedro</i>');
  await page.locator('#add-go').click();
  await expect(page.locator('#intro')).toBeVisible();
  await expect(page.locator('#intro-name')).toHaveText('<i>Pedro</i>');
  expect(await page.locator('#intro i').count()).toBe(0);
  await expect(page.locator('#intro-next')).toHaveText(/Listo|Done/);
  await page.locator('#intro-next').click();
  await expect(page.locator('#intro')).toBeHidden();
  await expect(page.locator('#legend li')).toHaveCount(4);
  await expect(page.locator('#legend li .name').nth(3)).toHaveText('<i>Pedro</i>');

  await page.locator('#toggle').click();
  await expect(page.locator('#toggle')).toHaveText(/Reanudar|Resume/);
});
