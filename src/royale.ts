/**
 * Battle royale: 3 to 8 models in one arena. Each round, the model with the best result on the
 * round's benchmark fires at every other model; each takes 2 × its gap to the leader, unless it
 * is within the margin of error (it dodges). At 0 HP a model is out. Last one standing, or the
 * most HP after the last round, wins.
 */
import { compareOn, hasBench, START_HP, stylePicker, type RoundResult, type WeaponId } from './fight.ts';
import type { Benchmark, BrawlData, Model, Round } from './types.ts';

export const ROYALE_MIN = 3, ROYALE_MAX = 8;

/** One shot from the round leader at another fighter. */
export type RoyaleHit = {
  target: number;
  /** Ties within the margin (or exact, or price within 15%) dodge. */
  tie: RoundResult['tie'];
  margin: number | null;
  points: number;
  dmg: number;
  weapon: WeaponId;
  /** Which style of the weapon to show: the leader switches weapons rather than repeating one. */
  style: string;
};

export type RoyaleRound = {
  round: Round;
  /** The benchmark most of the fighters still standing have (the earlier one on a tie), or null. */
  bench: Benchmark | null;
  /** Per fighter: its result, or null when it is out or has no result (it sits the round out). */
  values: (number | null)[];
  /** Fighters that took part: standing and with a result. */
  inRound: number[];
  /** The best result; others tied with it within the margin are co-leaders and don't fire. */
  leader: number | null;
  hits: RoyaleHit[];
  hpBefore: number[];
  hpAfter: number[];
  /** Knocked out this round. */
  out: number[];
};

export type RoyaleResult = {
  fighters: Model[];
  rounds: RoyaleRound[];
  hp: number[];
  /** Fighter indices, best first: still standing by HP, then the knocked out, last out first. */
  placing: number[];
  /** Round index each fighter was knocked out in, or null. */
  outIn: (number | null)[];
  /** Index of the winner, or -1 when the top two finish level. */
  winner: number;
};

/** The round's benchmark with the most standing fighters on it (at least two), earlier first on a tie. */
function benchFor(data: BrawlData, round: Round, standing: Model[]): Benchmark | null {
  let best: Benchmark | null = null, n = 1;
  for (const id of round.benches) {
    const b = data.benchmarks.find((x) => x.id === id)!;
    const c = standing.filter((m) => hasBench(b, m)).length;
    if (c > n) { best = b; n = c; }
  }
  return best;
}

export function planRoyale(data: BrawlData, fighters: Model[], roundIds: string[]): RoyaleResult {
  const hp = fighters.map(() => START_HP);
  const outIn: (number | null)[] = fighters.map(() => null);
  const rounds: RoyaleRound[] = [];
  const pick = stylePicker();
  for (const id of roundIds) {
    if (hp.filter((x) => x > 0).length < 2) break;
    const round = data.rounds.find((r) => r.id === id);
    if (!round) continue;
    const standing = fighters.map((_, i) => i).filter((i) => hp[i] > 0);
    const bench = benchFor(data, round, standing.map((i) => fighters[i]));
    if (!bench) continue; // nobody shares a benchmark for this round: leave it out rather than play it empty
    const inRound = standing.filter((i) => hasBench(bench, fighters[i]));
    const values = fighters.map((m, i) => (bench && inRound.includes(i) ? (bench.kind === 'price' ? m.price!.blended : m.scores[bench.id].v) : null));
    const better = (i: number, j: number) => (bench!.kind === 'price' ? values[i]! < values[j]! : values[i]! > values[j]!);
    const leader = inRound.length ? inRound.reduce((a, b) => (better(b, a) ? b : a)) : null;
    const hpBefore = [...hp];
    const hits: RoyaleHit[] = [];
    for (const i of inRound) {
      if (i === leader) continue;
      const c = compareOn(bench, fighters[leader!], fighters[i]);
      hits.push({ target: i, tie: c.tie, margin: c.margin, points: c.points, dmg: c.dmg, weapon: c.weapon, style: pick(leader!, c.weapon) });
      hp[i] = Math.max(0, hp[i] - c.dmg);
    }
    const out = standing.filter((i) => hp[i] === 0);
    for (const i of out) outIn[i] = rounds.length;
    rounds.push({ round, bench, values, inRound, leader, hits, hpBefore, hpAfter: [...hp], out });
  }
  const placing = fighters.map((_, i) => i).sort((a, b) =>
    (outIn[b] ?? Infinity) - (outIn[a] ?? Infinity) || hp[b] - hp[a] ||
    (outIn[a] != null ? rounds[outIn[a]!].hpBefore[b] - rounds[outIn[a]!].hpBefore[a] : 0));
  const [p1, p2] = placing;
  const winner = outIn[p1] == null && outIn[p2] == null && hp[p1] === hp[p2] ? -1 : p1;
  return { fighters, rounds, hp, placing, outIn, winner };
}
