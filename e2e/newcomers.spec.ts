import { expect, test, type Page } from '@playwright/test';
import { advanceTitles, type TitleLog } from '../src/titles.ts';
import type { BrawlData, Model } from '../src/types.ts';
import { pageFor, preview } from './fixture-page.ts';

// New-challenger announcements, on made-up fighters. Season 2 starts Wed Oct 14 2026 with the opening tournament;
// Sun Oct 18 is the first title night. Newbie (strong) and Lowbie (eligible, not a top contender) join the roster on
// Fri Oct 16; Oldie joined long before. Each page's title log runs one day past its clock, as the daily build's does.
const S = (v: number) => ({ v, se: 0.5, setting: 'high' });
const model = (name: string, eci: number, v: number, released = '2026-06-01'): Model =>
  ({ id: name.toLowerCase().replace(/ /g, '-'), name, org: `${name} Lab`, released, open: false, eci, price: null,
    scores: Object.fromEntries(['swebench', 'frontiermath', 'gpqa', 'simpleqa', 'mystery'].map((b) => [b, S(v)])) });
const eight = Array.from({ length: 8 }, (_, i) => model(`Fixture ${i + 1}`, 150 - i, 80 - 5 * i));
const oldie = model('Oldie', 90, 40), newbie = model('Newbie', 200, 95, '2026-10-01'), lowbie = model('Lowbie', 100, 50, '2026-10-02');
const START = '2026-10-14', ARRIVED = '2026-10-16';
const before = [...eight, oldie], after = [...before, newbie, lowbie];
const arrivals = { since: '2026-09-20', seen: { ...Object.fromEntries(eight.map((m) => [m.id, null])), oldie: '2026-10-01', newbie: ARRIVED, lowbie: ARRIVED } };
const data = (over: Partial<BrawlData>): BrawlData => ({ ...preview, models: after, claims: [], daily: [], seasonStart: START, arrivals, ...over });
const next = (day: string) => new Date(Date.parse(day) + 864e5).toISOString().slice(0, 10);
/** The title log as the daily build would have it on `clock`: the roster before the arrivals until Oct 15, then after. */
function logOn(clock: string): TitleLog {
  const empty = { through: null, events: [] };
  const upTo15 = advanceTitles({ ...preview, models: before, claims: [] }, empty, '2026-10-15', START);
  return advanceTitles({ ...preview, models: after, claims: [] }, upTo15, next(clock), START);
}
const pages = new Map<string, string>();
/** A page for `clock`, built once per worker. */
function pageOn(clock: string, over: Partial<BrawlData> = {}, tag = 'on') {
  const key = `${tag}-${clock}`;
  if (!pages.has(key)) pages.set(key, pageFor(data({ titles: logOn(clock), ...over }), `newcomers-${key}`));
  return pages.get(key)!;
}

async function open(page: Page, url: string, day: string, hash = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(`${day}T12:00:00Z`));
  await page.goto(url + hash);
  return errors;
}
const card = (page: Page, name: string) => page.locator('#newcomers .newcomer', { hasText: `${name} enters the arena` });

test('on its arrival day, a new fighter is announced with its sourced scores, and no title shot is promised yet', async ({ page }) => {
  const errors = await open(page, pageOn(ARRIVED), ARRIVED);
  await expect(page.locator('#newcomers .newcomer')).toHaveCount(2);
  await expect(page.locator('#newcomers h3').first()).toHaveText('🆕 NEW CHALLENGER: Lowbie enters the arena'); // same day: by id
  const nb = card(page, 'Newbie');
  await expect(nb).toContainText('Newbie Lab · closed weights · rounds: Coding, Math, Science, Facts, Puzzles');
  await nb.getByText('Sourced scores').click();
  await expect(nb).toContainText('GPQA Diamond 95.0 high setting · ±1.0');
  await expect(nb.getByRole('link', { name: 'GPQA Diamond' })).toHaveAttribute('rel', 'noopener');
  expect(await nb.getByRole('link').evaluateAll((as) => as.every((a) => (a as HTMLAnchorElement).protocol === 'https:'))).toBe(true);
  await expect(nb).not.toContainText('Title shot'); // eligible and strong, but Sunday isn't booked yet
  await expect(page.locator('#newcomers')).not.toContainText('Oldie');
  expect(errors).toEqual([]);
});

test('a title shot is announced only once the title log has booked it, and only for the booked fighter', async ({ page }) => {
  const errors = await open(page, pageOn('2026-10-17'), '2026-10-17');
  await expect(card(page, 'Newbie').locator('.shot')).toHaveText('🏅 Title shot: Oct 18, 2026 vs Fixture 1 for the Undisputed belt.');
  await expect(card(page, 'Lowbie')).not.toContainText('Title shot'); // eligible, never booked
  await expect(page.locator('body')).not.toContainText(/NEWBIE WINS|FIXTURE 1 WINS|new Undisputed champion/); // no result before the night
  expect(errors).toEqual([]);
});

test('title night labels the new challenger in Today, the share line and the history', async ({ page }) => {
  const errors = await open(page, pageOn('2026-10-18'), '2026-10-18');
  await expect(card(page, 'Newbie').locator('.shot')).toHaveText('🏅 Title shot: Oct 18, 2026 (tonight) vs Fixture 1 for the Undisputed belt.');
  await expect(page.locator('#brawlNo')).toContainText('TITLE NIGHT');
  await expect(page.locator('#tagA')).toHaveText('CHAMPION');
  await expect(page.locator('#tagB')).toHaveText('🆕 NEW CHALLENGER');
  await expect(page.locator('#nmB')).toHaveText('Newbie');
  await page.click('#justWatch');
  await page.click('#skip');
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#share')).toContainText('🏅 Undisputed title night · 🆕 new challenger');
  await page.click('#tabs [data-tab="belts"]');
  const row = page.locator('#history li', { hasText: 'Fixture 1 vs 🆕 Newbie' });
  await expect(row).toContainText('Undisputed · new challenger');
  await row.getByRole('button', { name: '▶ Watch' }).click();
  await page.click('#skip');
  await expect(page.locator('#share')).toContainText('Fixture 1 vs Newbie (🆕 new challenger)');
  expect(errors).toEqual([]);
});

test('the announcement lasts seven UTC days', async ({ page }) => {
  await open(page, pageOn('2026-10-22'), '2026-10-22');
  await expect(card(page, 'Newbie')).toBeVisible();
  await expect(card(page, 'Newbie')).not.toContainText('Title shot'); // its fight is past: in the history now
  await page.goto('about:blank');
  await open(page, pageOn('2026-10-23'), '2026-10-23');
  await expect(page.locator('#newcomers')).toBeHidden();
});

const SAME_TODAY = ['#brawlNo', '#tagA', '#nmA', '#tagB', '#nmB', '#roundsToday'];
for (const [what, over] of [['with no start date', { seasonStart: null }], ['before the start date', { seasonStart: '2026-10-20' }]] as const) {
  test(`Season 2 off (${what}): no announcement, label or belt, and Today is as without any of it`, async ({ page }) => {
    const plain = pageFor(data({ titles: undefined, arrivals: undefined, seasonStart: null }), 'newcomers-plain');
    const errors = await open(page, plain, '2026-10-18');
    const expected = await Promise.all(SAME_TODAY.map((s) => page.locator(s).innerText()));
    await page.goto('about:blank');
    // the data holds arrivals and a booked title night with a new challenger; none of it may show
    await open(page, pageOn('2026-10-18', over, what.replace(/ /g, '-')), '2026-10-18');
    await expect(page.locator('#newcomers')).toBeHidden();
    await expect(page.locator('#tabs [data-tab="belts"]')).toBeHidden();
    await expect(page.locator('#callDraw')).toBeHidden();
    await expect(page.locator('body')).not.toContainText(/NEW CHALLENGER|TITLE NIGHT|Overfit FC title/);
    expect(await Promise.all(SAME_TODAY.map((s) => page.locator(s).innerText()))).toEqual(expected);
    await page.click('#justWatch');
    await page.click('#skip');
    await expect(page.locator('#share')).not.toContainText(/new challenger|title night/);
    expect(errors).toEqual([]);
  });
}

test('only genuine arrivals are announced: not fighters already on the roster, nor one whose first arrival is past', async ({ page }) => {
  // Fixture 1–8 were on the roster when tracking began (null); Oldie first arrived Oct 1 (as after leaving and coming back)
  await open(page, pageOn('2026-10-17'), '2026-10-17');
  await expect(page.locator('#newcomers h3')).toHaveText(['🆕 NEW CHALLENGER: Lowbie enters the arena', '🆕 NEW CHALLENGER: Newbie enters the arena']);
});

for (const width of [1280, 390, 320]) {
  test(`the announcement fits and works by keyboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await open(page, pageOn('2026-10-17'), '2026-10-17');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    const summary = card(page, 'Newbie').locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter'); // opens the sourced scores
    const link = card(page, 'Newbie').getByRole('link').first();
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    const box = await card(page, 'Newbie').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}
