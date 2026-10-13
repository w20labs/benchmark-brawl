import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
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

test('home shows the arena builder, weight classes and the roster', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(URL);
  await expect(page.locator('.fighter')).toHaveCount(data.models.length);
  await expect(page.locator('#roundChips .chip[aria-pressed="true"]')).toHaveCount(data.defaultRounds.length);
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
  await expect(page.locator('#rows tr')).toHaveCount(5);
  await expect(page.locator('#rows a').first()).toHaveAttribute('href', /^https:/);
  await expect(page.locator('#share')).toContainText(`#a=${first.id}&b=${second.id}`);
  expect(errors).toEqual([]);
});

test('an arena keeps at least three rounds', async ({ page }) => {
  await page.goto(`${URL}#r=coding,math,science`);
  await page.locator('#roundChips .chip[aria-pressed="true"]').first().click();
  await expect(page.locator('#toast')).toContainText('at least 3');
  await expect(page.locator('#roundChips .chip[aria-pressed="true"]')).toHaveCount(3);
});

test('a tournament crowns a champion and can replay the final', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(URL);
  await page.click('#tourneyBtn');
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
  await page.getByRole('button', { name: /Battle royale/ }).click();
  await page.click('#fillTop');
  await expect(page.locator('#vsLine')).toContainText('8/8');
  await page.click('#fight');
  await expect(page.locator('#board .bf')).toHaveCount(8);
  await page.click('#skip');
  await expect(page.locator('#royaleResult')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#rrows tr')).toHaveCount(8);
  await expect(page.locator('#rshare')).toContainText('#m=royale&f=');
  expect(errors).toEqual([]);
});
