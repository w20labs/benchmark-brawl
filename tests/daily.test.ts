import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planFight } from '../src/fight.ts';
import { dailyFromEntry } from '../src/league.ts';
import type { BrawlData, Model } from '../src/types.ts';

const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const live = (d: BrawlData) => new Map(d.models.map((m) => [m.id, m]));
const result = (d: BrawlData, brawl: ReturnType<typeof dailyFromEntry>) => { const p = planFight(d, brawl!.a, brawl!.b, brawl!.rounds); return [p.winner, ...p.hp]; };

describe('saved daily brawls', () => {
  const entry = data.daily!.find((e) => e.no === 5) ?? data.daily![0];
  it('keep their result when scores are refreshed later', () => {
    const before = result(data, dailyFromEntry(entry, live(data)));
    const refreshed: BrawlData = JSON.parse(JSON.stringify(data));
    for (const m of refreshed.models) if (m.id === entry.a || m.id === entry.b) for (const s of Object.values(m.scores)) s.v = Math.max(0, s.v - 7.3);
    expect(result(refreshed, dailyFromEntry(entry, live(refreshed)))).toEqual(before);
  });
  it('still play when a fighter has left the roster', () => {
    const smaller: BrawlData = { ...data, models: data.models.filter((m) => m.id !== entry.a) };
    expect(dailyFromEntry(entry, live(smaller))?.a.id).toBe(entry.a);
  });
  it('were scheduled with a winner, and still have one', () => {
    for (const e of data.daily!) { const b = dailyFromEntry(e, live(data))!; expect(planFight(data, b.a, b.b, b.rounds).winner).not.toBe(-1); }
  });
  it('fall back to the live roster only for old entries without a snapshot', () => {
    const { fighters: _f, ...old } = entry;
    expect((dailyFromEntry(old, live(data))!.a as Model).id).toBe(entry.a);
  });
});
