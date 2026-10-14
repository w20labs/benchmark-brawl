/**
 * Season 2 proof: plays the belt rulebook (v1.1) over the roster, week by week, as if belts had started earlier.
 * Only the roster is "as of" each date (models released by then); scores are today's. Pure: pass the data in.
 *
 *   npx tsx prototypes/season2/simulate.ts [--top 3] [--all3] [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { judgeRound, planFight, type FightResult } from '../../src/fight.ts';
import { runTournament, type Bracket } from '../../src/league.ts';
import type { BrawlData, Model } from '../../src/types.ts';

export const RULES = 'v1.1';
export const ROUNDS = ['coding', 'math', 'science', 'facts', 'puzzles'];
/** A title fight needs this many rounds both fighters have results for, checked before booking it. */
export const MIN_SHARED = 3;

export type BeltId = 'undisputed' | 'open' | 'budget' | 'premium';
export const BELTS: Record<BeltId, { name: string; test: (m: Model) => boolean }> = {
  undisputed: { name: 'Undisputed', test: () => true },
  open: { name: 'Open weights', test: (m) => m.open },
  budget: { name: 'Budget', test: (m) => !!m.price && m.price.blended < 1 },
  premium: { name: 'Premium', test: (m) => !!m.price && m.price.blended > 5 },
};
export type Options = {
  /** Only the top N eligible models by Capabilities Index can challenge (0 = anyone). */
  topN: number;
  /** Rounds (of 5) a model needs results in to be eligible, per belt. Default 4. */
  minRounds: Partial<Record<BeltId, number>>;
  /** For tests: a model's class membership can change over time (a price change). Default: never. */
  inClass?: (belt: BeltId, m: Model, day: string) => boolean;
};
export const defaults = (): Options => ({ topN: 3, minRounds: {} });

const benchesOf = (data: BrawlData, id: string) => data.rounds.find((r) => r.id === id)!.benches;
const hasRound = (data: BrawlData, id: string, m: Model) => benchesOf(data, id).some((b) => !!m.scores[b]);
export const eligible = (data: BrawlData, o: Options, belt: BeltId, m: Model, day = '9999') =>
  (o.inClass ?? ((b, x) => BELTS[b].test(x)))(belt, m, day) && ROUNDS.filter((r) => hasRound(data, r, m)).length >= (o.minRounds[belt] ?? 4);
/** Rounds the two can actually be compared on. */
export const sharedRounds = (data: BrawlData, a: Model, b: Model) =>
  ROUNDS.filter((id) => judgeRound(data, data.rounds.find((r) => r.id === id)!, a, b).winner != null).length;
/** The championship-round scores a fight depends on: same fingerprints, same result. */
export const fingerprint = (data: BrawlData, m: Model) =>
  JSON.stringify(ROUNDS.flatMap((id) => benchesOf(data, id)).map((b) => m.scores[b] ? [b, m.scores[b].v, m.scores[b].se] : null).filter(Boolean));
/** Order-independent: who is champion doesn't matter. */
const pairKey = (data: BrawlData, a: Model, b: Model) => [a, b].map((m) => `${m.id}:${fingerprint(data, m)}`).sort().join('|');

/** Every pairing the season played, opening brackets included, order-independent with score fingerprints. */
export function allPairings(data: BrawlData, r: ReturnType<typeof simulate>) {
  const byId = (id: string) => data.models.find((m) => m.id === id)!;
  return [
    ...r.openings.flatMap((x) => x.bracket.rounds.flat().map((m) => pairKey(data, m.a, m.b))),
    ...r.fights.map((f) => pairKey(data, byId(f.champion), byId(f.challenger))),
  ];
}
export const repeatPairings = (data: BrawlData, r: ReturnType<typeof simulate>) => { const p = allPairings(data, r); return p.length - new Set(p).size; };
export const minSharedEver = (data: BrawlData, r: ReturnType<typeof simulate>) => Math.min(...r.openings.flatMap((x) => x.bracket.rounds.flat().map((m) => sharedRounds(data, m.a, m.b))), ...r.fights.map((f) => f.shared));

export type TitleFight = {
  day: string; belt: BeltId; champion: string; challenger: string; why: 'new challenger' | 'top contender' | 'vacant';
  outcome: 'retains' | 'new champion' | 'draw retains' | 'vacant filled'; decision: FightResult['decision']; hp: [number, number];
  roundsWon: [number, number]; shared: number; fight: FightResult; rules: string;
};
export type Reign = { belt: BeltId; model: string; from: string; to: string | null; defenses: number; how: string; ended?: string };

const DAY = 864e5, addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);

export function simulate(data: BrawlData, belts: BeltId[], start: string, end: string, nights: number[], o: Options = defaults()) {
  const rosterOn = (day: string) => data.models.filter((m) => m.released <= day);
  const ranked = (ms: Model[]) => [...ms].sort((a, b) => (b.eci ?? -1) - (a.eci ?? -1) || a.id.localeCompare(b.id));
  const champ = new Map<BeltId, Model | null>(), shots = new Map<BeltId, Set<string>>();
  const fights: TitleFight[] = [], reigns: Reign[] = [], openings: { belt: BeltId; day: string; bracket: Bracket; pool: number }[] = [];
  const open = (belt: BeltId) => reigns.findLast((r) => r.belt === belt && r.to == null);
  const crown = (belt: BeltId, m: Model, day: string, how: string) => { champ.set(belt, m); reigns.push({ belt, model: m.id, from: day, to: null, defenses: 0, how }); };
  const fightable = (a: Model, b: Model) => sharedRounds(data, a, b) >= MIN_SHARED;
  const met = new Set<string>();

  // each belt opens with a tournament on the first day it has a valid field: 8 eligible models where every pair is
  // comparable (any two can meet in a bracket) and hasn't already met on current scores (in another belt's opening or
  // a title fight). The highest-ranked such field: rank order, skipping a model only when no valid field includes it.
  const field = (pool: Model[]) => {
    const order = ranked(pool), ok = (x: Model, y: Model) => fightable(x, y) && !met.has(pairKey(data, x, y));
    const pick = (from: number, f: Model[]): Model[] | null => {
      if (f.length === 8) return f;
      for (let i = from; i <= order.length - (8 - f.length); i++) {
        if (!f.every((x) => ok(x, order[i]))) continue;
        const done = pick(i + 1, [...f, order[i]]);
        if (done) return done;
      }
      return null;
    };
    return pick(0, []);
  };
  const starts = new Map<BeltId, string>();

  // one day at a time, so a meeting only counts once it has happened: openings first, then that night's title fight
  let turn = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    for (const belt of belts) {
      if (starts.has(belt)) continue;
      const pool = rosterOn(day).filter((m) => eligible(data, o, belt, m, day)), f = field(pool);
      if (!f) continue; // no valid field yet: the belt opens later
      const bracket = runTournament(data, f, ROUNDS)!;
      for (const round of bracket.rounds) for (const m of round) met.add(pairKey(data, m.a, m.b));
      starts.set(belt, day); shots.set(belt, new Set(pool.map((m) => m.id))); openings.push({ belt, day, bracket, pool: pool.length });
      crown(belt, bracket.champion, day, 'won the opening tournament');
    }
    if (!nights.includes(new Date(day).getUTCDay())) continue;
    const live = belts.filter((b) => starts.has(b) && starts.get(b)! < day);
    if (!live.length) continue;
    const belt = live[turn++ % live.length], pool = rosterOn(day).filter((m) => eligible(data, o, belt, m, day)), seen = shots.get(belt)!;
    let c = champ.get(belt) ?? null;

    // a champion who no longer qualifies (left the roster or the class) gives up the belt
    if (c && !pool.some((m) => m.id === c!.id)) {
      Object.assign(open(belt)!, { to: day, ended: 'vacated: no longer eligible' });
      champ.set(belt, null); c = null;
    }
    const record = (champion: Model, challenger: Model, why: TitleFight['why'], fight: FightResult, outcome: TitleFight['outcome']) => {
      met.add(pairKey(data, champion, challenger));
      fights.push({ day, belt, champion: champion.id, challenger: challenger.id, why, outcome, decision: fight.decision, hp: fight.hp, roundsWon: fight.roundsWon, shared: sharedRounds(data, champion, challenger), fight, rules: RULES });
    };

    if (!c) {
      // vacant: the top two eligible contenders who can be compared fight for it; a draw goes to the higher-ranked one
      const order = ranked(pool.filter((m) => m.eci != null));
      let pair: [Model, Model] | null = null;
      for (let i = 0; i < order.length && !pair; i++) for (let j = i + 1; j < order.length && !pair; j++) if (fightable(order[i], order[j]) && !met.has(pairKey(data, order[i], order[j]))) pair = [order[i], order[j]];
      for (const m of pool) seen.add(m.id);
      if (!pair) continue; // stays vacant until two can fight
      const fight = planFight(data, pair[0], pair[1], ROUNDS), w = fight.winner === 1 ? pair[1] : pair[0];
      record(pair[0], pair[1], 'vacant', fight, 'vacant filled');
      crown(belt, w, day, fight.winner === -1 ? `drew the vacant-title fight, ranked higher` : `won the vacant-title fight vs ${(w === pair[0] ? pair[1] : pair[0]).name}`);
      continue;
    }

    const champion = c;
    const top = o.topN ? new Set(ranked(pool.filter((m) => m.id !== champion.id && m.eci != null)).slice(0, o.topN).map((m) => m.id)) : null;
    const contenders = ranked(pool.filter((m) => m.id !== champion.id && (!top || top.has(m.id)) && !met.has(pairKey(data, champion, m)) && fightable(champion, m)));
    const fresh = contenders.filter((m) => !seen.has(m.id));
    for (const m of pool) seen.add(m.id);
    const ch = fresh[0] ?? contenders[0];
    if (!ch) continue; // nobody new to fight: no title fight this week
    const fight = planFight(data, champion, ch, ROUNDS);
    const outcome = fight.winner === -1 ? 'draw retains' : fight.winner === 0 ? 'retains' : 'new champion';
    record(champion, ch, fresh[0] ? 'new challenger' : 'top contender', fight, outcome);
    if (outcome === 'new champion') {
      Object.assign(open(belt)!, { to: day, ended: `lost to ${ch.name}` });
      crown(belt, ch, day, `beat ${champion.name} (${fight.decision === 'ko' ? 'K.O.' : fight.decision})`);
    } else open(belt)!.defenses++;
  }
  return { fights, reigns, openings, starts: Object.fromEntries(belts.map((b) => [b, starts.get(b) ?? null])) as Record<BeltId, string | null>, champions: Object.fromEntries([...champ].map(([k, v]) => [k, v?.id ?? null])) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
  const name = (id: string) => data.models.find((m) => m.id === id)!.name, org = (id: string) => data.models.find((m) => m.id === id)!.org;
  const end = new Date().toISOString().slice(0, 10), o = defaults();
  const tn = process.argv.indexOf('--top'); if (tn > 0) o.topN = Number(process.argv[tn + 1]);
  if (process.argv.includes('--all3')) for (const b of Object.keys(BELTS) as BeltId[]) o.minRounds[b] = 3;
  for (const b of Object.keys(BELTS) as BeltId[]) console.log(`${BELTS[b].name.padEnd(13)} eligible now: ${data.models.filter((m) => eligible(data, o, b, m)).length}/${data.models.length}`);
  for (const [cad, nights] of [['weekly', [0]], ['twice', [0, 3]]] as const) {
    const r = simulate(data, ['undisputed', 'open'], '2025-10-01', end, [...nights], o), f = r.fights, count = (x: string) => f.filter((y) => y.outcome === x).length;
    console.log(`\n== ${cad}: ${f.length} title fights · ${count('new champion')} changes · ${count('retains')} defenses · ${count('draw retains')} draws · ${f.filter((x) => Math.max(...x.hp) === 100 && Math.min(...x.hp) === 0).length} shutouts · ${f.filter((x) => org(x.champion) === org(x.challenger)).length} same-lab · ${repeatPairings(data, r)} repeat pairings (openings included) · min shared ${minSharedEver(data, r)}`);
    for (const b of ['undisputed', 'open'] as const) console.log(`  ${BELTS[b].name.padEnd(13)} from ${r.starts[b]}: ${r.reigns.filter((x) => x.belt === b).map((x) => `${name(x.model)}${x.defenses ? ` (${x.defenses}d)` : ''} ${x.from.slice(5)}`).join(' → ')}`);
  }
  const out = process.argv.indexOf('--json');
  if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify(simulate(data, ['undisputed', 'open'], '2025-10-01', end, [0], o), null, 1));
}
