import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { brawlNumber } from '../src/league.ts';
import { beltName, fightersOf, type TitleEvent } from '../src/titles.ts';
import type { BrawlData } from '../src/types.ts';

// Season 2 is off on the real site; these run against the local preview (npm run preview:season -- 2026-08-02 2026-11-29)
const SITE = `file://${resolve('_site/index.html')}`, PREVIEW = `file://${resolve('_preview/index.html')}`;
const preview: BrawlData = JSON.parse(readFileSync('_preview/brawl.json', 'utf8'));
const events = preview.titles!.events;
// a title night after Brawl #1, and the day after it
const night = events.find((e) => fightersOf(e) && e.day >= '2026-10-13')! as Extract<TitleEvent, { kind: 'title' | 'vacant' }>;
const at = (day: string) => new Date(`${day}T12:00:00Z`);
const next = (day: string) => new Date(Date.parse(day) + 864e5).toISOString().slice(0, 10);
async function open(page: Page, day: string, hash = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.clock.setFixedTime(at(day));
  await page.goto(PREVIEW + hash);
  return errors;
}

test('the live site has no Belts tab while Season 2 is off, and #belts falls back to Today', async ({ page }) => {
  await page.goto(`${SITE}#belts`);
  await expect(page.locator('#tabs [data-tab="belts"]')).toBeHidden();
  await expect(page.locator('#today')).toBeVisible();
});

test('Belts shows each champion and the history up to today, never later', async ({ page }) => {
  const day = night.day, errors = await open(page, day, '#belts');
  await expect(page.locator('#belts')).toBeVisible();
  const shown = events.filter((e) => e.day <= day);
  const opened = new Set(shown.filter((e) => e.kind === 'opening').map((e) => e.belt));
  await expect(page.locator('.beltcard')).toHaveCount(opened.size);
  await expect(page.locator('#history li')).toHaveCount(shown.length);
  // tomorrow's recorded fight (the build records a day ahead) is not in the history
  await expect(page.locator('#history')).not.toContainText(new Date(at(next(day))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }));
  await page.click('#historyFilter button:has-text("Undisputed")');
  await expect(page.locator('#history li')).toHaveCount(shown.filter((e) => e.belt === 'undisputed').length);
  await expect(page.locator('body')).not.toContainText(/\bnull\b|\bundefined\b|NaN/);
  expect(errors).toEqual([]);
});

test('a recorded title fight replays from its saved scores, with a link that replays it again', async ({ page }) => {
  const errors = await open(page, night.day, '#belts');
  const [a, b] = fightersOf(night)!;
  await page.locator('#history li', { hasText: `${a.name} vs ${b.name}` }).getByRole('button', { name: '▶ Watch' }).click();
  await page.click('#skip');
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#verdictSub')).toContainText(beltName(night.belt));
  await expect(page.locator('#share')).toContainText(`#title=${night.day}-${night.belt}`);
  expect(page.url()).toContain(`#title=${night.day}-${night.belt}`);
  await page.goto('about:blank');
  await page.goto(`${PREVIEW}#title=${night.day}-${night.belt}`);
  await expect(page.locator('#arena')).toBeVisible();
  await expect(page.locator('#n1')).toHaveText(a.name);
  expect(errors).toEqual([]);
});

test('on title night, Today is the title fight, and it counts for the streak', async ({ page }) => {
  const errors = await open(page, night.day);
  const [a, b] = fightersOf(night)!, no = brawlNumber(at(night.day));
  await expect(page.locator('#brawlNo')).toContainText('TITLE NIGHT');
  await expect(page.locator('#brawlNo')).toContainText(`#${no}`);
  await expect(page.locator('#nmA')).toHaveText(a.name);
  await expect(page.locator('#nmB')).toHaveText(b.name);
  await expect(page.locator('#roundsToday')).toContainText(`${beltName(night.belt)} belt`);
  await page.click('#callA');
  await page.click('#todayFight');
  await page.click('#skip');
  await expect(page.locator('#result')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#share')).toContainText(`Benchmark Brawl #${no} 🏅 ${beltName(night.belt)} title night`);
  // the next day: yesterday's title night is a valid record, and its link replays the title fight
  await page.clock.setFixedTime(at(next(night.day)));
  await page.goto('about:blank');
  await page.goto(PREVIEW);
  await expect(page.locator('#stats')).toContainText('1Played');
  await page.goto('about:blank');
  await page.goto(`${PREVIEW}#today=${no}`);
  await expect(page.locator('#arena')).toBeVisible();
  await expect(page.locator('#n1')).toHaveText(a.name);
  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 320, height: 700 } });
  test('Belts and title night fit a small phone', async ({ page }) => {
    await open(page, night.day, '#belts');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.click('#tabs [data-tab="today"]');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});
