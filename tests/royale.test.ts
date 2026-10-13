import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planFight } from '../src/fight.ts';
import { planRoyale } from '../src/royale.ts';
import type { BrawlData, Model } from '../src/types.ts';

const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));

const bench = { id: 'b', name: 'B', what: '', kind: 'score' as const, source: { name: '', url: '', license: '' }, epochRun: true };
const mini: BrawlData = { generatedAt: '', benchmarks: [bench], rounds: [{ id: 'r', name: 'R', benches: ['b'] }], defaultRounds: ['r'], models: [], claims: [] };
const bot = (id: string, v: number | null, se: number | null = null): Model =>
  ({ id, name: id, org: id, released: '2026-01-01', open: false, eci: null, price: null, scores: v == null ? {} : { b: { v, se, setting: 'high' } } });

describe('planRoyale', () => {
  it('the leader hits everyone by 2 × their gap, and a model inside the margin dodges', () => {
    const r = planRoyale(mini, [bot('a', 80, 1), bot('b', 79, 1), bot('c', 60, 1)], ['r']);
    const R = r.rounds[0];
    expect(R.leader).toBe(0);
    expect(R.hits).toEqual([
      expect.objectContaining({ target: 1, tie: 'margin', dmg: 0 }),
      expect.objectContaining({ target: 2, tie: null, dmg: 40, weapon: 'laser' }),
    ]);
    expect(r.hp).toEqual([100, 100, 60]);
  });

  it('a fighter without a result sits the round out', () => {
    const r = planRoyale(mini, [bot('a', 80), bot('b', 70), bot('c', null)], ['r']);
    expect(r.rounds[0].inRound).toEqual([0, 1]);
    expect(r.rounds[0].values[2]).toBeNull();
    expect(r.hp[2]).toBe(100);
  });

  it('knocks out at 0 HP, stops when one is left, and places the last out higher', () => {
    const r = planRoyale(mini, [bot('a', 90), bot('b', 30), bot('c', 10)], ['r', 'r', 'r']);
    expect(r.outIn).toEqual([null, 0, 0]);
    expect(r.rounds).toHaveLength(1);
    expect(r.placing).toEqual([0, 1, 2]);
    expect(r.winner).toBe(0);
  });

  it('a two-model royale lands the same hits as a fight (outside averaged rounds)', () => {
    const [a, b] = data.models;
    const rounds = data.defaultRounds.filter((id) => !data.rounds.find((r) => r.id === id)!.combine);
    const fight = planFight(data, a, b, rounds);
    const royale = planRoyale(data, [a, b], rounds);
    // royales have no tie graze (a fighter inside the margin dodges), so compare the hits round by round
    const n = Math.min(fight.rounds.length, royale.rounds.length);
    expect(royale.rounds.slice(0, n).map((R) => R.hits[0]?.dmg ?? 0)).toEqual(fight.rounds.slice(0, n).map((R) => R.dmg));
  });

  it('plays a full 8-model royale on the real data', () => {
    const r = planRoyale(data, data.models.slice(0, 8), data.defaultRounds);
    expect(r.placing).toHaveLength(8);
    expect(new Set(r.placing).size).toBe(8);
    for (const R of r.rounds) for (const h of R.hits) expect(R.inRound).toContain(h.target);
  });
});
