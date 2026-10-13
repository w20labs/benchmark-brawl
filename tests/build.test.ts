// Runs the real data builder against small synthetic source files, to check that malformed input fails the build
// (so the site keeps its last good data) instead of quietly publishing wrong numbers.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

const ROOT = resolve('.'), TSX = join(ROOT, 'node_modules/.bin/tsx'), BUILDER = join(ROOT, 'scripts/build-data.ts');
const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const MODELS = [
  { v: 'alpha-one', group: 'Alpha One', org: 'Anthropic', s: 0.8 }, { v: 'alpha-two', group: 'Alpha Two', org: 'Anthropic', s: 0.7 },
  { v: 'beta-one', group: 'Beta One', org: 'OpenAI', s: 0.75 }, { v: 'beta-two', group: 'Beta Two', org: 'OpenAI', s: 0.62 },
  { v: 'gemini-3-1-pro', group: 'Gemini 3.1 Pro', org: 'Google DeepMind', s: 0.68 }, { v: 'gamma-two', group: 'Gamma Two', org: 'Google DeepMind', s: 0.55 },
  { v: 'delta-pro', group: 'Delta Pro', org: 'OpenAI', s: 0.5 },
];
const RELEASED: Record<string, number> = { 'gemini-3-1-pro': 200, 'delta-pro': 220 };
const STD = ['frontiermath_tier_4_v2.csv', 'frontiermath_tiers_1_3_v2.csv', 'otis_mock_aime_2024_2025.csv', 'gpqa_diamond.csv', 'simpleqa_verified.csv', 'mystery_game_puzzles.csv', 'chess_puzzles.csv', 'swe_bench_verified.csv', 'mirrorcode.csv'];
type Files = Record<string, string>;
const csv = (header: string[], rows: (string | number)[][]) => [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
function sources(): { files: Files; prices: Record<string, unknown> } {
  const files: Files = {
    'model_metadata.csv': csv(['model_version', 'model_group', 'date', 'display_name', 'organization', 'accessibility'], MODELS.map((m, i) => [m.v, m.group, day(RELEASED[m.v] ?? 40 + i), m.group, m.org, 'API access'])),
    'epoch_capabilities_index/eci_scores.csv': csv(['Model', 'eci'], MODELS.map((m, i) => [m.group, 150 - i])),
    'deepswe_external.csv': csv(['Model version', 'Pass@1', '95% CI half-width'], MODELS.map((m) => [m.v, m.s, 0.03])),
    'weirdml_v3_external.csv': csv(['Model version', 'Score', 'Score 95% CI low', 'Score 95% CI high'], MODELS.map((m) => [m.v, m.s / 2, m.s / 2 - 0.02, m.s / 2 + 0.02])),
  };
  for (const f of STD) files[f] = csv(['Model version', 'Best score (across scorers)', 'stderr'], MODELS.map((m, i) => [m.v, Math.min(1, m.s + (f.length % 5) * 0.03 - i * 0.01), 0.02]));
  // two settings of one model whose scores both show as 97.6: the raw best (high) must win, with its own error
  files['frontiermath_tier_4_v2.csv'] += `\nbeta-one_medium,0.975609756,0.0244\nbeta-one_high,0.976,0.024`;
  const listing = (name: string, input: unknown, output: unknown, released: string) => ({ name, cost: { input, output }, release_date: released });
  const prices: Record<string, { models: Record<string, unknown> }> = {
    anthropic: { models: { 'alpha-one': listing('Alpha One', 4, 20, day(40)), 'alpha-two': listing('Alpha Two', 1, 5, day(41)) } },
    openai: { models: { 'beta-one': listing('Beta One', 2, 10, day(42)), 'beta-two': listing('Beta Two', 0.03, 0.13, day(43)), 'delta-pro': listing('Delta Pro', 5, 25, day(20)) } },
    google: { models: { 'gemini-3.1-pro-preview': listing('Gemini 3.1 Pro Preview', 2, 12, day(200)), 'gamma-two': listing('Gamma Two', 0.3, 1.2, day(45)) } },
  };
  for (let p = 0; p < 4; p++) prices[`filler${p}`] = { models: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}`, listing(`F${p}-${i}`, 1, 1, day(10))])) };
  return { files, prices };
}
function build(change: (s: ReturnType<typeof sources>) => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brawl-build-')), src = sources();
  change(src);
  mkdirSync(join(dir, 'data/cache'), { recursive: true });
  writeFileSync(join(dir, 'data/cache/benchmark_data.zip'), zipSync(Object.fromEntries(Object.entries(src.files).map(([k, v]) => [k, strToU8(v)]))));
  writeFileSync(join(dir, 'data/cache/models-dev.json'), JSON.stringify(src.prices));
  writeFileSync(join(dir, 'data/claims.json'), '[]');
  const run = spawnSync(TSX, [BUILDER, '--cached'], { cwd: dir, encoding: 'utf8' });
  const out = run.status === 0 ? JSON.parse(readFileSync(join(dir, 'data/brawl.json'), 'utf8')) : null;
  return { ok: run.status === 0, log: run.stdout + run.stderr, out, model: (name: string) => out?.models.find((m: { name: string }) => m.name === name) };
}
const setCell = (text: string, row: number, col: number, value: string) => text.split('\n').map((l, i) => (i === row ? l.split(',').map((c, j) => (j === col ? value : c)).join(',') : l)).join('\n');

describe('the data build, run on synthetic sources', { timeout: 60_000 }, () => {
  it('builds clean input', () => {
    const r = build();
    expect(r.ok, r.log).toBe(true);
    expect(r.model('Alpha One').price.blended).toBe(8);
    expect(r.model('Alpha One').scores.gpqa.se).toBe(2);
  });
  it('keeps prices at source precision', () => {
    expect(build().model('Beta Two').price.blended).toBe(0.055); // not 0.06
  });
  it('does not give an older model the price of a newer release with the same name', () => {
    expect(build().model('Delta Pro').price).toBeNull(); // released 220 days ago; the listing is 20 days old
  });
  it('keeps the setting and error of the raw best result, not one that only rounds the same', () => {
    const fm = build().model('Beta One').scores['frontiermath-t4'];
    expect([fm.v, fm.setting, fm.se]).toEqual([97.6, 'high', 2.4]);
  });
  it('reads a price given as text correctly, never by string concatenation', () => {
    const r = build((s) => { (s.prices.anthropic as { models: Record<string, { cost: { output: unknown } }> }).models['alpha-one'].cost.output = '20'; });
    expect(r.ok, r.log).toBe(true);
    expect(r.model('Alpha One').price.blended).toBe(8); // not 305
  });
  it('fails on a malformed error margin instead of dropping it', () => {
    const r = build((s) => { s.files['gpqa_diamond.csv'] = setCell(s.files['gpqa_diamond.csv'], 1, 2, '0.0194%'); });
    expect(r.ok).toBe(false);
    expect(r.log).toMatch(/gpqa_diamond\.csv row 2, stderr/);
  });
  it('fails on a malformed or out-of-range score', () => {
    expect(build((s) => { s.files['gpqa_diamond.csv'] = setCell(s.files['gpqa_diamond.csv'], 1, 1, '0.9x'); }).ok).toBe(false);
    expect(build((s) => { s.files['gpqa_diamond.csv'] = setCell(s.files['gpqa_diamond.csv'], 1, 1, '90.6'); }).ok).toBe(false);
  });
  it('fails on a reversed confidence interval, or a negative error', () => {
    expect(build((s) => { s.files['weirdml_v3_external.csv'] = setCell(s.files['weirdml_v3_external.csv'], 1, 2, '0.9'); }).ok).toBe(false);
    expect(build((s) => { s.files['gpqa_diamond.csv'] = setCell(s.files['gpqa_diamond.csv'], 1, 2, '-0.02'); }).ok).toBe(false);
  });
  it('treats a blank score as missing', () => {
    const r = build((s) => { s.files['gpqa_diamond.csv'] = setCell(s.files['gpqa_diamond.csv'], 1, 1, ''); });
    expect(r.ok, r.log).toBe(true);
    expect(r.model('Alpha One').scores.gpqa).toBeUndefined();
  });
  it('leaves a model unpriced when its price alias now names a different model, even released close by', () => {
    const r = build((s) => { const g = (s.prices.google as { models: Record<string, { name: string; release_date: string }> }).models['gemini-3.1-pro-preview']; g.name = 'Gemini 3.2 Pro Preview'; g.release_date = day(190); });
    expect(r.ok, r.log).toBe(true);
    expect(r.model('Gemini 3.1 Pro').price).toBeNull();
    expect(r.log).toMatch(/now lists "Gemini 3.2 Pro Preview"/);
  });
  it('fails on a malformed Capabilities Index instead of dropping tournament seeding', () => {
    const r = build((s) => { s.files['epoch_capabilities_index/eci_scores.csv'] = s.files['epoch_capabilities_index/eci_scores.csv'].replace(/,(\d+)$/gm, ',$1 points'); });
    expect(r.ok).toBe(false);
    expect(r.log).toMatch(/eci_scores\.csv row 2, eci/);
    expect(build().model('Alpha One').eci).toBe(150);
  });
  it('leaves a model unpriced when its price alias now lists a different release', () => {
    expect(build().model('Gemini 3.1 Pro').price.blended).toBe(4.5);
    const r = build((s) => { const g = (s.prices.google as { models: Record<string, { name: string; release_date: string }> }).models['gemini-3.1-pro-preview']; g.name = 'Gemini 3.2 Pro Preview'; g.release_date = day(0); });
    expect(r.ok, r.log).toBe(true);
    expect(r.model('Gemini 3.1 Pro').price).toBeNull();
    expect(r.log).toMatch(/price alias/);
  });
});
