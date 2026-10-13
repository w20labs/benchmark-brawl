// Sanity checks on the real data/brawl.json produced by `npm run data`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planFight } from '../src/fight.ts';
import type { BrawlData } from '../src/types.ts';

const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));

describe('data/brawl.json', () => {
  it('has a roster and every round refers to real benchmarks', () => {
    expect(data.models.length).toBeGreaterThan(16);
    const ids = new Set(data.benchmarks.map((b) => b.id));
    for (const r of data.rounds) for (const b of r.benches) expect(ids.has(b)).toBe(true);
    for (const id of data.defaultRounds) expect(data.rounds.some((r) => r.id === id)).toBe(true);
  });
  it('keeps scores as percentages and prices positive', () => {
    for (const m of data.models) {
      expect(new Set(data.models.map((x) => x.id)).size).toBe(data.models.length);
      for (const sc of Object.values(m.scores)) { expect(sc.v).toBeGreaterThanOrEqual(0); expect(sc.v).toBeLessThanOrEqual(100); }
      if (m.price) expect(m.price.blended).toBeGreaterThan(0);
    }
  });
  it('can fight any two fighters without errors', () => {
    const [a, b] = data.models;
    const f = planFight(data, a, b, data.defaultRounds);
    expect(f.rounds.length).toBeGreaterThan(0);
  });
});
