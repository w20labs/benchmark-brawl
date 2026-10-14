import { chromium } from '@playwright/test';
const url = `file://${process.cwd()}/prototypes/season2/overfit-fc-mock.html`;
const out = process.argv[2];
const b = await chromium.launch();
for (const [w, tag] of [[1280, 'd'], [390, 'm']] as const) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  const errs: string[] = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(url); await p.waitForTimeout(800);
  for (const t of ['belts', 'fight', 'history', 'challenger', 'proof']) {
    await p.click(`#t-${t}`); await p.waitForTimeout(250);
    if (t === 'fight') { for (let i = 0; i < 5; i++) await p.click('#nextBtn'); await p.waitForTimeout(200); }
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await p.screenshot({ path: `${out}/s2-${tag}-${t}.png`, fullPage: tag === 'd' || t === 'belts' });
    console.log(tag, t, 'overflow', over);
  }
  console.log(tag, 'errors', errs);
}
await b.close();
