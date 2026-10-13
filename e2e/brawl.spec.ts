import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { planFight } from '../src/fight.ts';
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
