/** Real frames from the built game for the Season 2 mock: one per round of a title fight, plus fighter portraits. */
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { planFight } from '../../src/fight.ts';
import type { BrawlData } from '../../src/types.ts';
const PAGE = `file://${process.cwd()}/_site/index.html`, OUT = 'prototypes/season2/shots';
mkdirSync(OUT, { recursive: true });
const R = 'coding,math,science,facts,puzzles';
const bt = JSON.parse(readFileSync('prototypes/season2/backtest.json', 'utf8'));
const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const byId = (id: string) => data.models.find((m) => m.id === id)!;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(() => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#toast{display:none!important}'; document.head.append(s); }));
const page = await ctx.newPage();
const open = async (a: string, c: string) => { await page.goto(`${PAGE}#a=${a}&b=${c}&r=${R}`); await page.reload(); await page.waitForTimeout(700); };

// the featured title fight: every round at its hit
const [a, c, tag] = process.argv.slice(2);
if (a !== '-') {
const plan = planFight(data, byId(a), byId(c), R.split(','));
await open(a, c);
await page.click('#fight');
await page.waitForTimeout(900);
await page.locator('#arena').screenshot({ path: `${OUT}/${tag}-0.png` });
for (let r = 1; r <= 5; r++) {
  try {
    // after the hit lands: both HP readouts show the round's result
    const hp = plan.rounds[r - 1]?.hpAfter;
    if (!hp) break;
    await page.waitForFunction(([r, h1, h2]) => document.getElementById('roundNo')!.textContent!.startsWith(`ROUND ${r}/`)
      && document.getElementById('hn1')!.textContent === `${h1} HP` && document.getElementById('hn2')!.textContent === `${h2} HP`, [r, ...hp], { timeout: 60_000, polling: 16 });
  } catch { break; }
  await page.waitForTimeout(250);
  await page.locator('#arena').screenshot({ path: `${OUT}/${tag}-${r}.png` });
}
await page.waitForSelector('#result:not([hidden])', { timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(1500);
}
if (a !== '-') await page.locator('#result').screenshot({ path: `${OUT}/${tag}-end.png` }).catch((e) => console.warn(e.message));

// portraits: each champion and challenger at the start of a fight, left side
const ids = [...new Set([...(a === '-' ? [] : Object.values(bt.champions) as string[]), ...process.argv.slice(5)])];
for (const id of ids) {
  const other = id === 'gpt6astra' ? 'claudefable5' : 'gpt6astra';
  await open(id, other);
  await page.click('#fight');
  await page.waitForTimeout(900);
  const box = (await page.locator('#arena').boundingBox())!;
  await page.screenshot({ path: `${OUT}/p-${id}.png`, clip: { x: box.x + box.width * 0.19, y: box.y + box.height * 0.3, width: box.width * 0.22, height: box.height * 0.45 } });
}
await b.close();
console.log('done');
