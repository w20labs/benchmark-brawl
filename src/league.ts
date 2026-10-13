/** Weight classes, new challengers and tournaments: everything above a single fight. */
import { planFight, type FightResult } from './fight.ts';
import type { BrawlData, Model } from './types.ts';

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
/** The fight to feature: the newest challenger against the champion (or the runner-up if the newest is the champion). */
export function featuredFight(models: Model[], now: Date): [Model, Model] | null {
  const fresh = newChallengers(models, now)[0];
  if (!fresh) return null;
  const champ = champion(models);
  const rival = champ.id !== fresh.id ? champ : [...models].filter((m) => m.id !== fresh.id && m.eci != null).sort((a, b) => b.eci! - a.eci!)[0];
  return rival ? [fresh, rival] : null;
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
