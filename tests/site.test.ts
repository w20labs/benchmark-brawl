// Runs the real site build on saved data, as the deploy does after a failed refresh, to check where Season 2's start comes from.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pageSeasonStart, SEASON_START } from '../src/titles.ts';

const ROOT = resolve('.'), TSX = join(ROOT, 'node_modules/.bin/tsx');
/** Saved data from a build that had the season on: a start day, a title log and an arrival. */
const saved = () => {
  const d = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
  return { ...d, seasonStart: '2026-08-02', titles: { through: '2026-08-02', events: [{ kind: 'quiet', belt: 'undisputed', day: '2026-08-02', rules: 'v1.1', dataDate: '2026-08-02', eligible: [], reason: 'test' }] },
    arrivals: { since: '2026-08-01', seen: { [d.models[0].id]: '2026-08-02' } } };
};
function buildSite(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brawl-site-')), file = join(dir, 'saved.json');
  writeFileSync(file, JSON.stringify(saved()));
  const run = spawnSync(TSX, [join(ROOT, 'scripts/build-site.ts')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, BRAWL_DATA: file, BRAWL_OUT: join(dir, 'out'), ...env } });
  if (run.status !== 0) return { ok: false, log: run.stdout + run.stderr, data: null };
  const html = readFileSync(join(dir, 'out/index.html'), 'utf8');
  const json = html.match(/<script type="application\/json" id="brawl-data">([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, '<');
  return { ok: true, log: '', data: JSON.parse(json) };
}

describe('the site build', { timeout: 60_000 }, () => {
  it("takes Season 2's start from the code, not from saved data", () => {
    // a failed refresh deploys the saved data: its start day must not switch the season on
    const site = buildSite();
    expect(site.ok, site.log).toBe(true);
    expect(SEASON_START).toBeNull();
    expect(site.data.seasonStart).toBeNull();
  });

  it('lets a local preview set the start, later or off, explicitly', () => {
    expect(buildSite({ BRAWL_SEASON_START: '2026-11-01' }).data.seasonStart).toBe('2026-11-01'); // postponed past the saved day
    expect(buildSite({ BRAWL_SEASON_START: '' }).data.seasonStart).toBeNull();
    const bad = buildSite({ BRAWL_SEASON_START: 'soon' });
    expect(bad.ok).toBe(false);
    expect(bad.log).toMatch(/BRAWL_SEASON_START must be YYYY-MM-DD/);
  });

  it('reads the override strictly', () => {
    expect(pageSeasonStart()).toBe(SEASON_START);
    expect(pageSeasonStart('2026-10-17')).toBe('2026-10-17');
    expect(pageSeasonStart('')).toBeNull();
    expect(() => pageSeasonStart('2026-13-45')).toThrow();
    expect(() => pageSeasonStart('17/10/2026')).toThrow();
    expect(() => pageSeasonStart('2026-02-30')).toThrow(); // would roll over to Mar 2
    expect(() => pageSeasonStart('2025-02-29')).toThrow(); // not a leap year
    expect(pageSeasonStart('2028-02-29')).toBe('2028-02-29'); // a leap year
    expect(pageSeasonStart('2026-12-31')).toBe('2026-12-31');
  });
});
