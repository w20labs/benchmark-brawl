import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCoverage, checkModelsDev, daysApart, isWebUrl, num, requireColumns, sameVersion } from '../scripts/validate.ts';
import type { BrawlData } from '../src/types.ts';

const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const clone = (): BrawlData => JSON.parse(JSON.stringify(data));

describe('data build checks', () => {
  it('treats a blank cell as missing, not 0%', () => {
    expect(num('')).toBeNull();
    expect(num('  ')).toBeNull();
    expect(num('abc')).toBeNull();
    expect(num('0')).toBe(0);
    expect(num('0.906')).toBe(0.906);
  });
  it('fails on a renamed or missing column', () => {
    expect(() => requireColumns([{ 'Model ID': 'x', mean_score: '1' }], ['Model version', 'mean_score'], 'gpqa_diamond.csv')).toThrow(/Model version/);
    expect(() => requireColumns([], ['Model version'], 'x.csv')).toThrow(/no rows/);
  });
  it('fails when models.dev changes shape', () => {
    // a small stand-in for models.dev: 6 providers with 10 priced models each
    const md = Object.fromEntries(Array.from({ length: 6 }, (_, p) => [`lab${p}`, { models: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`m${i}`, { name: `M${i}`, cost: { input: 1, output: 4 } }])) }]));
    expect(() => checkModelsDev(md)).not.toThrow();
    expect(() => checkModelsDev({ providers: md })).toThrow(/unexpected shape/);
    expect(() => checkModelsDev([])).toThrow();
  });
  it('refuses to publish when a round, prices or claims collapse', () => {
    expect(() => checkCoverage(data, data, data.defaultRounds)).not.toThrow();
    const noScience = clone(); for (const m of noScience.models) delete m.scores.gpqa;
    expect(() => checkCoverage(noScience, data, data.defaultRounds)).toThrow(/science/);
    const noPrices = clone(); for (const m of noPrices.models) m.price = null;
    expect(() => checkCoverage(noPrices, data, data.defaultRounds)).toThrow(/price/);
    const fewer = clone(); fewer.models = fewer.models.slice(0, 30);
    expect(() => checkCoverage(fewer, data, data.defaultRounds)).toThrow(/roster/);
  });
  it('only allows web links as sources', () => {
    expect(isWebUrl('https://epoch.ai/benchmarks')).toBe(true);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('data:text/html,hi')).toBe(false);
    expect(isWebUrl('not a url')).toBe(false);
  });
  it('matches benchmark versions loosely, but not different ones', () => {
    expect(sameVersion('1.1', '1.1')).toBe(true);
    expect(sameVersion('v2', 'v2')).toBe(true);
    expect(sameVersion(null, '1.1')).toBe(true);
    expect(sameVersion('99.0', '1.1')).toBe(false);
    expect(sameVersion('version not stated', 'v2')).toBe(false);
  });
  it('compares release dates, including month-only ones', () => {
    expect(daysApart('2026-08-12', '2026-04-24')).toBeGreaterThan(100);
    expect(daysApart('2026-08', '2026-08-13')).toBeLessThan(3);
  });
});

// These check rules that hold for any day's data, so a legitimate refresh never fails them. Specific behaviours
// (snapshot-safe prices, source precision, raw-best settings) are tested on fixed synthetic sources in build.test.ts.
describe('the built data', () => {
  it('prices are each a consistent 3:1 blend of their input and output price', () => {
    for (const m of data.models) if (m.price) expect(m.price.blended).toBeCloseTo((3 * m.price.input + m.price.output) / 4, 5);
  });
  it('no two fighters share one listing\'s price', () => {
    const listings = data.models.flatMap((m) => (m.price ? [`${m.price.provider}/${m.price.modelsDevId}`] : []));
    expect(new Set(listings).size).toBe(listings.length);
  });
  it('only uses claims that are web-sourced and match our benchmark version', () => {
    for (const c of data.claims) {
      expect(isWebUrl(c.url)).toBe(true);
      expect(sameVersion(c.version, data.benchmarks.find((b) => b.id === c.bench)?.version)).toBe(true);
    }
  });
  it('schedules the daily brawl ahead, and never rewrites a scheduled day', () => {
    expect(data.daily!.length).toBeGreaterThanOrEqual(14);
    expect(new Set(data.daily!.map((e) => e.day)).size).toBe(data.daily!.length);
  });
});
