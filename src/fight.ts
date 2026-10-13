/** The rules of a brawl. Pure functions: the page replays what these decide. */
import type { Benchmark, BrawlData, Model, Round } from './types.ts';

export const START_HP = 100;
/** Each percentage point of score gap is worth this much damage. */
export const DAMAGE_PER_POINT = 2;
/** Price round: every doubling of price is worth this many "points" (so 2× cheaper hits like a 10-point win). */
export const PRICE_POINTS_PER_DOUBLING = 10;
/** Prices within 15% of each other are a tie. */
export const PRICE_TIE_RATIO = 1.15;
/** Two scores closer than this many standard errors (combined) are a statistical tie. */
export const TIE_Z = 1.96;

export type WeaponId = 'mg' | 'rocket' | 'meteor' | 'laser' | 'tie';
export const WEAPONS: { id: Exclude<WeaponId, 'tie'>; name: string; maxPoints: number }[] = [
  { id: 'mg', name: 'MACHINE GUN', maxPoints: 4 },
  { id: 'rocket', name: 'ROCKET LAUNCHER', maxPoints: 9 },
  { id: 'meteor', name: 'METEOR SHOWER', maxPoints: 15 },
  { id: 'laser', name: 'ORBITAL LASER', maxPoints: Infinity },
];
export const weaponFor = (points: number): WeaponId => (points <= 0 ? 'tie' : WEAPONS.find((w) => points <= w.maxPoints)!.id);
export const weaponName = (id: WeaponId) => (id === 'tie' ? 'CROSSFIRE' : WEAPONS.find((w) => w.id === id)!.name);

export type RoundResult = {
  round: Round;
  /** The benchmark that decided it, or null when the two have no benchmark in common for this round. */
  bench: Benchmark | null;
  /** Raw values: percent for scores, blended $/M tokens for price. */
  values: [number | null, number | null];
  /** -1 tie, 0 or 1 the winner, null when there is no data. */
  winner: -1 | 0 | 1 | null;
  tie: 'exact' | 'margin' | 'price' | null;
  /** The margin of error used for the tie call, in percentage points (scores only). */
  margin: number | null;
  /** Weapon-scale points: the score gap, or PRICE_POINTS_PER_DOUBLING per doubling of price. */
  points: number;
  dmg: number;
  weapon: WeaponId;
  hpBefore: [number, number];
  hpAfter: [number, number];
};

export type FightResult = {
  fighters: [Model, Model];
  rounds: RoundResult[];
  hp: [number, number];
  /** -1 draw, else the winner's index. */
  winner: -1 | 0 | 1;
  ko: boolean;
  roundsWon: [number, number];
};

const benchById = (data: BrawlData, id: string) => data.benchmarks.find((b) => b.id === id)!;

/** The first benchmark in the round that both fighters have, or null. */
export function pickBench(data: BrawlData, round: Round, a: Model, b: Model): Benchmark | null {
  for (const id of round.benches) {
    const bench = benchById(data, id);
    if (bench.kind === 'price' ? a.price && b.price : a.scores[id] && b.scores[id]) return bench;
  }
  return null;
}

export function judgeRound(data: BrawlData, round: Round, a: Model, b: Model): Omit<RoundResult, 'hpBefore' | 'hpAfter'> {
  const bench = pickBench(data, round, a, b);
  const none = { round, bench, values: [null, null] as [null, null], winner: null, tie: null, margin: null, points: 0, dmg: 0, weapon: 'tie' as const };
  if (!bench) return none;
  if (bench.kind === 'price') {
    const pa = a.price!.blended, pb = b.price!.blended;
    const ratio = Math.max(pa, pb) / Math.min(pa, pb);
    const values: [number, number] = [pa, pb];
    if (ratio < PRICE_TIE_RATIO) return { ...none, bench, values, winner: -1, tie: 'price' };
    const points = Math.round(Math.log2(ratio) * PRICE_POINTS_PER_DOUBLING * 10) / 10;
    return { ...none, bench, values, winner: pa < pb ? 0 : 1, points, dmg: Math.round(points * DAMAGE_PER_POINT), weapon: weaponFor(points) };
  }
  const sa = a.scores[bench.id], sb = b.scores[bench.id];
  const values: [number, number] = [sa.v, sb.v];
  const gap = Math.round(Math.abs(sa.v - sb.v) * 10) / 10;
  const margin = sa.se != null && sb.se != null ? Math.round(TIE_Z * Math.hypot(sa.se, sb.se) * 10) / 10 : null;
  if (gap < 0.5) return { ...none, bench, values, winner: -1, tie: 'exact', margin };
  if (margin != null && gap <= margin) return { ...none, bench, values, winner: -1, tie: 'margin', margin };
  return { ...none, bench, values, winner: sa.v > sb.v ? 0 : 1, margin, points: gap, dmg: Math.round(gap * DAMAGE_PER_POINT), weapon: weaponFor(gap) };
}

/** Plays every round in order; stops early on a K.O. */
export function planFight(data: BrawlData, a: Model, b: Model, roundIds: string[]): FightResult {
  const hp: [number, number] = [START_HP, START_HP];
  const rounds: RoundResult[] = [];
  for (const id of roundIds) {
    if (hp[0] === 0 || hp[1] === 0) break;
    const round = data.rounds.find((r) => r.id === id);
    if (!round) continue;
    const r = judgeRound(data, round, a, b);
    const hpBefore: [number, number] = [...hp];
    if (r.winner === 0 || r.winner === 1) hp[1 - r.winner] = Math.max(0, hp[1 - r.winner] - r.dmg);
    rounds.push({ ...r, hpBefore, hpAfter: [...hp] });
  }
  const roundsWon: [number, number] = [rounds.filter((r) => r.winner === 0).length, rounds.filter((r) => r.winner === 1).length];
  return { fighters: [a, b], rounds, hp, winner: hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1, ko: hp[0] === 0 || hp[1] === 0, roundsWon };
}

/** "73.6" for scores, "$4.00" for prices. */
export function formatValue(bench: Benchmark | null, v: number | null): string {
  if (v == null || !bench) return '–';
  return bench.kind === 'price' ? `$${v.toFixed(2)}` : v.toFixed(1);
}
