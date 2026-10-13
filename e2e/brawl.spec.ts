import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { planFight } from '../src/fight.ts';
import { brawlNumber } from '../src/league.ts';
import type { BrawlData } from '../src/types.ts';

const URL = `file://${resolve('_site/index.html')}`;
const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const [first, second] = data.models;

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  return errors;
}

test('free play shows the arena builder, weight classes and the roster', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(URL);
  await page.click('#tabs [data-tab="play"]');
  await expect(page.locator('.fighter')).toHaveCount(data.models.length);
  await expect(page.locator('#roundChips .chip[aria-pressed="true"]')).toHaveCount(data.defaultRounds.length);
  await expect(page.locator('body')).not.toContainText(/\bnull\b|\bundefined\b/);
  await page.getByRole('button', { name: /^Open weights/ }).click();
  await expect(page.locator('.fighter')).toHaveCount(data.models.filter((m) => m.open).length);
  expect(errors).toEqual([]);
});

test('a fight ends with a sourced scorecard and a share link', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${URL}#a=${first.id}&b=${second.id}&r=coding,math,science,facts,puzzles`);
  await expect(page.locator('#vsLine')).toContainText(`${first.name} VS ${second.name}`);
  await page.click('#fight');
  await expect(page.locator('#arena')).toBeVisible();
  await page.click('#skip');
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#rows tr')).toHaveCount(planFight(data, first, second, ['coding', 'math', 'science', 'facts', 'puzzles']).rounds.length);
  await expect(page.locator('#rows a').first()).toHaveAttribute('href', /^https:/);
  await expect(page.locator('#share')).toContainText(`#a=${first.id}&b=${second.id}`);
  expect(errors).toEqual([]);
});

test('an arena keeps at least three rounds', async ({ page }) => {
  await page.goto(`${URL}#r=coding,math,science`);
  await page.click('#tabs [data-tab="play"]');
  await page.click('#builderSummary');
  await page.locator('#roundChips .chip[aria-pressed="true"]').first().click();
  await expect(page.locator('#toast')).toContainText('at least 3');
  await expect(page.locator('#roundChips .chip[aria-pressed="true"]')).toHaveCount(3);
});

test('a tournament crowns a champion and can replay the final', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(URL);
  await page.click('#tabs [data-tab="tournament"]');
  await expect(page.locator('#champ')).toContainText('Champion:');
  await expect(page.locator('.match')).toHaveCount(7);
  await page.click('#watchFinal');
  await page.click('#skip');
  await expect(page.locator('#backToBracket')).toBeVisible({ timeout: 10_000 });
  await page.click('#backToBracket');
  await expect(page.locator('#tourney')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a battle royale ranks every fighter and shares a replay link', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(URL);
  await page.click('#tabs [data-tab="royale"]');
  await page.click('#fillTop');
  await expect(page.locator('#vsLine')).toContainText('8/8');
  await expect(page.locator('body')).not.toContainText(/\bnull\b|\bundefined\b/);
  await page.click('#fight');
  await expect(page.locator('#board .bf')).toHaveCount(8);
  await page.click('#skip');
  await expect(page.locator('#royaleResult')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#rrows tr')).toHaveCount(8);
  await expect(page.locator('#royaleResult')).not.toContainText(/\bnull\b|\bundefined\b/);
  await expect(page.locator('#rshare')).toContainText('#m=royale&f=');
  expect(errors).toEqual([]);
});

test('claim check lists lab claims next to independent results, with sources', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(URL);
  await page.click('#tabs [data-tab="claims"]');
  await expect(page.locator('#claimRows tr')).toHaveCount(data.claims.length);
  await expect(page.locator('#claimRows a').first()).toHaveAttribute('href', /^https:/);
  await expect(page.locator('#claims')).not.toContainText(/\bnull\b|\bundefined\b|NaN/);
  await page.selectOption('#claimLab', 'Anthropic');
  await expect(page).toHaveURL(/#claims=Anthropic$/);
  await expect(page.locator('#claimShare')).toContainText('#claims=Anthropic');
  expect(errors).toEqual([]);
});

test('the daily brawl: make a call, watch, get a verdict, share, and come back to it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(URL);
  await expect(page.locator('#brawlNo')).toContainText('BRAWL #');
  await expect(page.locator('#todayFight')).toBeDisabled();
  await page.click('#callA');
  await expect(page.locator('#callA')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#todayFight');
  await expect(page.locator('#arena')).toBeVisible();
  await page.click('#skip');
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#yourCall')).toContainText(/You called it|Not this time/);
  await expect(page.locator('#share')).toContainText(/Benchmark Brawl #\d+/);
  await expect(page.locator('#share')).toContainText('#today');
  await page.click('#tabs [data-tab="today"]');
  await expect(page.locator('#doneBox')).toBeVisible();
  await expect(page.locator('#callBox')).toBeHidden();
  await expect(page.locator('#stats')).toContainText('1Played');
  await expect(page.locator('body')).not.toContainText(/\bnull\b|\bundefined\b|NaN/);
  expect(errors).toEqual([]);
});

// ---------- regressions from the code review ----------
test('Tab then Enter picks the focused fighter, not the first one', async ({ page }) => {
  await page.goto(URL);
  await page.click('#tabs [data-tab="play"]');
  const fourth = page.locator('.fighter').nth(3);
  await fourth.focus();
  await page.keyboard.press('Enter');
  await expect(fourth).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.fighter').first()).toHaveAttribute('aria-pressed', 'false');
});

test('a royale whose fighters share no benchmark declines to start instead of crashing', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${URL}#m=royale&f=claudeopus55,qwen38max0902,gemini3pro&r=coding,puzzles,price`);
  await page.click('#fight');
  await expect(page.locator('#toast')).toContainText('share a benchmark');
  await expect(page.locator('#arena')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the tournament follows a change of weight class', async ({ page }) => {
  await page.goto(URL);
  await page.click('#tabs [data-tab="tournament"]');
  await page.click('#tabs [data-tab="play"]');
  await page.getByRole('button', { name: /^Open weights/ }).click();
  await page.click('#tabs [data-tab="tournament"]');
  const topOpen = [...data.models].filter((m) => m.open).sort((a, b) => (b.eci ?? -1) - (a.eci ?? -1))[0];
  const topClosed = [...data.models].sort((a, b) => (b.eci ?? -1) - (a.eci ?? -1))[0];
  await expect(page.locator('#bracket')).toContainText(topOpen.name);
  await expect(page.locator('#bracket')).not.toContainText(topClosed.name);
});

test('bad links fall back safely', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${URL}#r=coding,coding,coding`);
  await page.click('#tabs [data-tab="play"]');
  expect(await page.locator('#roundChips .chip[aria-pressed="true"]').count()).toBeGreaterThanOrEqual(3);
  await page.goto(`${URL}#claims=%`);
  await page.reload();
  await expect(page.locator('#claims')).toBeVisible();
  await expect(page.locator('#claimRows tr')).toHaveCount(data.claims.length);
  expect(errors).toEqual([]);
});

test.describe('phones', () => {
  test.use({ viewport: { width: 320, height: 700 } });
  test('nothing scrolls sideways, and sources stay visible', async ({ page }) => {
    await page.goto(`${URL}#a=${first.id}&b=${second.id}&r=coding,math,science,facts,puzzles`);
    const width = () => page.evaluate(() => document.documentElement.scrollWidth);
    expect(await width()).toBeLessThanOrEqual(321);
    await page.click('#fight');
    await page.click('#skip');
    await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
    await page.click('#numbers summary');
    expect(await width()).toBeLessThanOrEqual(321);
    await expect(page.locator('#rows a').first()).toBeVisible();
    await page.click('#tabs [data-tab="claims"]');
    await expect(page.locator('#claimRows a').first()).toBeVisible();
  });
});

test('saving a clip of the daily brawl keeps the daily fight, not the free-play rounds', async ({ page, browserName }, info) => {
  test.skip(info.project.name !== 'desktop', 'recording runs once, on desktop');
  test.setTimeout(120_000);
  await page.goto(URL);
  await page.click('#tabs [data-tab="play"]');
  await page.click('#builderSummary');
  await page.getByRole('button', { name: 'On a budget' }).click();
  await page.click('#tabs [data-tab="today"]');
  await page.click('#callA');
  await page.click('#todayFight');
  await page.click('#skip');
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  const verdict = await page.locator('#verdict').textContent();
  const download = page.waitForEvent('download', { timeout: 100_000 });
  await page.click('#clip');
  await download;
  await expect(page.locator('#verdict')).toHaveText(verdict!);
  await expect(page.locator('#share')).toContainText(/Benchmark Brawl #\d+/);
  expect(browserName).toBe('chromium');
});

test('a saved call for a different pairing does not count in the daily stats', async ({ page }) => {
  const no = brawlNumber(new Date());
  await page.addInitScript((n) => localStorage.setItem('brawl-daily-v1', JSON.stringify({ days: { [n]: { a: 'not-today-a', b: 'not-today-b', pick: 'not-today-a', winner: 'not-today-a', correct: true } } })), no);
  await page.goto(URL);
  await expect(page.locator('#callBox')).toBeVisible();
  await expect(page.locator('#stats')).toContainText('0Played');
  await expect(page.locator('#streakChip')).toContainText('Start a streak');
});

test('reduced motion: still scenery, and turning it on mid-fight is safe', async ({ page }) => {
  const errors = watchErrors(page);
  // pick a matchup in an arena with moving scenery (dojo, deep sea or snow peak)
  const fnv = (s: string) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  const ids = data.models.map((m) => m.id);
  const [a, b] = ids.flatMap((x) => ids.map((y) => [x, y])).find(([x, y]) => x !== y && [4, 6, 7].includes(fnv(`arena|${x}|${y}`) % 8))!;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${URL}#a=${a}&b=${b}&r=coding,math,science,facts,puzzles`);
  await page.click('#fight');
  await page.waitForTimeout(150);
  const one = await page.locator('#cv').screenshot();
  await page.waitForTimeout(500);
  const two = await page.locator('#cv').screenshot();
  expect(one.equals(two)).toBe(true); // nothing drifts during the round banner
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${URL}#a=${first.id}&b=${second.id}&r=coding,math,science,facts,puzzles`);
  await page.reload(); // a new hash alone doesn't reload the page
  await page.click('#fight');
  await page.waitForTimeout(2500);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(4000); // a few rounds play on with reduced motion switched on mid-fight
  await page.click('#skip');
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});

// ---------- saved daily brawls against changed live data ----------
/** A copy of the built page whose live data has been changed (the daily snapshots inside are left as they are). */
function pageWithLiveData(change: (d: BrawlData) => void, name: string) {
  const html = readFileSync(resolve('_site/index.html'), 'utf8');
  const [, json] = html.match(/<script type="application\/json" id="brawl-data">([\s\S]*?)<\/script>/)!;
  const d: BrawlData = JSON.parse(json);
  change(d);
  const file = resolve(`test-results/${name}.html`);
  mkdirSync(resolve('test-results'), { recursive: true });
  writeFileSync(file, html.replace(json, () => JSON.stringify(d).replace(/</g, '\\u003c')));
  return { url: `file://${file}`, daily: d.daily ?? [] };
}
type Entry = NonNullable<BrawlData['daily']>[number];
const snapshotWinner = (e: Entry) => { const p = planFight(data, e.fighters![0], e.fighters![1], e.rounds); return p.winner === -1 ? null : p.fighters[p.winner].name; };

test('an older brawl\'s link replays that brawl, shares that brawl, and rematches it', async ({ page }, info) => {
  const errors = watchErrors(page);
  const site = pageWithLiveData(() => {}, `archive-${info.project.name}`);
  const inPage = site.daily.filter((e) => e.fighters && snapshotWinner(e));
  test.skip(inPage.length < 2, 'needs two scheduled days in the built page');
  const [old, today] = [inPage[0], inPage[inPage.length - 1]];
  const winner = snapshotWinner(old)!, loser = winner === old.fighters![0].name ? old.fighters![1] : old.fighters![0];
  // live data where the saved winner is now hopeless: a free-play rematch would flip the result
  const changed = pageWithLiveData((d) => { for (const m of d.models) if (m.name === winner) for (const s of Object.values(m.scores)) s.v = 0; }, `archive-changed-${info.project.name}`);
  await page.clock.setFixedTime(new Date(`${today.day}T12:00:00Z`));
  await page.goto(`${changed.url}#today=${old.no}`);
  await page.click('#skip');
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#verdict')).toContainText(winner.toUpperCase());
  await expect(page.locator('#yourCall')).toContainText(`Replay of Brawl #${old.no}`);
  await expect(page.locator('#share')).toContainText(`Benchmark Brawl #${old.no}`);
  await expect(page.locator('#share')).toContainText(`#today=${old.no}`);
  expect(page.url()).toContain(`#today=${old.no}`);
  await page.click('#rematch');
  await expect(page.locator('#arena')).toBeVisible();
  await page.click('#skip');
  await expect(page.locator('#verdict')).toContainText(winner.toUpperCase());
  expect(loser.name).not.toBe(winner);
  expect(errors).toEqual([]);
});

test('Today shows the saved winner even after that fighter left the roster', async ({ page }, info) => {
  const errors = watchErrors(page);
  const probe = pageWithLiveData(() => {}, `today-probe-${info.project.name}`);
  const today = probe.daily.filter((e) => e.fighters && snapshotWinner(e)).at(-1);
  test.skip(!today, 'needs a scheduled day in the built page');
  const winner = snapshotWinner(today!)!;
  const site = pageWithLiveData((d) => { d.models = d.models.filter((m) => m.name !== winner); }, `today-removed-${info.project.name}`);
  await page.clock.setFixedTime(new Date(`${today!.day}T12:00:00Z`));
  await page.goto(site.url);
  await page.click('#callA');
  await page.click('#todayFight');
  await page.click('#skip');
  await expect(page.locator('#verdict')).toContainText(winner.toUpperCase(), { timeout: 10_000 });
  await page.click('#tabs [data-tab="today"]');
  await expect(page.locator('#doneLine')).toContainText(`${winner.toUpperCase()} WON`);
  expect(errors).toEqual([]);
});
