import { describe, expect, it } from 'vitest';
import { judgeRound, planFight, START_HP, stylePicker, STYLES, weaponFor } from '../src/fight.ts';
import { brawlNumber, dailyBrawl, featuredFight, inClass, newChallengers, PRESETS, runTournament } from '../src/league.ts';
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
  claims: [],
});
const s = (v: number, se: number | null = null): Score => ({ v, se, setting: 'max' });
const model = (id: string, scores: Record<string, Score>, extra: Partial<Model> = {}): Model =>
  ({ id, name: id, org: 'Lab', released: '2026-09-01', open: false, eci: 150, price: null, scores, ...extra });

describe('empty rounds and weapon styles', () => {
  it('leaves out rounds with no shared benchmark instead of playing them empty', () => {
    const a = model('a', { b1: s(80) }), b = model('b', { b1: s(70) });
    const p = planFight(data([a, b]), a, b, ['r1', 'r2', 'r1']);
    expect(p.rounds.map((R) => R.round.id)).toEqual(['r1', 'r1']);
    expect(p.skipped.map((r) => r.id)).toEqual(['r2']);
  });
  it('a fighter switches weapon styles and never repeats one twice in a row', () => {
    const pick = stylePicker();
    const mine = ['mg', 'mg', 'mg', 'mg', 'rocket', 'rocket'].map((w) => pick(0, w as 'mg'));
    expect(mine.slice(0, 3)).toEqual(STYLES.mg);
    for (let i = 1; i < mine.length; i++) expect(mine[i]).not.toBe(mine[i - 1]);
    expect(pick(1, 'mg')).toBe('mg'); // the other fighter has its own list
  });
});

describe('ties and decisions', () => {
  it('a tie grazes both fighters for the same small amount', () => {
    const a = model('a', { b1: s(60, 2) }), b = model('b', { b1: s(59, 2) });
    const p = planFight(data([a, b]), a, b, ['r1']);
    expect(p.rounds[0].winner).toBe(-1);
    expect(p.rounds[0].graze).toEqual([3, 3]);
    expect(p.hp).toEqual([97, 97]);
    expect(p.decision).toBe('draw');
  });
  it('a graze never knocks anyone out', () => {
    const a = model('a', { b1: s(90), b2: s(50, 2) }), b = model('b', { b1: s(41), b2: s(50, 2) });
    const p = planFight(data([a, b]), a, b, ['r1', 'r2']); // b falls to 2 HP, then a tie
    expect(p.hp[1]).toBe(1);
    expect(p.ko).toBe(false);
    expect(p.rounds[1].graze).toEqual([3, 1]);
  });
  it('more HP and more rounds is unanimous; more HP but fewer rounds is split', () => {
    const d = data([]);
    const a = model('a', { b1: s(90), b2: s(40) }), b = model('b', { b1: s(80), b2: s(45) });
    const unanimous = planFight(d, a, b, ['r1', 'r1', 'r2']); // a wins 2 rounds
    expect([unanimous.winner, unanimous.decision]).toEqual([0, 'unanimous']);
    const c = model('c', { b1: s(70), b2: s(50) }), e = model('e', { b1: s(72), b2: s(20) });
    const split = planFight(d, c, e, ['r1', 'r1', 'r2']); // e wins 2 small rounds, c one big one
    expect([split.winner, split.decision]).toEqual([0, 'split']);
  });
});

describe('averaged rounds', () => {
  const avg = (models: Model[]) => { const d = data(models); d.rounds[0] = { ...d.rounds[0], combine: 'average' }; return d; };
  it('averages the gaps over every benchmark both have, with a combined margin', () => {
    const a = model('a', { b1: s(80, 2), b2: s(50, 2) }), b = model('b', { b1: s(70, 2), b2: s(46, 2) });
    const d = avg([a, b]);
    const r = judgeRound(d, d.rounds[0], a, b);
    expect(r.parts?.map((p) => p.bench.id)).toEqual(['b1', 'b2']);
    expect(r.values).toEqual([65, 58]); // gap 7 = mean of 10 and 4
    expect(r.margin).toBe(3.9); // 1.96 * sqrt(4 × 2²) / 2
    expect(r.winner).toBe(0);
    expect(r.dmg).toBe(14);
  });
  it('falls back to the single shared benchmark', () => {
    const a = model('a', { b1: s(80, 2), b2: s(50, 2) }), b = model('b', { b2: s(40, 2) });
    const d = avg([a, b]);
    const r = judgeRound(d, d.rounds[0], a, b);
    expect(r.parts).toBeUndefined();
    expect(r.bench?.id).toBe('b2');
  });
  it('a gap that one benchmark shows but the other cancels is a tie', () => {
    const a = model('a', { b1: s(80, 1), b2: s(40, 1) }), b = model('b', { b1: s(76, 1), b2: s(43, 1) });
    const d = avg([a, b]);
    expect(judgeRound(d, d.rounds[0], a, b).winner).toBe(-1);
  });
});

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
    const p = (blended: number) => ({ input: blended, output: blended, blended, provider: 'x', modelsDevId: 'x' });
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
  it('features the newest model against the best of another lab', () => {
    const top = model('top', {}, { org: 'A', eci: 160 }), second = model('second', {}, { org: 'B', eci: 150 });
    const fresh = model('fresh', {}, { org: 'A', eci: 140, released: '2026-10-10' });
    expect(featuredFight([top, second, fresh], new Date('2026-10-12'))?.map((m) => m.id)).toEqual(['fresh', 'second']);
  });
  it('numbers the daily brawl by UTC day and gives everyone the same fight', () => {
    expect(brawlNumber(new Date('2026-10-13T00:00:00Z'))).toBe(1);
    expect(brawlNumber(new Date('2026-10-13T23:59:59Z'))).toBe(1);
    expect(brawlNumber(new Date('2026-10-24T08:00:00Z'))).toBe(12);
    const ms = Array.from({ length: 12 }, (_, i) => model(`m${i}`, { b1: s(40 + i * 4), b2: s(30 + i * 5) }, { org: `Lab${i % 4}`, eci: 100 + i }));
    const d = { ...data(ms), defaultRounds: ['r1', 'r1', 'r2'] };
    const morning = dailyBrawl(d, new Date('2026-10-15T01:00:00Z'))!, evening = dailyBrawl(d, new Date('2026-10-15T22:00:00Z'))!;
    expect([morning.a.id, morning.b.id]).toEqual([evening.a.id, evening.b.id]);
    expect(morning.a.org).not.toBe(morning.b.org);
    const days = new Set(Array.from({ length: 10 }, (_, i) => { const x = dailyBrawl(d, new Date(Date.UTC(2026, 9, 14 + i)))!; return `${x.a.id}-${x.b.id}`; }));
    expect(days.size).toBeGreaterThan(3);
  });
  it('sorts fighters into weight classes', () => {
    const cheap = model('c', {}, { open: true, price: { input: 0.1, output: 0.4, blended: 0.18, provider: 'x', modelsDevId: 'x' } });
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
