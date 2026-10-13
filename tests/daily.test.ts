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
  it('keep their result when a refresh would flip the live outcome', () => {
    const saved = dailyFromEntry(entry, live(data))!, before = result(data, saved);
    const winnerId = [saved.a, saved.b][before[0]].id;
    const refreshed: BrawlData = JSON.parse(JSON.stringify(data));
    for (const m of refreshed.models) if (m.id === winnerId) for (const s of Object.values(m.scores)) s.v = 0; // only the winner gets worse
    const liveFight = planFight(refreshed, refreshed.models.find((m) => m.id === entry.a)!, refreshed.models.find((m) => m.id === entry.b)!, entry.rounds);
    expect(liveFight.winner).not.toBe(before[0]); // live data would now say the other fighter wins…
    expect(result(refreshed, dailyFromEntry(entry, live(refreshed)))).toEqual(before); // …but the saved brawl doesn't change
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
