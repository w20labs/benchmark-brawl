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
/** A tie still grazes both fighters for this much HP. It never knocks anyone out (it stops at 1 HP). */
export const TIE_GRAZE = 3;

export type WeaponId = 'mg' | 'rocket' | 'meteor' | 'laser' | 'tie';
export const WEAPONS: { id: Exclude<WeaponId, 'tie'>; name: string; maxPoints: number }[] = [
  { id: 'mg', name: 'MACHINE GUN', maxPoints: 4 },
  { id: 'rocket', name: 'ROCKET LAUNCHER', maxPoints: 9 },
  { id: 'meteor', name: 'METEOR SHOWER', maxPoints: 15 },
  { id: 'laser', name: 'ORBITAL LASER', maxPoints: Infinity },
];
export const weaponFor = (points: number): WeaponId => (points <= 0 ? 'tie' : WEAPONS.find((w) => points <= w.maxPoints)!.id);
export const weaponName = (id: WeaponId) => (id === 'tie' ? 'CROSSFIRE' : WEAPONS.find((w) => w.id === id)!.name);

/** Each weapon size comes in several styles. The size still says how big the gap was; the style keeps fights fresh. */
export const STYLES: Record<WeaponId, string[]> = {
  mg: ['glove', 'pie', 'balloon', 'chicken', 'boomerang', 'pebble', 'tokens'],
  rocket: ['rocket', 'grenade', 'plasma', 'bowling', 'drone', 'cannon'],
  meteor: ['meteor', 'lightning', 'swarm', 'piano', 'tornado'],
  laser: ['laser', 'anvil', 'blackhole', 'foot'],
  tie: ['glove', 'pie', 'balloon', 'chicken', 'boomerang', 'pebble', 'tokens'],
};
export const STYLE_NAMES: Record<string, string> = {
  glove: 'BOXING GLOVE', pie: 'PIE IN THE FACE', balloon: 'WATER BALLOON', chicken: 'RUBBER CHICKEN', boomerang: 'BOOMERANG', pebble: 'SLINGSHOT', tokens: 'TOKEN SPRAY',
  rocket: 'ROCKET LAUNCHER', grenade: 'GRENADE', plasma: 'PLASMA BALL', bowling: 'BOWLING BALL', drone: 'DRONE STRIKE', cannon: 'CANNONBALL',
  meteor: 'METEOR SHOWER', lightning: 'LIGHTNING STORM', swarm: 'MISSILE SWARM', piano: 'PIANO DROP', tornado: 'TORNADO',
  laser: 'ORBITAL LASER', anvil: 'SPACE ANVIL', blackhole: 'BLACK HOLE', foot: 'GIANT FOOT',
};
const TIERS: WeaponId[] = ['mg', 'rocket', 'meteor', 'laser'];
/**
 * Picks weapon styles. In a fight (`unique`), no style is used twice by anyone: each hit takes an unused style of its
 * size, or, if that size has run out, the nearest size down (then up) that still has one. In a battle royale there
 * are too many shots for that, so each shooter just never repeats its previous style. Deterministic either way.
 */
export function stylePicker(unique = true, seed = '') {
  // each fight gets its own order of styles, fixed by the seed (the matchup), so share links replay the same weapons
  let x = 0x811c9dc5; for (let i = 0; i < seed.length; i++) { x ^= seed.charCodeAt(i); x = Math.imul(x, 16777619); }
  const rnd = () => { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const order = Object.fromEntries(TIERS.map((t) => { const a = [...STYLES[t]]; if (seed) for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return [t, a]; }));
  const used = new Set<string>(), last = new Map<string, string>(), count = new Map<string, number>();
  return (shooter: string | number, weapon: WeaponId): string => {
    const key = String(shooter), prev = last.get(key), tier = weapon === 'tie' ? 'mg' : weapon;
    let style: string | undefined;
    if (unique) {
      const i = TIERS.indexOf(tier), order2 = [tier, ...TIERS.slice(0, i).reverse(), ...TIERS.slice(i + 1)];
      for (const t of order2) { style = order[t].find((x: string) => !used.has(x)); if (style) break; }
    } else {
      const options = order[tier], n = count.get(key) ?? 0;
      style = options[n % options.length] === prev ? options[(n + 1) % options.length] : options[n % options.length];
      count.set(key, n + 1);
    }
    style ??= STYLES[tier].find((x) => x !== prev) ?? STYLES[tier][0];
    used.add(style); last.set(key, style);
    return style;
  };
}

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
  /** For an averaged round: each benchmark both had, with both scores. `bench` is then a summary of them. */
  parts?: { bench: Benchmark; values: [number, number] }[];
  /** Weapon-scale points: the score gap, or PRICE_POINTS_PER_DOUBLING per doubling of price. */
  points: number;
  dmg: number;
  weapon: WeaponId;
  /** HP each fighter lost to a tie's graze (0 unless the round was a tie). */
  graze: [number, number];
  /** Which style of the weapon to show (see STYLES). */
  style: string;
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
  /** How it was won. Without a K.O., the most HP wins "by decision": unanimous if it also won more rounds, split if not. */
  decision: 'ko' | 'unanimous' | 'split' | 'draw';
  roundsWon: [number, number];
  /** Rounds left out because the two have no benchmark in common for them. */
  skipped: Round[];
};

const benchById = (data: BrawlData, id: string) => data.benchmarks.find((b) => b.id === id)!;

/** The first benchmark in the round that both fighters have, or null. */
export function pickBench(data: BrawlData, round: Round, a: Model, b: Model): Benchmark | null {
  for (const id of round.benches) {
    const bench = benchById(data, id);
    if (hasBench(bench, a) && hasBench(bench, b)) return bench;
  }
  return null;
}

export function judgeRound(data: BrawlData, round: Round, a: Model, b: Model): Omit<RoundResult, 'hpBefore' | 'hpAfter' | 'graze' | 'style'> {
  if (round.combine === 'average') {
    const shared = round.benches.map((id) => benchById(data, id)).filter((bench) => bench.kind === 'score' && hasBench(bench, a) && hasBench(bench, b));
    if (shared.length > 1) return { round, ...compareAverage(round, shared, a, b) };
  }
  return { round, ...compareOn(pickBench(data, round, a, b), a, b) };
}

/**
 * Averages over several benchmarks both fighters have: the gap is the mean of the per-benchmark gaps, and the
 * margin of error combines all of theirs (it shrinks as more benchmarks agree). Compares like with like only.
 */
export function compareAverage(round: Round, benches: Benchmark[], a: Model, b: Model): Omit<RoundResult, 'round' | 'hpBefore' | 'hpAfter' | 'graze' | 'style'> {
  const n = benches.length;
  const parts = benches.map((bench) => ({ bench, values: [a.scores[bench.id].v, b.scores[bench.id].v] as [number, number] }));
  const mean = (k: 0 | 1) => Math.round((parts.reduce((s, p) => s + p.values[k], 0) / n) * 10) / 10;
  const values: [number, number] = [mean(0), mean(1)];
  const ses = benches.flatMap((bench) => [a.scores[bench.id].se, b.scores[bench.id].se]);
  const margin = ses.every((x) => x != null) ? Math.round((TIE_Z * Math.sqrt(ses.reduce((s, x) => s + x! ** 2, 0)) / n) * 10) / 10 : null;
  const bench: Benchmark = {
    id: `${round.id}-average`, name: `Average of ${benches.map((x) => x.name).join(' + ')}`, kind: 'score', epochRun: benches.every((x) => x.epochRun),
    what: `The average over the ${n} ${round.name.toLowerCase()} benchmarks both models have`, source: benches[0].source,
  };
  const gap = Math.round(Math.abs(values[0] - values[1]) * 10) / 10;
  const none = { bench, values, parts, margin, points: 0, dmg: 0, weapon: 'tie' as const };
  if (gap < 0.5) return { ...none, winner: -1, tie: 'exact' };
  if (margin != null && gap <= margin) return { ...none, winner: -1, tie: 'margin' };
  return { ...none, winner: values[0] > values[1] ? 0 : 1, tie: null, points: gap, dmg: Math.round(gap * DAMAGE_PER_POINT), weapon: weaponFor(gap) };
}

/** Compares two models on one benchmark (which both must have). Shared by fights and royales. */
export function compareOn(bench: Benchmark | null, a: Model, b: Model): Omit<RoundResult, 'round' | 'hpBefore' | 'hpAfter' | 'graze' | 'style'> {
  const none = { bench, values: [null, null] as [null, null], winner: null, tie: null, margin: null, points: 0, dmg: 0, weapon: 'tie' as const };
  if (!bench) return none;
  if (bench.kind === 'price') {
    const pa = a.price!.blended, pb = b.price!.blended;
    const ratio = Math.max(pa, pb) / Math.min(pa, pb);
    const values: [number, number] = [pa, pb];
    if (ratio < PRICE_TIE_RATIO) return { ...none, values, winner: -1, tie: 'price' };
    const points = Math.round(Math.log2(ratio) * PRICE_POINTS_PER_DOUBLING * 10) / 10;
    return { ...none, values, winner: pa < pb ? 0 : 1, points, dmg: Math.round(points * DAMAGE_PER_POINT), weapon: weaponFor(points) };
  }
  const sa = a.scores[bench.id], sb = b.scores[bench.id];
  const values: [number, number] = [sa.v, sb.v];
  const gap = Math.round(Math.abs(sa.v - sb.v) * 10) / 10;
  const margin = sa.se != null && sb.se != null ? Math.round(TIE_Z * Math.hypot(sa.se, sb.se) * 10) / 10 : null;
  if (gap < 0.5) return { ...none, values, winner: -1, tie: 'exact', margin };
  if (margin != null && gap <= margin) return { ...none, values, winner: -1, tie: 'margin', margin };
  return { ...none, values, winner: sa.v > sb.v ? 0 : 1, margin, points: gap, dmg: Math.round(gap * DAMAGE_PER_POINT), weapon: weaponFor(gap) };
}

/** True when the model has a result for this benchmark. */
export const hasBench = (bench: Benchmark, m: Model) => (bench.kind === 'price' ? !!m.price : !!m.scores[bench.id]);

/** Plays every round in order; stops early on a K.O. Rounds with no shared benchmark are left out, not played empty. */
export function planFight(data: BrawlData, a: Model, b: Model, roundIds: string[]): FightResult {
  const hp: [number, number] = [START_HP, START_HP];
  const rounds: RoundResult[] = [], skipped: Round[] = [];
  const pick = stylePicker(true, `${a.id}|${b.id}|${roundIds.join(',')}`);
  for (const id of roundIds) {
    if (hp[0] === 0 || hp[1] === 0) break;
    const round = data.rounds.find((r) => r.id === id);
    if (!round) continue;
    const r = judgeRound(data, round, a, b);
    if (r.winner == null) { skipped.push(round); continue; }
    const hpBefore: [number, number] = [...hp];
    const graze: [number, number] = [0, 0];
    if (r.winner === 0 || r.winner === 1) hp[1 - r.winner] = Math.max(0, hp[1 - r.winner] - r.dmg);
    else if (r.winner === -1) for (const k of [0, 1] as const) { graze[k] = Math.max(0, Math.min(TIE_GRAZE, hp[k] - 1)); hp[k] -= graze[k]; }
    rounds.push({ ...r, graze, style: pick(r.winner === -1 ? 'tie' : r.winner, r.weapon), hpBefore, hpAfter: [...hp] });
  }
  const roundsWon: [number, number] = [rounds.filter((r) => r.winner === 0).length, rounds.filter((r) => r.winner === 1).length];
  const winner = hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1, ko = hp[0] === 0 || hp[1] === 0;
  const decision = winner === -1 ? 'draw' : ko ? 'ko' : roundsWon[winner] > roundsWon[1 - winner] ? 'unanimous' : 'split';
  return { fighters: [a, b], rounds, hp, winner, ko, decision, roundsWon, skipped };
}

/** "73.6" for scores, "$4.00" for prices. */
export function formatValue(bench: Benchmark | null, v: number | null): string {
  if (v == null || !bench) return '–';
  return bench.kind === 'price' ? `$${v.toFixed(2)}` : v.toFixed(1);
}
