// Makes assets/og.png, the link preview: a laser moment from a real fight, names hidden so no lab is singled out.
// Run after `npm run build`: node scripts/make-og.mjs
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage();
await pg.goto(`file://${process.cwd()}/_site/index.html#a=gpt6astra&b=deepseekv4flash0731&r=coding,math,puzzles`);
await pg.waitForTimeout(500);
await pg.click('#fight');
await pg.addStyleTag({ content: '#hud{visibility:hidden}' });
await pg.waitForFunction(() => document.getElementById('rres').textContent.startsWith('ORBITAL LASER'), null, { timeout: 30000, polling: 16 });
await pg.waitForTimeout(1420);
const shot = await pg.locator('#arena canvas').screenshot();
const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@600&display=swap" rel="stylesheet"><style>
body{margin:0;width:1200px;height:630px;background:#0A0C14;color:#F3F4F8;font-family:Inter,sans-serif;overflow:hidden;position:relative}
img{position:absolute;left:0;top:150px;width:1200px;height:550px;object-fit:cover;object-position:center 40%}
.t{position:absolute;left:48px;top:40px;font:400 54px 'Press Start 2P'}.t span{color:#FF6B6B}
.s{position:absolute;left:50px;top:112px;font-size:24px;color:#C9CFDC}
.fade{position:absolute;left:0;right:0;top:150px;height:60px;background:linear-gradient(#0A0C14,rgba(10,12,20,0))}
</style></head><body><img src="data:image/png;base64,${shot.toString('base64')}"><div class="fade"></div>
<div class="t">BENCHMARK <span>BRAWL</span></div><div class="s">Real AI models fight with real benchmark scores. Bigger gap, bigger weapon.</div></body></html>`;
const og = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
await og.setContent(html);
await og.waitForTimeout(1500);
await og.screenshot({ path: 'assets/og.png' });
await b.close();
console.log('Wrote assets/og.png');
