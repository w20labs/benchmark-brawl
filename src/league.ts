/** Weight classes, new challengers and tournaments: everything above a single fight. */
import { planFight, type FightResult } from './fight.ts';
import type { BrawlData, DailyEntry, Model } from './types.ts';

// ---------- weight classes ----------
export type ClassId = 'all' | 'closed' | 'open' | 'budget' | 'mid' | 'premium';
export const CLASSES: { id: ClassId; name: string; test: (m: Model) => boolean }[] = [
  { id: 'all', name: 'All', test: () => true },
  { id: 'closed', name: 'Closed weights', test: (m) => !m.open },
  { id: 'open', name: 'Open weights', test: (m) => m.open },
  { id: 'budget', name: 'Budget (under $1)', test: (m) => !!m.price && m.price.blended < 1 },
  { id: 'mid', name: 'Mid ($1–5)', test: (m) => !!m.price && m.price.blended >= 1 && m.price.blended <= 5 },
  { id: 'premium', name: 'Premium (over $5)', test: (m) => !!m.price && m.price.blended > 5 },
];
export const inClass = (m: Model, id: ClassId) => CLASSES.find((c) => c.id === id)!.test(m);

// ---------- presets for "build your arena" ----------
export const PRESETS: { id: string; name: string; rounds: string[] }[] = [
  { id: 'all-round', name: 'All-round', rounds: ['coding', 'math', 'science', 'facts', 'puzzles'] },
  { id: 'code', name: 'I write code', rounds: ['coding', 'puzzles', 'math', 'price'] },
  { id: 'research', name: 'Research & science', rounds: ['science', 'math', 'facts', 'puzzles'] },
  { id: 'budget', name: 'On a budget', rounds: ['price', 'coding', 'science', 'facts'] },
  { id: 'games', name: 'Brain games', rounds: ['chess', 'puzzles', 'math'] },
];
export const MIN_ROUNDS = 3, MAX_ROUNDS = 7;

// ---------- champion and new challengers ----------
const DAY = 864e5;
/** Highest Epoch Capabilities Index among the fighters. */
export const champion = (models: Model[]) => [...models].filter((m) => m.eci != null).sort((a, b) => b.eci! - a.eci!)[0] ?? models[0];
/** Released within `days` of `now`, newest first. */
export function newChallengers(models: Model[], now: Date, days = 30): Model[] {
  const since = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
  return models.filter((m) => m.released >= since).sort((a, b) => b.released.localeCompare(a.released));
}
/** The fight to feature: the newest challenger against the most capable model from another lab (any lab if none). */
export function featuredFight(models: Model[], now: Date): [Model, Model] | null {
  const fresh = newChallengers(models, now)[0];
  if (!fresh) return null;
  const ranked = [...models].filter((m) => m.id !== fresh.id && m.eci != null).sort((a, b) => b.eci! - a.eci!);
  const rival = ranked.find((m) => m.org !== fresh.org) ?? ranked[0];
  return rival ? [fresh, rival] : null;
}

// ---------- the daily brawl ----------
/** Brawl #1 is this UTC day. */
export const FIRST_BRAWL_DAY = '2026-10-13';
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
/** Brawl number for a date: #1 on FIRST_BRAWL_DAY, one more each UTC day. */
export const brawlNumber = (now: Date) => Math.floor((Date.parse(utcDay(now)) - Date.parse(FIRST_BRAWL_DAY)) / DAY) + 1;
/** Small seeded random numbers, so everyone gets the same fight on the same day. */
function seeded(seed: string) {
  let x = 0x811c9dc5; for (let i = 0; i < seed.length; i++) { x ^= seed.charCodeAt(i); x = Math.imul(x, 16777619); }
  return () => { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export type DailyBrawl = { no: number; day: string; a: Model; b: Model; rounds: string[]; featured: boolean };

/** Both fighters as they were, keeping only the scores the brawl's rounds can use. */
export function snapshotFighters(data: BrawlData, a: Model, b: Model, rounds: string[]): [Model, Model] {
  const benches = new Set(rounds.flatMap((id) => data.rounds.find((r) => r.id === id)?.benches ?? []));
  const keep = (m: Model): Model => ({ ...m, scores: Object.fromEntries(Object.entries(m.scores).filter(([id]) => benches.has(id))) });
  return [keep(a), keep(b)];
}
/** A scheduled brawl, played from its saved snapshot (the live roster is only a fallback for old entries without one). */
export function dailyFromEntry(e: DailyEntry, live: Map<string, Model>): DailyBrawl | null {
  const [a, b] = e.fighters ?? [live.get(e.a), live.get(e.b)];
  return a && b ? { no: e.no, day: e.day, a, b, rounds: e.rounds, featured: e.featured } : null;
}
/**
 * Today's official fight, the same for everyone. Every third brawl features the newest challenger (when there is
 * one); otherwise two close rivals from different labs among the top 30. Only pairs with at least 3 rounds that
 * actually happen, and a winner, are used: a daily prediction needs an answer.
 */
export function dailyBrawl(data: BrawlData, now: Date, rounds = data.defaultRounds): DailyBrawl | null {
  const no = brawlNumber(now), day = utcDay(now);
  const live = (a: Model, b: Model) => { const p = planFight(data, a, b, rounds); return p.winner !== -1 && p.rounds.filter((r) => r.winner != null).length >= MIN_ROUNDS; };
  if (no % 3 === 1) {
    const f = featuredFight(data.models, now);
    if (f && live(f[0], f[1])) return { no, day, a: f[0], b: f[1], rounds, featured: true };
  }
  const pool = [...data.models].filter((m) => m.eci != null).sort((a, b) => b.eci! - a.eci! || a.id.localeCompare(b.id)).slice(0, 30);
  const rnd = seeded(day);
  for (let tries = 0; tries < 50; tries++) {
    const i = Math.floor(rnd() * pool.length), a = pool[i];
    const near = pool.filter((m, j) => m.org !== a.org && Math.abs(j - i) <= 8 && live(a, m));
    if (near.length) { const b = near[Math.floor(rnd() * near.length)]; return { no, day, ...(rnd() < 0.5 ? { a, b } : { a: b, b: a }), rounds, featured: false }; }
  }
  return null;
}

// ---------- tournaments ----------
export type Match = { a: Model; b: Model; fight: FightResult; winner: Model; tiebreak: boolean };
export type Bracket = { seeds: Model[]; rounds: Match[][]; champion: Model };
/** Standard 8-seed order: 1v8, 4v5, 2v7, 3v6. */
const ORDER_8 = [0, 7, 3, 4, 1, 6, 2, 5];

/** Seeds the top 8 by Epoch Capabilities Index and plays the bracket. A drawn fight goes to the higher seed. */
export function runTournament(data: BrawlData, pool: Model[], roundIds: string[]): Bracket | null {
  const seeds = [...pool].sort((a, b) => (b.eci ?? -1) - (a.eci ?? -1)).slice(0, 8);
  if (seeds.length < 8) return null;
  let alive = ORDER_8.map((i) => seeds[i]);
  const rounds: Match[][] = [];
  while (alive.length > 1) {
    const matches: Match[] = [];
    for (let i = 0; i < alive.length; i += 2) {
      const [a, b] = [alive[i], alive[i + 1]];
      const fight = planFight(data, a, b, roundIds);
      const tiebreak = fight.winner === -1;
      const winner = tiebreak ? (seeds.indexOf(a) < seeds.indexOf(b) ? a : b) : fight.fighters[fight.winner as 0 | 1];
      matches.push({ a, b, fight, winner, tiebreak });
    }
    rounds.push(matches);
    alive = matches.map((m) => m.winner);
  }
  return { seeds, rounds, champion: alive[0] };
}
