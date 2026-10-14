import { expect, test, type Page } from '@playwright/test';
import { brawlNumber } from '../src/league.ts';
import { advanceTitles, type TitleLog } from '../src/titles.ts';
import type { BrawlData, Model } from '../src/types.ts';
import { pageFor, preview } from './fixture-page.ts';

// Season 2 edge cases on synthetic fighters: the preview page's rounds and benchmarks, made-up models and title logs.
// Season starts Wed Oct 14 2026 (opening tournament); Sun Oct 18 is the first title night.
const S = (v: number) => ({ v, se: 0.5, setting: 'fixture' });
const model = (name: string, eci: number, v: number, released = '2026-06-01'): Model =>
  ({ id: name.toLowerCase().replace(/ /g, '-'), name, org: name, released, open: false, eci, price: null,
    scores: Object.fromEntries(['swebench', 'frontiermath', 'gpqa', 'simpleqa', 'mystery'].map((b) => [b, S(v)])) });
const eight = Array.from({ length: 8 }, (_, i) => model(`Fixture ${i + 1}`, 150 - i, 80 - 5 * i));
const base: BrawlData = { ...preview, models: eight, claims: [], daily: [], titles: undefined, arrivals: undefined, seasonStart: '2026-10-14' };
const opening = advanceTitles(base, { through: null, events: [] }, '2026-10-16', '2026-10-14');
/** A title night on Oct 18: Fixture 1 (champion) against a new challenger with every score at `v`. */
function season(challenger: Model): BrawlData {
  const d = { ...base, models: [...eight, challenger] };
  return { ...d, titles: advanceTitles(d, opening, '2026-10-18', '2026-10-14') as TitleLog };
}
const draw = season(model('Twin', 200, 80, '2026-10-17')); // the champion's exact scores: every round ties
const decisive = season(model('Rookie', 200, 95, '2026-10-17'));
// the champion has since left the roster: only the title log still has it
const archived = { ...decisive, models: decisive.models.filter((m) => m.id !== 'fixture-1') };

/** Fixture 1, the champion, has left the roster by title night: the belt is vacated, then a vacant-title fight or a quiet night. */
function vacated(models: Model[]): BrawlData {
  const d = { ...base, models };
  return { ...d, titles: advanceTitles(d, opening, '2026-10-18', '2026-10-14') as TitleLog };
}
const vacancy = vacated(eight.slice(1));
const lone = vacated([eight[1]]); // only one ranked contender left
const PAGES = { draw: pageFor(draw, 'draw'), decisive: pageFor(decisive, 'decisive'), archived: pageFor(archived, 'archived'),
  vacancy: pageFor(vacancy, 'vacancy'), lone: pageFor(lone, 'lone') };

async function open(page: Page, url: string, day: string, hash = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(`${day}T12:00:00Z`));
  await page.goto(url + hash);
  return errors;
}
async function skipToResult(page: Page, id = '#result') {
  await page.click('#skip');
  await expect(page.locator(id)).toBeVisible({ timeout: 10_000 });
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('brawl-daily-v1') || '{"days":{}}').days);

test('the opening final replays from Belts and from its link, with a result, a share line and a rematch', async ({ page }) => {
  const errors = await open(page, PAGES.decisive, '2026-10-16', '#belts');
  await page.locator('#history li', { hasText: 'belt opens' }).getByRole('button', { name: '▶ Watch' }).click();
  await skipToResult(page);
  await expect(page.locator('#verdictSub')).toContainText('Fixture 1 wins the opening tournament and the Undisputed belt');
  await expect(page.locator('#share')).toContainText('Undisputed opening final');
  await expect(page.locator('#share')).toContainText('#title=2026-10-14-undisputed');
  await page.click('#rematch');
  await skipToResult(page);
  await expect(page.locator('#verdictSub')).toContainText('wins the opening tournament');
  await page.goto('about:blank');
  await page.goto(`${PAGES.decisive}#title=2026-10-14-undisputed`);
  await skipToResult(page);
  await expect(page.locator('#verdictSub')).toContainText('Fixture 1 wins the opening tournament');
  await expect(page.locator('#share')).toContainText('#title=2026-10-14-undisputed');
  await expect(page.locator('body')).not.toContainText(/\bundefined\b|\bnull\b|NaN/);
  expect(errors).toEqual([]);
});

test('a drawn title fight can be called as a draw, and the champion keeps the belt', async ({ page }) => {
  const errors = await open(page, PAGES.draw, '2026-10-18');
  await expect(page.locator('#callDraw')).toBeVisible();
  await expect(page.locator('#drawNote')).toContainText('the champion keeps the belt, but nobody wins the fight');
  await page.click('#callDraw');
  await expect(page.locator('#callDraw')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#todayFight');
  await skipToResult(page);
  await expect(page.locator('#verdict')).toHaveText('A DRAW');
  await expect(page.locator('#verdictSub')).toContainText('a draw: Fixture 1 keeps the Undisputed belt');
  await expect(page.locator('#yourCall')).toContainText('You called the draw');
  await expect(page.locator('#share')).toContainText('My call: ✅ · 🔥 1');
  expect(Object.values(await saved(page))).toEqual([expect.objectContaining({ pick: 'draw', winner: 'draw', correct: true })]);
  // after a reload: the saved call, the result line, the stats
  await page.goto('about:blank');
  await page.goto(PAGES.draw);
  await expect(page.locator('#doneLine')).toHaveText('IT WAS A DRAW · THE CHAMPION KEEPS THE BELT');
  await expect(page.locator('#doneCall')).toContainText('You called the draw');
  await expect(page.locator('#stats')).toContainText('1Played');
  await expect(page.locator('#stats')).toContainText('100%Called right');
  await expect(page.locator('#streakChip')).toContainText('1-day streak');
  expect(errors).toEqual([]);
});

test('calling the champion on a drawn title fight is a wrong call: keeping the belt is not winning the fight', async ({ page }) => {
  const errors = await open(page, PAGES.draw, '2026-10-18');
  await page.click('#callA');
  await page.click('#todayFight');
  await skipToResult(page);
  await expect(page.locator('#yourCall')).toContainText('Not this time');
  expect(Object.values(await saved(page))).toEqual([expect.objectContaining({ pick: 'fixture-1', winner: 'draw', correct: false })]);
  expect(errors).toEqual([]);
});

test('a decisive title fight: the right call counts, the draw call is wrong', async ({ page }) => {
  const errors = await open(page, PAGES.decisive, '2026-10-18');
  await page.click('#callB');
  await page.click('#todayFight');
  await skipToResult(page);
  await expect(page.locator('#verdict')).toHaveText('ROOKIE WINS');
  await expect(page.locator('#yourCall')).toContainText('You called it');
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  await page.goto(PAGES.decisive);
  await page.click('#callDraw');
  await page.click('#todayFight');
  await skipToResult(page);
  await expect(page.locator('#yourCall')).toContainText('Not this time');
  expect(Object.values(await saved(page))).toEqual([expect.objectContaining({ pick: 'draw', winner: 'rookie', correct: false })]);
  expect(errors).toEqual([]);
});

test('a normal daily brawl offers no draw call', async ({ page }) => {
  const errors = await open(page, PAGES.decisive, '2026-10-17');
  await expect(page.locator('#brawlNo')).not.toContainText('TITLE NIGHT');
  await expect(page.locator('#callA')).toBeVisible();
  await expect(page.locator('#callDraw')).toBeHidden();
  await expect(page.locator('#drawNote')).toBeHidden();
  expect(errors).toEqual([]);
});

test('bad, huge and future brawl links fall back to today, and bad saved records are ignored', async ({ page }) => {
  const tomorrow = brawlNumber(new Date('2026-10-18T12:00:00Z'));
  await page.addInitScript(() => {
    if (!localStorage.getItem('brawl-daily-v1')) localStorage.setItem('brawl-daily-v1', JSON.stringify({ days: {
      999999999: { a: 'x', b: 'y', pick: 'x', winner: 'x', correct: true },
      [`1${'0'.repeat(400)}`]: { a: 'x', b: 'y', pick: 'x', winner: 'x', correct: true },
      '-3': { a: 'x', b: 'y', pick: 'x', winner: 'x', correct: true } } }));
  });
  const cases: [string, RegExp][] = [
    ['#today=999999999', /hasn't happened yet/], [`#today=${'9'.repeat(400)}`, /isn't valid/], ['#today=0', /isn't valid/],
    [`#today=${tomorrow}`, /hasn't happened yet/], // tomorrow's title night is already in the data, but not shown yet
  ];
  for (const [hash, toast] of cases) {
    const errors = await open(page, PAGES.decisive, '2026-10-17', hash);
    await expect(page.locator('#today')).toBeVisible();
    await expect(page.locator('#arena')).toBeHidden();
    await expect(page.locator('#toast')).toHaveText(toast);
    await expect(page.locator('#stats')).toContainText('0Played');
    await expect(page.locator('#streakChip')).toHaveText('🔥 Start a streak');
    expect(errors, hash).toEqual([]);
    await page.goto('about:blank');
  }
});

test('a replay with a fighter who left the roster leaves Free play and Royale working', async ({ page }) => {
  const errors = await open(page, PAGES.archived, '2026-10-18', '#title=2026-10-18-undisputed');
  await expect(page.locator('#n1')).toHaveText('Fixture 1'); // the archived champion, from the title log
  await skipToResult(page);
  await page.click('#tabs [data-tab="play"]');
  await expect(page.locator('#vsLine')).toHaveText('Pick player 1');
  await page.locator('.fighter', { hasText: 'Rookie' }).click();
  await page.locator('.fighter', { hasText: 'Fixture 2' }).click();
  await page.click('#fight');
  await skipToResult(page);
  await expect(page.locator('#verdict')).toHaveText('ROOKIE WINS');
  await page.click('#tabs [data-tab="royale"]');
  await page.locator('.fighter', { hasText: 'Fixture 3' }).click();
  await page.click('#fight');
  await skipToResult(page, '#royaleResult');
  // Today's title fight also uses the archived champion
  await page.click('#tabs [data-tab="today"]');
  await page.click('#justWatch');
  await skipToResult(page);
  await page.click('#tabs [data-tab="royale"]');
  await expect(page.locator('#vsLine')).not.toContainText('Fixture 1');
  await page.locator('.fighter', { hasText: 'Fixture 4' }).click();
  await page.locator('.fighter', { hasText: 'Fixture 5' }).click();
  await page.click('#fight');
  await skipToResult(page, '#royaleResult');
  expect(errors).toEqual([]);
});

test("when the champion leaves, the belt card shows that night's vacant-title fight", async ({ page }) => {
  const [, fight] = vacancy.titles!.events.slice(-2);
  expect(vacancy.titles!.events.slice(-2).map((e) => e.kind)).toEqual(['vacated', 'vacant']);
  if (fight.kind !== 'vacant') throw new Error();
  const errors = await open(page, PAGES.vacancy, '2026-10-18', '#belts');
  const card = page.locator('.beltcard').first();
  await expect(card).toContainText('Next title night: tonight');
  await expect(card).not.toContainText('picked the day before');
  await card.getByRole('button', { name: `${fight.a.name} vs ${fight.b.name}: watch it in Today` }).click();
  await expect(page.locator('#brawlNo')).toContainText('TITLE NIGHT');
  await expect(page.locator('#nmA')).toHaveText(fight.a.name);
  expect(errors).toEqual([]);
});

test('a vacant belt with fewer than two ranked contenders says so in the history', async ({ page }) => {
  expect(lone.titles!.events.at(-1)).toMatchObject({ kind: 'quiet', reason: 'vacant: fewer than two ranked contenders' });
  const errors = await open(page, PAGES.lone, '2026-10-18', '#belts');
  const quiet = page.locator('#history li', { hasText: 'no title fight' }).first();
  await expect(quiet).toContainText('Vacant, and fewer than two ranked contenders are eligible.');
  await expect(quiet).not.toContainText('pairs already met');
  await expect(page.locator('.beltcard').first()).toContainText('No challenger this time');
  expect(errors).toEqual([]);
});
