import { expect, test, type Page } from '@playwright/test';
import { samLines } from '../src/commentary.ts';
import { planFight } from '../src/fight.ts';
import { advanceTitles, CHAMPIONSHIP_ROUNDS, fightersOf } from '../src/titles.ts';
import type { BrawlData, Model } from '../src/types.ts';
import { pageFor, preview } from './fixture-page.ts';

// Sigma Sam on Season 2 title fights, made-up fighters. Season 2 starts Wed Oct 14 2026; Rookie challenges on Sun Oct 18.
const S = (v: number, se: number | null = 0.5) => ({ v, se, setting: 'high' });
const model = (name: string, eci: number, v: number, released = '2026-06-01'): Model =>
  ({ id: name.toLowerCase().replace(/ /g, '-'), name, org: `${name} Lab`, released, open: false, eci, price: null,
    scores: Object.fromEntries(['swebench', 'frontiermath', 'gpqa', 'simpleqa', 'mystery'].map((b) => [b, S(v)])) });
const eight = Array.from({ length: 8 }, (_, i) => model(`Fixture ${i + 1}`, 150 - i, 80 - 5 * i));
// Rookie: a K.O.-free mix of wins, a tie and a missing margin
const rookie = { ...model('Rookie', 200, 0, '2026-10-17'), scores: { swebench: S(83.25), frontiermath: S(80), gpqa: S(80.4, null), simpleqa: S(70), mystery: S(81) } };
const base = { ...preview, models: [...eight, rookie], claims: [], daily: [], arrivals: undefined };
const opened = advanceTitles({ ...base, models: eight }, { through: null, events: [] }, '2026-10-16', '2026-10-14');
const log = advanceTitles(base, opened, '2026-10-19', '2026-10-14');
const night = log.events.find((e) => e.day === '2026-10-18' && fightersOf(e))!;
const expected = (() => { const [a, b] = fightersOf(night)!; const rs = CHAMPIONSHIP_ROUNDS.map((id) => preview.rounds.find((r) => r.id === id)!); return samLines(base, planFight(base, a, b, CHAMPIONSHIP_ROUNDS), rs); })();
const on = (start: string | null, name: string) => pageFor({ ...base, seasonStart: start, titles: log } as BrawlData, `sam-${name}`);
const PAGES = { on: on('2026-10-14', 'on'), off: on(null, 'off'), later: on('2026-10-25', 'later') };

async function open(page: Page, url: string, day: string, hash = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(`${day}T12:00:00Z`));
  await page.goto(url + hash);
  return errors;
}

test("Sam opens the title fight, says nothing about a round before its hit, and ends on the result", async ({ page }) => {
  expect(night.kind).toBe('title');
  const errors = await open(page, PAGES.on, '2026-10-18');
  await page.click('#justWatch');
  await expect(page.locator('#samLine')).toBeVisible();
  await expect(page.locator('#samLine')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#samText')).toHaveText(expected[0].text); // the opening line: no round result yet
  await expect(page.locator('#samText')).not.toContainText('damage');
  await page.click('#skip');
  await expect(page.locator('#samText')).toContainText(expected.at(-1)!.text);
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  // the result screen lists every line, exactly as computed from the recorded fight
  await expect(page.locator('#samCard')).toBeVisible();
  await expect(page.locator('#samList li')).toHaveText(expected.map((l) => (l.round ? `${l.round}: ${l.text}` : l.text)));
  expect(errors).toEqual([]);
});

test('the lines cover a tie, a missing margin and whole-HP rounding from the recorded scores', async () => {
  const t = expected.map((l) => l.text).join('\n');
  expect(t).toContain('leads by 3.25 points'); // Coding: 83.25 against 80
  expect(t).toContain("Twice the gap is 6.50; rounded to whole HP, that's 7 damage.");
  expect(t).toContain('Equal scores: a tie.'); // Math: 80 against 80
  expect(t).toContain('No margin of error is published for Rookie, so only equal scores would count as a tie.'); // Science
});

test('replays from Belts get Sam too; ordinary fights never do', async ({ page }) => {
  const errors = await open(page, PAGES.on, '2026-10-18', '#belts');
  await page.locator('#history li', { hasText: 'vs 🆕 Rookie' }).or(page.locator('#history li', { hasText: 'vs Rookie' })).first().getByRole('button', { name: '▶ Watch' }).click();
  await expect(page.locator('#samLine')).toBeVisible();
  await page.click('#skip');
  await expect(page.locator('#samCard')).toBeVisible();
  // a Free play fight right after: no Sam
  await page.click('#again'); // replays don't touch the picks: choose two
  await page.locator('.fighter', { hasText: 'Fixture 2' }).click();
  await page.locator('.fighter', { hasText: 'Fixture 3' }).click();
  await page.click('#fight');
  await expect(page.locator('#samLine')).toBeHidden();
  await page.click('#skip');
  await expect(page.locator('#samCard')).toBeHidden();
  await page.click('#tabs [data-tab="royale"]');
  await page.locator('#fillTop').click();
  await page.click('#fight');
  await expect(page.locator('#samLine')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const [what, url] of [['with no start date', 'off'], ['before the start date', 'later']] as const) {
  test(`Season 2 off (${what}): no Sam, even on a recorded title night`, async ({ page }) => {
    const errors = await open(page, PAGES[url], '2026-10-18');
    await page.click('#justWatch');
    await expect(page.locator('#samLine')).toBeHidden();
    await page.click('#skip');
    await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#samCard')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

for (const width of [1280, 390, 320]) {
  test(`Sam fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await open(page, PAGES.on, '2026-10-18');
    await page.click('#justWatch');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    // the round banner stays on the canvas, however long Sam's line below it is
    await expect(page.locator('#banner')).toContainText('ROUND 1');
    const cv = (await page.locator('#cv').boundingBox())!, bn = (await page.locator('#banner').boundingBox())!;
    expect(bn.y).toBeGreaterThanOrEqual(cv.y);
    expect(bn.y + bn.height).toBeLessThanOrEqual(cv.y + cv.height + 1);
    await page.click('#skip');
    await expect(page.locator('#samCard')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    expect(errors).toEqual([]);
  });
}
