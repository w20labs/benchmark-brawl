/**
 * Makes the link preview (assets/og.png) and the README screenshots (assets/readme/*.png) from the built page,
 * picking real moments from the current data. Run after `npm run build`:
 *
 *   npx tsx scripts/make-images.ts
 */
import { readFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { planFight } from '../src/fight.ts';
import type { BrawlData } from '../src/types.ts';

const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const PAGE = `file://${process.cwd()}/_site/index.html`;
const ROUNDS = data.defaultRounds;

// A tie where one fighter throws something cheeky and the other something big: fun, and it singles out no lab.
const tie = (() => {
  for (const a of data.models.slice(0, 30)) for (const b of data.models.slice(0, 30)) {
    if (a === b || a.org === b.org) continue;
    const p = planFight(data, a, b, ROUNDS), i = p.rounds.findIndex((R) => R.tieStyles?.includes('meteor') && R.tieStyles.includes('chicken'));
    if (i >= 0) return { a, b, round: i };
  }
  throw new Error('no chicken-vs-meteor tie in the current data');
})();

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#toast{display:none!important}'; document.head.append(s); }));
const page = await ctx.newPage();
const wait = (ms: number) => page.waitForTimeout(ms);

async function atTie(pg: Page, ms = 820) {
  await pg.goto(`${PAGE}#a=${tie.a.id}&b=${tie.b.id}&r=${ROUNDS.join(',')}`);
  await pg.reload();
  await pg.click('#fight');
  await pg.waitForFunction((r) => document.getElementById('roundNo')!.textContent!.startsWith(`ROUND ${r + 1}/`) && /both grazed/.test(document.getElementById('rres')!.textContent!), tie.round, { timeout: 60_000, polling: 16 });
  await pg.waitForTimeout(ms);
}

// 1. The fight: a chicken against a meteor shower
await atTie(page);
await page.locator('#arena').screenshot({ path: 'assets/readme/fight.png' });

// 2. The link preview: the same moment, names hidden (a beat earlier, before the hit flashes white)
await atTie(page, 560);
await page.addStyleTag({ content: '#hud{visibility:hidden}' });
const shot = await page.locator('#arena canvas').screenshot();
const og = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
await og.setContent(`<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@600&display=swap" rel="stylesheet"><style>
body{margin:0;width:1200px;height:630px;background:#0A0C14;color:#F3F4F8;font-family:Inter,sans-serif;overflow:hidden;position:relative}
img{position:absolute;left:0;top:150px;width:1200px;height:550px;object-fit:cover;object-position:center 40%}
.t{position:absolute;left:48px;top:40px;font:400 54px 'Press Start 2P'}.t span{color:#FF6B6B}
.s{position:absolute;left:50px;top:112px;font-size:24px;color:#C9CFDC}
.fade{position:absolute;left:0;right:0;top:150px;height:60px;background:linear-gradient(#0A0C14,rgba(10,12,20,0))}
</style></head><body><img src="data:image/png;base64,${shot.toString('base64')}"><div class="fade"></div>
<div class="t">BENCHMARK <span>BRAWL</span></div><div class="s">Real AI models fight with real benchmark scores. Bigger gap, bigger weapon.</div></body></html>`);
await og.waitForTimeout(1500);
await og.screenshot({ path: 'assets/og.png' });

// 3. Today: the daily brawl, on the day of a scheduled entry
const day = data.daily?.find((e) => e.fighters)?.day;
const today = await ctx.newPage();
if (day) await today.clock.setFixedTime(new Date(`${day}T12:00:00Z`));
await today.goto(PAGE);
await today.waitForTimeout(1200);
await today.click('#callB');
const box = await today.locator('#today').boundingBox();
await today.screenshot({ path: 'assets/readme/today.png', clip: { x: box!.x, y: box!.y, width: box!.width, height: box!.height } });

// 4. A battle royale: one fighter from each of eight labs
const seen = new Set<string>(), eight = data.models.filter((m) => !seen.has(m.org) && seen.add(m.org)).slice(0, 8);
await page.goto(`${PAGE}#m=royale&f=${eight.map((m) => m.id).join(',')}&r=${ROUNDS.join(',')}`);
await page.reload();
await page.click('#fight');
await wait(5200);
await page.locator('#arena').screenshot({ path: 'assets/readme/royale.png' });

// 5. Claim check
await page.goto(`${PAGE}#claims`);
await page.reload();
await wait(600);
const cb = await page.locator('#claims').boundingBox();
await page.screenshot({ path: 'assets/readme/claims.png', clip: { x: cb!.x, y: cb!.y, width: cb!.width, height: Math.min(cb!.height, 760) } });

// 6. The scorecard: every number with its source, setting and margin
await page.goto(`${PAGE}#a=${tie.a.id}&b=${tie.b.id}&r=${ROUNDS.join(',')}`);
await page.reload();
await page.click('#fight');
await page.click('#skip');
await page.waitForSelector('#result:not([hidden])');
await page.click('#numbers summary');
await wait(400);
await page.locator('#numbers').screenshot({ path: 'assets/readme/scorecard.png' });

await b.close();
console.log(`Wrote assets/og.png and assets/readme/{fight,today,royale,claims,scorecard}.png (tie: ${tie.a.name} vs ${tie.b.name})`);
