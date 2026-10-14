import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BrawlData, Model } from '../../src/types.ts';
import { defaults, fingerprint, repeatPairings, sharedRounds, simulate } from './simulate.ts';

// real benchmarks and rounds, fake models
const real: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const S = (v: number) => ({ v, se: 0.5, setting: 'max' });
const model = (id: string, eci: number, released: string, scores: Record<string, number>): Model =>
  ({ id, name: id, org: id, released, open: false, eci, price: null, scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, S(v)])) });
const full = (v: number) => ({ swebench: v, frontiermath: v, gpqa: v, simpleqa: v, mystery: v });
// eight openers, m1 strongest, all released before the season
const openers = Array.from({ length: 8 }, (_, k) => model(`m${k + 1}`, 150 - k, '2026-01-01', full(80 - k * 5)));
const data = (extra: Model[] = []): BrawlData => ({ ...real, models: [...openers, ...extra], daily: [] });
const pairs = (fs: { champion: string; challenger: string }[]) => fs.map((f) => [f.champion, f.challenger].sort().join('|'));

describe('Season 2 belt rules', () => {
  it('never books the same two models twice on unchanged scores, whoever holds the belt', () => {
    const x = model('x', 160, '2026-01-20', full(95)); // takes the belt from m1, then m1 is a top contender again
    const r = simulate(data([x]), ['undisputed'], '2026-01-01', '2026-04-30', [0]);
    expect(r.fights.find((f) => f.challenger === 'x')).toMatchObject({ champion: 'm1', outcome: 'new champion' });
    expect(r.fights.some((f) => f.champion === 'x' && f.challenger === 'm1')).toBe(false);
    const p = pairs(r.fights);
    expect(new Set(p).size).toBe(p.length);
  });
  it('treats changed scores as a new matchup', () => {
    const a = openers[0], b = { ...a, scores: { ...a.scores, gpqa: S(10) } };
    expect(fingerprint(real, a)).not.toBe(fingerprint(real, b));
  });
  it("doesn't book a fight with fewer than 3 comparable rounds, even when the challenger would win", () => {
    // y qualifies on its own (4 rounds) but its Coding and Math benchmarks differ from the champion's
    const champ = model('champ', 200, '2026-01-01', { swebench: 99, frontiermath: 99, gpqa: 70, simpleqa: 99 });
    const y = model('y', 199, '2026-01-20', { weirdml: 99, aime: 99, gpqa: 99, simpleqa: 99 });
    expect(sharedRounds(real, champ, y)).toBe(2);
    const r = simulate(data([champ, y]), ['undisputed'], '2026-01-01', '2026-03-31', [0]);
    expect(r.reigns[0].model).toBe('champ');
    expect(r.fights.some((f) => [f.champion, f.challenger].includes('y'))).toBe(false);
  });
  it('vacates the belt when the champion stops qualifying, and the top two fight for it', () => {
    const o = { ...defaults(), inClass: (_b: string, m: Model, day: string) => !(m.id === 'm1' && day >= '2026-02-01') };
    const r = simulate(data(), ['undisputed'], '2026-01-01', '2026-02-28', [0], o);
    expect(r.reigns[0]).toMatchObject({ model: 'm1', to: '2026-02-01', ended: 'vacated: no longer eligible' });
    // m2 and m3 already met in the opening semi-final, so the vacant-title fight is m2 vs m4
    expect(r.fights.find((f) => f.why === 'vacant')).toMatchObject({ day: '2026-02-01', champion: 'm2', challenger: 'm4', outcome: 'vacant filled' });
    expect(repeatPairings(data(), r)).toBe(0);
    expect(r.reigns[1]).toMatchObject({ model: 'm2', from: '2026-02-01' });
  });
  it('gives a drawn vacant-title fight to the higher-ranked contender', () => {
    const twin = model('m2b', 148.5, '2026-01-20', full(75)); // same scores as m2, ranked just below it, joins after the opening
    const o = { ...defaults(), inClass: (_b: string, m: Model, day: string) => !(m.id === 'm1' && day >= '2026-02-01') };
    const r = simulate(data([twin]), ['undisputed'], '2026-01-01', '2026-02-28', [0], o);
    expect(r.fights.find((f) => f.why === 'vacant')).toMatchObject({ champion: 'm2', challenger: 'm2b', decision: 'draw' });
    expect(r.reigns[1]).toMatchObject({ model: 'm2', how: 'drew the vacant-title fight, ranked higher' });
  });
  it("doesn't rebook pairs that met in the opening tournament", () => {
    // bracket: 1v8, 4v5, 2v7, 3v6, then 1v4, 2v3, final 1v2. m1 has met m8, m4 and m2.
    const r = simulate(data(), ['undisputed'], '2026-01-01', '2026-03-31', [0]);
    expect(r.reigns[0].model).toBe('m1');
    expect(r.fights.map((f) => f.challenger)).toEqual(['m3']); // the only top-3 contender it hasn't met
    expect(repeatPairings(data(), r)).toBe(0);
  });
  it('keeps a model out of the opening bracket unless it can be compared with every other entrant', () => {
    // z ranks first and would win on Science, but shares only Science and Facts with the others
    const z = model('z', 300, '2026-01-01', { weirdml: 99, aime: 99, gpqa: 99, simpleqa: 99 });
    expect(sharedRounds(real, z, openers[0])).toBe(2);
    const r = simulate(data([z]), ['undisputed'], '2026-01-01', '2026-01-31', [0]);
    const entrants = r.openings[0].bracket.seeds.map((m) => m.id);
    expect(entrants).not.toContain('z');
    expect(entrants).toHaveLength(8);
    expect(r.reigns[0].model).toBe('m1');
  });
  it('defers the opening until there is a valid 8-model field', () => {
    const z = model('z', 300, '2026-01-01', { weirdml: 99, aime: 99, gpqa: 99, simpleqa: 99 });
    const late = model('m9', 100, '2026-02-10', full(30));
    const d = { ...data([z, late]), models: [...openers.slice(0, 7), z, late] };
    expect(simulate(d, ['undisputed'], '2026-01-01', '2026-03-31', [0]).starts.undisputed).toBe('2026-02-10');
    const never = simulate({ ...d, models: [...openers.slice(0, 7), z] }, ['undisputed'], '2026-01-01', '2026-03-31', [0]);
    expect(never.starts.undisputed).toBeNull();
    expect(never.fights).toHaveLength(0);
  });
  const openModel = (id: string, eci: number, released: string, v: number) => ({ ...model(id, eci, released, full(v)), open: true });
  it("counts a meeting only once it has happened, so a later opening doesn't cancel an earlier fight", () => {
    // m1 and m3 are open weights. Undisputed opens Jan 1; Open weights can only open Feb 1, when more open models arrive.
    const ms = openers.map((m) => (m.id === 'm1' || m.id === 'm3' ? { ...m, open: true } : m));
    const later = Array.from({ length: 7 }, (_, k) => openModel(`o${k + 1}`, 100 - k, '2026-02-01', 40 - k));
    const r = simulate({ ...data(), models: [...ms, ...later] }, ['undisputed', 'open'], '2026-01-01', '2026-02-28', [0]);
    expect(r.fights.find((f) => f.day === '2026-01-04')).toMatchObject({ belt: 'undisputed', champion: 'm1', challenger: 'm3' });
    expect(r.starts.open).toBe('2026-02-01');
    // m1 and m3 already met, so the Open weights field can't include both
    const field = r.openings.find((x) => x.belt === 'open')!.bracket.seeds.map((m) => m.id);
    expect(field.includes('m1') && field.includes('m3')).toBe(false);
    expect(repeatPairings({ ...data(), models: [...ms, ...later] }, r)).toBe(0);
  });
  it("doesn't replay an opening bracket in a second belt with the same field", () => {
    const ms = openers.map((m) => ({ ...m, open: true })); // every model fits both belts
    const r = simulate({ ...data(), models: ms }, ['undisputed', 'open'], '2026-01-01', '2026-02-28', [0]);
    expect(r.starts).toEqual({ undisputed: '2026-01-01', open: null }); // only 8 models: no fresh field for the second belt
    const more = Array.from({ length: 8 }, (_, k) => openModel(`p${k + 1}`, 120 - k, '2026-02-01', 50 - k));
    const d2 = { ...data(), models: [...ms, ...more] }, r2 = simulate(d2, ['undisputed', 'open'], '2026-01-01', '2026-02-28', [0]);
    expect(r2.starts.open).not.toBeNull();
    expect(repeatPairings(d2, r2)).toBe(0);
  });
});
