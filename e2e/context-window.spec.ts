import { expect, test, type Page } from '@playwright/test';
import { advanceTitles } from '../src/titles.ts';
import type { BrawlData, Model } from '../src/types.ts';
import { pageFor, preview } from './fixture-page.ts';

// The Context Window (visual only): the frame and arena of Season 2 title fights, on made-up fighters. Season 2
// starts Wed Oct 14 2026 (opening tournament); Rookie arrives for Sun Oct 18, the first title night.
const S = (v: number) => ({ v, se: 0.5, setting: 'high' });
const model = (name: string, eci: number, v: number, released = '2026-06-01'): Model =>
  ({ id: name.toLowerCase().replace(/ /g, '-'), name, org: `${name} Lab`, released, open: false, eci, price: null,
    scores: Object.fromEntries(['swebench', 'frontiermath', 'gpqa', 'simpleqa', 'mystery'].map((b) => [b, S(v)])) });
const eight = Array.from({ length: 8 }, (_, i) => model(`Fixture ${i + 1}`, 150 - i, 80 - 5 * i));
const rookie = model('Rookie', 200, 95, '2026-10-17');
const base = { ...preview, models: [...eight, rookie], claims: [], daily: [], arrivals: undefined };
const titles = advanceTitles({ ...base, models: eight }, advanceTitles({ ...base, models: eight }, { through: null, events: [] }, '2026-10-16', '2026-10-14'), '2026-10-16', '2026-10-14');
const log = advanceTitles(base, titles, '2026-10-19', '2026-10-14');
const on = (start: string | null, name: string) => pageFor({ ...base, seasonStart: start, titles: log } as BrawlData, `cw-${name}`);
const PAGES = { on: on('2026-10-14', 'on'), off: on(null, 'off'), later: on('2026-10-25', 'later') };

async function open(page: Page, url: string, day: string, hash = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(`${day}T12:00:00Z`));
  await page.goto(url + hash);
  return errors;
}
const stageBar = (page: Page) => page.locator('#today .stage .cw-bar'), arenaBar = (page: Page) => page.locator('#arena .cw-bar');

test('title night: Today and the fight sit in the Context Window, with the matchup on the tab, never a token count', async ({ page }) => {
  const errors = await open(page, PAGES.on, '2026-10-18');
  await expect(stageBar(page)).toBeVisible();
  await expect(stageBar(page).locator('.cw-tab')).toHaveText('Undisputed title fight · Fixture 1 vs Rookie');
  await page.click('#justWatch');
  await expect(arenaBar(page)).toBeVisible();
  await expect(arenaBar(page)).not.toContainText(/token/i);
  // the HUD sits below the frame, not under it
  const bar = (await arenaBar(page).boundingBox())!, hud = (await page.locator('#hud').boundingBox())!;
  expect(hud.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  await page.click('#skip');
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('replays from Belts use it too, with the opening final named as such', async ({ page }) => {
  const errors = await open(page, PAGES.on, '2026-10-18', '#belts');
  await page.locator('#history li', { hasText: 'belt opens' }).getByRole('button', { name: '▶ Watch' }).click();
  await expect(arenaBar(page).locator('.cw-tab')).toHaveText(/^Undisputed opening final · /);
  await page.click('#skip');
  await page.click('#rematch');
  await expect(arenaBar(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('ordinary fights never do: a normal daily brawl, Free play and Royale', async ({ page }) => {
  const errors = await open(page, PAGES.on, '2026-10-17'); // not a title night
  await expect(stageBar(page)).toBeHidden();
  const daily = [await page.locator('#nmA').innerText(), await page.locator('#nmB').innerText()];
  const others = [...eight, rookie].map((m) => m.name).filter((n) => !daily.includes(n)); // Free play starts with today's pair picked
  await page.click('#justWatch');
  await expect(arenaBar(page)).toBeHidden();
  await page.click('#skip');
  await page.click('#tabs [data-tab="play"]');
  await page.locator('.fighter', { hasText: others[0] }).click(); // replaces today's second pick
  await page.click('#fight');
  await expect(arenaBar(page)).toBeHidden();
  await expect(page.locator('#arena')).not.toHaveClass(/\bcw\b/);
  await page.click('#skip');
  await page.click('#tabs [data-tab="royale"]');
  await page.locator('.fighter', { hasText: others[1] }).click();
  await page.click('#fight');
  await expect(arenaBar(page)).toBeHidden();
  expect(errors).toEqual([]);
});

for (const [what, url] of [['with no start date', 'off'], ['before the start date', 'later']] as const) {
  test(`Season 2 off (${what}): no frame anywhere, even on a recorded title night`, async ({ page }) => {
    const errors = await open(page, PAGES[url], '2026-10-18');
    await expect(stageBar(page)).toBeHidden();
    await expect(page.locator('#today .stage')).not.toHaveClass(/\bcw\b/);
    await page.click('#justWatch');
    await expect(arenaBar(page)).toBeHidden();
    expect(errors).toEqual([]);
  });
}

for (const width of [1280, 390, 320]) {
  test(`the frame fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await open(page, PAGES.on, '2026-10-18');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.click('#justWatch');
    const bar = (await arenaBar(page).boundingBox())!;
    expect(bar.x + bar.width).toBeLessThanOrEqual(width);
    await expect(arenaBar(page).locator('.cw-url')).toBeVisible({ visible: width > 420 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    expect(errors).toEqual([]);
  });
}
