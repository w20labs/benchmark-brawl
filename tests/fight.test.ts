import { describe, expect, it } from 'vitest';
import { judgeRound, planFight, weaponFor, START_HP } from '../src/fight.ts';
import { featuredFight, inClass, newChallengers, PRESETS, runTournament } from '../src/league.ts';
import type { BrawlData, Model, Score } from '../src/types.ts';

const src = { name: 'test', url: 'https://example.com', license: 'test' };
const data = (models: Model[]): BrawlData => ({
  generatedAt: '2026-10-12T00:00:00Z',
  benchmarks: [
    { id: 'b1', name: 'Bench one', what: '', kind: 'score', source: src, epochRun: true },
    { id: 'b2', name: 'Bench two', what: '', kind: 'score', source: src, epochRun: true },
    { id: 'price', name: 'Price', what: '', kind: 'price', source: src, epochRun: false },
  ],
  rounds: [
    { id: 'r1', name: 'Round one', benches: ['b1', 'b2'] },
    { id: 'r2', name: 'Round two', benches: ['b2'] },
    { id: 'price', name: 'Price', benches: ['price'] },
  ],
  defaultRounds: ['r1', 'r2'],
  models,
});
const s = (v: number, se: number | null = null): Score => ({ v, se, setting: 'max' });
const model = (id: string, scores: Record<string, Score>, extra: Partial<Model> = {}): Model =>
  ({ id, name: id, org: 'Lab', released: '2026-09-01', open: false, eci: 150, price: null, scores, ...extra });

describe('judgeRound', () => {
  it('uses the first benchmark both fighters have', () => {
    const a = model('a', { b1: s(80), b2: s(50) }), b = model('b', { b2: s(40) });
    const d = data([a, b]);
    const r = judgeRound(d, d.rounds[0], a, b);
    expect(r.bench?.id).toBe('b2');
    expect(r.winner).toBe(0);
    expect(r.dmg).toBe(20);
  });
  it('has no result when nothing is shared', () => {
    const a = model('a', { b1: s(80) }), b = model('b', { b2: s(40) });
    const d = data([a, b]);
    expect(judgeRound(d, d.rounds[1], a, b).winner).toBeNull();
  });
  it('calls a tie inside the combined margin of error', () => {
    const a = model('a', { b1: s(60, 2) }), b = model('b', { b1: s(57, 2) });
    const d = data([a, b]);
    const r = judgeRound(d, d.rounds[0], a, b); // margin = 1.96 * sqrt(8) ≈ 5.5
    expect(r.winner).toBe(-1);
    expect(r.tie).toBe('margin');
    expect(r.dmg).toBe(0);
  });
  it('counts a gap outside the margin', () => {
    const a = model('a', { b1: s(70, 1) }), b = model('b', { b1: s(60, 1) });
    const d = data([a, b]);
    const r = judgeRound(d, d.rounds[0], a, b);
    expect([r.winner, r.dmg, r.weapon]).toEqual([0, 20, 'meteor']);
  });
  it('makes the cheaper model win the price round, by doublings', () => {
    const p = (blended: number) => ({ input: blended, output: blended, blended, openrouterId: 'x' });
    const a = model('a', {}, { price: p(20) }), b = model('b', {}, { price: p(5) });
    const d = data([a, b]);
    const r = judgeRound(d, d.rounds[2], a, b);
    expect(r.winner).toBe(1);
    expect(r.points).toBe(20); // 4x cheaper = 2 doublings
    expect(r.dmg).toBe(40);
    const c = model('c', {}, { price: p(5.4) });
    expect(judgeRound(d, d.rounds[2], b, c).winner).toBe(-1);
  });
});

describe('planFight', () => {
  it('stops at a K.O.', () => {
    const a = model('a', { b1: s(90), b2: s(90) }), b = model('b', { b1: s(30), b2: s(30) });
    const f = planFight(data([a, b]), a, b, ['r1', 'r2']);
    expect(f.ko).toBe(true);
    expect(f.rounds).toHaveLength(1);
    expect(f.hp).toEqual([START_HP, 0]);
  });
  it('decides on HP, so big wins can beat more round wins', () => {
    const a = model('a', { b1: s(80), b2: s(40) }), b = model('b', { b1: s(50), b2: s(45) });
    const d = data([a, b]);
    const f = planFight(d, a, b, ['r1', 'r2']);
    expect(f.roundsWon).toEqual([1, 1]);
    expect(f.winner).toBe(0);
  });
});

describe('weapons', () => {
  it('scales with the gap', () => {
    expect([1, 4, 5, 9, 10, 15, 16, 40].map(weaponFor)).toEqual(['mg', 'mg', 'rocket', 'rocket', 'meteor', 'meteor', 'laser', 'laser']);
  });
});

describe('league', () => {
  it('finds new challengers and features one against the champion', () => {
    const old = model('old', {}, { released: '2026-05-01', eci: 160 });
    const fresh = model('fresh', {}, { released: '2026-10-01', eci: 150 });
    expect(newChallengers([old, fresh], new Date('2026-10-12'))).toEqual([fresh]);
    expect(featuredFight([old, fresh], new Date('2026-10-12'))?.map((m) => m.id)).toEqual(['fresh', 'old']);
  });
  it('sorts fighters into weight classes', () => {
    const cheap = model('c', {}, { open: true, price: { input: 0.1, output: 0.4, blended: 0.18, openrouterId: 'x' } });
    expect(inClass(cheap, 'open') && inClass(cheap, 'budget') && !inClass(cheap, 'premium')).toBe(true);
  });
  it('runs an 8-seed bracket to one champion', () => {
    const ms = Array.from({ length: 9 }, (_, i) => model(`m${i}`, { b1: s(50 + i * 3), b2: s(50 + i * 3) }, { eci: 100 + i }));
    const b = runTournament(data(ms), ms, ['r1', 'r2'])!;
    expect(b.rounds.map((r) => r.length)).toEqual([4, 2, 1]);
    expect(b.champion.id).toBe('m8');
    expect(b.seeds).toHaveLength(8);
  });
  it('has presets without repeated rounds', () => {
    for (const p of PRESETS) expect(new Set(p.rounds).size).toBe(p.rounds.length);
  });
});
