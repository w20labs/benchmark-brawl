/**
 * A local preview of Season 2 (Overfit FC): plays the title log over the current roster from a start date in the
 * past, then builds the page into _preview/. Nothing here is published; the live data and site are untouched.
 *
 *   npm run preview:season -- [start, default 2026-08-02] [through, default tomorrow]
 *
 * The browser tests use a fixed range (see .github/workflows/ci.yml) and set the page's clock, so they don't depend on today.
 *
 * The preview switches the season on for its own page only (BRAWL_SEASON_START), never in SEASON_START. Arrivals
 * are a preview stand-in: a fighter released after the start "arrives" on its release day (the real build records the
 * day it first sees a fighter, which can be later); the rest count as already on the roster.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { advanceTitles, TITLE_LOOKAHEAD_DAYS } from '../src/titles.ts';
import type { BrawlData } from '../src/types.ts';

const start = process.argv[2] || '2026-08-02';
const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const through = process.argv[3] || new Date(Date.now() + TITLE_LOOKAHEAD_DAYS * 864e5).toISOString().slice(0, 10);
data.seasonStart = start;
data.arrivals = { since: start, seen: Object.fromEntries(data.models.map((m) => [m.id, m.released > start ? m.released : null])) };
data.titles = advanceTitles(data, { through: null, events: [] }, through, start);
mkdirSync('_preview', { recursive: true });
writeFileSync('_preview/brawl.json', JSON.stringify(data));
execFileSync('npx', ['tsx', 'scripts/build-site.ts'], { stdio: 'inherit', env: { ...process.env, BRAWL_DATA: '_preview/brawl.json', BRAWL_OUT: '_preview', BRAWL_SEASON_START: start } });
const n = (k: string) => data.titles!.events.filter((e) => e.kind === k).length;
console.log(`Season 2 preview from ${start}: ${n('opening')} openings, ${n('title')} title fights, ${n('vacant')} vacant-title fights, ${n('quiet')} quiet nights. Open _preview/index.html`);
