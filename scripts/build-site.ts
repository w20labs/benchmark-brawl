/**
 * Builds the static site into _site/: one HTML page with the data and the bundled script inlined.
 *
 *   npm run build -- [public URL]    e.g. https://w20labs.github.io/benchmark-brawl/
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { pageSeasonStart } from '../src/titles.ts';

const siteUrl = process.argv[2] || '';
/** Anonymous, cookie-free visit counts for the published site (dashboard: benchmark-brawl.goatcounter.com). */
const GOATCOUNTER = 'https://benchmark-brawl.goatcounter.com/count';
/** BRAWL_DATA and BRAWL_OUT let the Season 2 preview build from its own data into its own folder. */
const OUT = process.env.BRAWL_OUT || '_site';

// The page carries the last 30 days of daily brawls (for replay links) and tomorrow's (so a page built before
// midnight UTC still has the next day's fight), but no further: no peeking at future matchups, and a smaller page.
const full = JSON.parse(readFileSync(process.env.BRAWL_DATA || 'data/brawl.json', 'utf8'));
const today = Date.now(), dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Season 2's start comes from this code, never from the data: the data may be older than the code (a failed refresh
// deploys the last good data), and must not switch the season on. Local previews set BRAWL_SEASON_START.
full.seasonStart = pageSeasonStart(process.env.BRAWL_SEASON_START);
full.daily = (full.daily ?? []).filter((e: { day: string }) => e.day >= dayOf(today - 30 * 864e5) && e.day <= dayOf(today + 864e5));
const data = JSON.stringify(full);
const template = readFileSync('src/page/index.html', 'utf8');
const bundle = await build({ entryPoints: ['src/page/main.js'], bundle: true, format: 'iife', target: 'es2022', minify: true, write: false });
const js = bundle.outputFiles[0].text;

// The template starts with <title>, font links and <style>: those go in <head>.
const split = template.indexOf('<div class="wrap">');
const head = template.slice(0, split), body = template.slice(split);
/** JSON and JS inside <script> must not contain "</script" or "<!--". */
const safe = (s: string) => s.replace(/</g, '\\u003c');
const desc = 'Real AI models fight with real benchmark scores. Every round is a benchmark; the bigger the gap, the bigger the weapon.';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const ogImage = siteUrl ? new URL('og.png', siteUrl).href : '';
const favicon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0A0C14"/><text x="16" y="23" font-size="18" text-anchor="middle">🥊</text></svg>')}`;

const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0A0C14">
${siteUrl ? `<meta name="brawl-url" content="${esc(siteUrl)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Benchmark Brawl">
<meta property="og:title" content="Benchmark Brawl: AI models fight with real benchmark scores">
<meta property="og:description" content="${esc(desc)}">
${siteUrl ? `<meta property="og:url" content="${esc(siteUrl)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${favicon}">
${head}
</head>
<body>
${body}
<script type="application/json" id="brawl-data">${safe(data)}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
${siteUrl ? `<script data-goatcounter="${GOATCOUNTER}" async src="https://gc.zgo.at/count.js"></script>` : ''}
</body>
</html>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/index.html`, doc);
if (existsSync('assets/og.png')) copyFileSync('assets/og.png', `${OUT}/og.png`);
const models = (JSON.parse(data) as { models: unknown[] }).models.length;
console.log(`Wrote ${OUT}/index.html: ${models} fighters, ${(doc.length / 1024).toFixed(0)} KB`);
