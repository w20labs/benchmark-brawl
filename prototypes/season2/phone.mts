import { chromium } from '@playwright/test';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 320, height: 800 } });
await p.goto(`file://${process.cwd()}/prototypes/season2/overfit-fc-mock.html`); await p.waitForTimeout(500);
await p.click('#t-fight'); for (let i = 0; i < 3; i++) await p.click('#nextBtn');
const st = await p.evaluate(() => { const e = document.getElementById('cwStatus')!; return { text: e.innerText, fits: e.scrollWidth <= e.clientWidth, over: document.documentElement.scrollWidth - innerWidth }; });
console.log(st);
await p.locator('.cw').screenshot({ path: process.argv[2] });
await b.close();
