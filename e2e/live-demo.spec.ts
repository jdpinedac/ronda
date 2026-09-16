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
  await page.locator('#count').fill('4');
  await page.locator('#names').fill('Ana, Juan, Marta, Pedro');
  await page.locator('#toggle').click();

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
  await page.locator('#toggle').click();
});
