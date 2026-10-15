import { expect, test, type Page } from '@playwright/test';
import { hankLines, samLines } from '../src/commentary.ts';
import { planFight } from '../src/fight.ts';
import { advanceTitles, beltName, CHAMPIONSHIP_ROUNDS, fightersOf } from '../src/titles.ts';
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
// Hank's intro and result don't depend on the moves the arena picks
const hank = (() => { const [a, b] = fightersOf(night)!; return hankLines(planFight(base, a, b, CHAMPIONSHIP_ROUNDS), { belt: beltName(night.belt), kind: 'title', newChallenger: night.kind === 'title' && night.why === 'new challenger' }, []); })();
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
  // Hype Hank opens with the introductions, calls the first hit as it's thrown, and calls the result
  await expect(page.locator('#hankLine')).toBeVisible();
  await expect(page.locator('#hankText')).toHaveText(hank.intro);
  await expect(page.locator('#hankText')).toContainText(' HP', { timeout: 10_000 });
  await page.click('#skip');
  await expect(page.locator('#samText')).toContainText(expected.at(-1)!.text);
  await expect(page.locator('#hankText')).toHaveText(hank.result);
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  // the result screen lists every line, exactly as computed from the recorded fight
  await expect(page.locator('#samCard')).toBeVisible();
  await expect(page.locator('#samList li .sam-t')).toHaveText(expected.map((l) => (l.round ? `${l.round}: ${l.text}` : l.text)));
  // Hank's call over Sam's opener, each round and the result (no K.O. here, so every line has one)
  await expect(page.locator('#samList li .hank-q')).toHaveCount(expected.length);
  await expect(page.locator('#samList li .hank-q').first()).toHaveText(`HANK ${hank.intro}`);
  await expect(page.locator('#samList li .hank-q').last()).toHaveText(`HANK ${hank.result}`);
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
  await expect(page.locator('#hankLine')).toBeVisible();
  await page.click('#skip');
  await expect(page.locator('#samCard')).toBeVisible();
  // a Free play fight right after: no Sam
  await page.click('#again'); // replays don't touch the picks: choose two
  await page.locator('.fighter', { hasText: 'Fixture 2' }).click();
  await page.locator('.fighter', { hasText: 'Fixture 3' }).click();
  await page.click('#fight');
  await expect(page.locator('#samLine')).toBeHidden();
  await expect(page.locator('#hankLine')).toBeHidden();
  await page.click('#skip');
  await expect(page.locator('#samCard')).toBeHidden();
  await page.click('#tabs [data-tab="royale"]');
  await page.locator('#fillTop').click();
  await page.click('#fight');
  await expect(page.locator('#samLine')).toBeHidden();
  await expect(page.locator('#hankLine')).toBeHidden();
  expect(errors).toEqual([]);
});

// the review's repro: an opening final that's a draw, won on tiebreak by the higher seed, who is listed second
const tied = { ...base, models: eight.map((m, i) => ({ ...m, scores: Object.fromEntries(Object.keys(m.scores).map((k) => [k, S([80, 90, 70, 90][i] ?? 50 - i)])) })) };
const tiedLog = advanceTitles(tied, { through: null, events: [] }, '2026-10-16', '2026-10-14');
const tiedPage = pageFor({ ...tied, seasonStart: '2026-10-14', titles: tiedLog } as BrawlData, 'hank-opening');

test("Hank crowns an opening final's recorded winner, not the fighter listed first", async ({ page }) => {
  const e = tiedLog.events.find((x) => x.kind === 'opening' && x.belt === 'undisputed')!;
  const final = e.kind === 'opening' ? e.matches.at(-1)! : null;
  expect(final).toMatchObject({ a: 'fixture-4', b: 'fixture-2', winner: 'fixture-2', tiebreak: true });
  const errors = await open(page, tiedPage, '2026-10-16', '#belts');
  await page.locator('#history li', { hasText: 'Undisputed belt opens' }).getByRole('button', { name: '▶ Watch' }).click();
  await expect(page.locator('#hankText')).toContainText('opening tournament');
  await expect(page.locator('#hankText')).not.toContainText('champion');
  await page.click('#skip');
  await expect(page.locator('#hankText')).toHaveText('A DRAW! The tiebreak decides it: Fixture 2, the higher seed, wins the opening tournament and the FIRST Undisputed belt!');
  await expect(page.locator('#samList li .hank-q').last()).toContainText('Fixture 2, the higher seed');
  expect(errors).toEqual([]);
});

test('switching to reduced motion mid-fight: Hank calls the move the canvas throws, not the signature move it skips', async ({ page }) => {
  const errors = await open(page, PAGES.on, '2026-10-18');
  await page.click('#justWatch'); // motion on: each fighter has a signature move planned for its biggest hit
  await page.emulateMedia({ reducedMotion: 'reduce' }); // during the intro, before any attack
  await expect(page.locator('#result')).toBeVisible({ timeout: 45_000 }); // watched to the end, no skip
  const calls = await page.locator('#samList li .hank-q').allTextContents();
  expect(calls.join(' ')).not.toContain('SIGNATURE MOVE');
  expect(errors).toEqual([]);
});

for (const [what, url] of [['with no start date', 'off'], ['before the start date', 'later']] as const) {
  test(`Season 2 off (${what}): no Sam, even on a recorded title night`, async ({ page }) => {
    const errors = await open(page, PAGES[url], '2026-10-18');
    await page.click('#justWatch');
    await expect(page.locator('#samLine')).toBeHidden();
    await expect(page.locator('#hankLine')).toBeHidden();
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
    await expect(page.locator('#hankLine')).toBeVisible();
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
