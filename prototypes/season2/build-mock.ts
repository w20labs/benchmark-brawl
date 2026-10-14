/** Data for the Season 2 mock: belts, title history, one title fight with commentary, the next challenger, proof stats. */
import { readFileSync, writeFileSync } from 'node:fs';
import { STYLE_NAMES, formatValue, type FightResult } from '../../src/fight.ts';
import type { BrawlData } from '../../src/types.ts';
// @ts-expect-error plain JS page module
import { moveNameFor } from '../../src/page/specials.js';
import { BELTS, RULES, ROUNDS, defaults, eligible as eligibleIn, minSharedEver, repeatPairings, simulate, type BeltId, type Options } from './simulate.ts';

const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const M = (id: string) => data.models.find((m) => m.id === id)!;
const who = (id: string) => { const m = M(id); return { id, name: m.name, org: m.org, open: m.open, price: m.price?.blended ?? null, released: m.released }; };
const TODAY = '2026-10-13', NEXT = '2026-11-01', belts: BeltId[] = ['undisputed', 'open']; // Budget joins later (decided Oct 14)

const o = defaults(), eligible = (b: BeltId, m: (typeof data.models)[number], opts: Options = o) => eligibleIn(data, opts, b, m);
const r = simulate(data, belts, '2025-10-01', TODAY, [0], o);
const past = r.fights, upcoming = simulate(data, belts, '2025-10-01', NEXT, [0], o).fights.filter((f) => f.day > TODAY);

// commentary: Hank calls the action, Sam says what the numbers support
function call(f: FightResult, beltName: string) {
  const [a, b] = f.fighters, n = (k: number) => f.fighters[k].name, lines: { round: string; hank: string; sam: string; hp: [number, number] }[] = [];
  lines.push({ round: 'Intro', hp: [100, 100], hank: `From inside the Context Window: the ${beltName} champion, ${a.name}! And the challenger, ${b.name}!`, sam: `Five championship rounds: Coding, Math, Science, Facts, Puzzles. Same five for every title fight. Each model plays its best reasoning setting.` });
  // as in the game: each fighter's biggest hit plays its lab's signature move instead of the weapon
  const big = [0, 1].map((k) => { let best = -1, d = 0; f.rounds.forEach((R, i) => { if (R.winner === k && R.dmg > d) { d = R.dmg; best = i; } }); return best; });
  for (const [i, R] of f.rounds.entries()) {
    const [va, vb] = R.values.map((v) => formatValue(R.bench, v)), bench = R.bench!.name.replace(/^Average of /, 'the average of ');
    const margin = R.margin != null ? `±${R.margin.toFixed(1)}` : null;
    if (R.winner === -1) {
      const [s0, s1] = R.tieStyles!.map((s) => STYLE_NAMES[s].toLowerCase());
      lines.push({ round: R.round.name, hp: R.hpAfter, hank: `Both swing! A ${s0} from ${n(0)}, a ${s1} from ${n(1)}! What a collision!`,
        sam: `${va}% against ${vb}% on ${bench}. ${margin ? `The difference is within the ${margin} point margin of error, so we call this round a tie.` : 'Equal scores, so we call this round a tie.'} Both lose 3 HP.` });
    } else {
      const w = R.winner as 0 | 1, gap = R.points.toFixed(1), [vw, vl] = w === 0 ? [va, vb] : [vb, va];
      lines.push({ round: R.round.name, hp: R.hpAfter, hank: big[w] === i ? `${moveNameFor(f.fighters[w].org)}! The signature move! ${n(w)} lands it! That's ${R.dmg} HP gone!` : `${STYLE_NAMES[R.style]}! ${n(w)} lands it! That's ${R.dmg} HP gone!`,
        sam: `${vw}% against ${vl}% on ${bench}: a ${gap} point gap${margin ? `, outside the ${margin} margin` : ' (this benchmark publishes no margin of error)'}. Twice the gap, rounded to whole HP: ${R.dmg} damage.` });
    }
  }
  const won = f.winner === -1 ? null : f.winner;
  lines.push({ round: 'Result', hp: f.hp, hank: won == null ? `A DRAW! The champion keeps the belt!` : won === 1 ? `${f.ko ? 'DOWN GOES' : 'IT\'S OVER FOR'} ${n(0).toUpperCase()}! WE HAVE A NEW ${beltName.toUpperCase()} CHAMPION!` : `${n(0)} defends! Still the ${beltName} champion!`,
    sam: `${n(won ?? 0)} won ${f.roundsWon[won ?? 0]} of ${f.rounds.length} rounds${f.ko ? ' and finished it by K.O.' : '.'}` });
  return lines;
}

const fightRow = (f: (typeof past)[number]) => ({ day: f.day, belt: f.belt, champion: who(f.champion), challenger: who(f.challenger), why: f.why, outcome: f.outcome, decision: f.decision, hp: f.hp, roundsWon: f.roundsWon,
  rounds: f.fight.rounds.map((R) => ({ name: R.round.name, winner: R.winner, bench: R.bench?.name ?? null, values: R.values, margin: R.margin })), rules: f.rules, shared: f.shared });
const featured = past.find((f) => f.champion === 'claudefable5' && f.challenger === 'gpt6astra')!;

const out = {
  today: TODAY, rules: `${RULES} (draft)`, rounds: ROUNDS,
  belts: belts.map((b) => {
    const reigns = r.reigns.filter((x) => x.belt === b), cur = reigns[reigns.length - 1]; // the backtest never leaves a belt vacant
    return { id: b, name: BELTS[b].name, started: r.starts[b], eligibleNow: data.models.filter((m) => eligible(b, m)).length,
      champion: { ...who(cur.model), since: cur.from, defenses: cur.defenses, how: cur.how },
      reigns: reigns.map((x) => ({ ...who(x.model), from: x.from, to: x.to, defenses: x.defenses, how: x.how, ended: x.ended ?? null })),
      next: upcoming.filter((f) => f.belt === b).map((f) => ({ day: f.day, challenger: who(f.challenger), why: f.why }))[0] ?? null,
      opening: (() => { const o = r.openings.find((x) => x.belt === b)!; return { day: o.day, pool: o.pool, rounds: o.bracket.rounds.map((rs) => rs.map((m) => ({ a: who(m.a.id), b: who(m.b.id), winner: m.winner.id, tiebreak: m.tiebreak, decision: m.fight.decision, hp: m.fight.hp }))) }; })() };
  }),
  fights: past.map(fightRow).reverse(),
  featured: { ...fightRow(featured), commentary: call(featured.fight, 'Undisputed') },
  newest: who('claudehaiku55'),
  announce: (() => {
    const f = [...past].reverse().find((x) => x.belt === 'undisputed' && x.why === 'new challenger')!, m = M(f.challenger);
    const pool = data.models.filter((x) => x.released <= f.day && x.id !== f.champion && x.eci != null && eligible('undisputed', x)).sort((a, b) => b.eci! - a.eci!);
    const has = ROUNDS.filter((id) => data.rounds.find((r) => r.id === id)!.benches.some((b) => !!m.scores[b])).length;
    return { day: f.day, challenger: who(f.challenger), champion: who(f.champion), rank: pool.findIndex((x) => x.id === m.id) + 1, rounds: has };
  })(),
};
// proof: the same backtest under each rule we considered
const variant = (label: string, change: (x: Options) => void, nights = [0]) => {
  const opts = defaults(); change(opts);
  const v = simulate(data, belts, '2025-10-01', TODAY, nights, opts), f = v.fights, org = (id: string) => M(id).org;
  return { label, fights: f.length, changes: f.filter((x) => x.outcome === 'new champion').length, draws: f.filter((x) => x.outcome === 'draw retains').length,
    rematches: repeatPairings(data, v), minShared: minSharedEver(data, v),
    shutouts: f.filter((x) => Math.max(...x.hp) === 100 && Math.min(...x.hp) === 0).length, sameLab: f.filter((x) => org(x.champion) === org(x.challenger)).length, starts: v.starts };
};
(out as Record<string, unknown>).proof = {
  eligible: (['undisputed', 'open', 'budget', 'premium'] as BeltId[]).map((b) => ({ belt: BELTS[b].name, inClass: data.models.filter(BELTS[b].test).length, four: data.models.filter((m) => eligible(b, m)).length,
    three: data.models.filter((m) => eligible(b, m, { ...defaults(), minRounds: { [b]: 3 } })).length })),
  variants: [
    variant('v1.1, but any eligible model can challenge', (x) => { x.topN = 0; }),
    variant('v1.1: top 3 contenders only', () => {}),
    variant('v1.1, two title nights a week', () => {}, [0, 3]),
    variant('v1.1, every belt needs only 3 of 5 rounds', (x) => { for (const b of Object.keys(BELTS) as BeltId[]) x.minRounds[b] = 3; }),
  ],
  roster: { models: data.models.length, oldest: [...data.models].sort((a, b) => a.released.localeCompare(b.released))[0].released, generatedAt: data.generatedAt },
};
writeFileSync('prototypes/season2/mock-data.json', JSON.stringify(out, null, 1));
console.log(out.belts.map((b) => `${b.name}: ${b.champion.name}, next ${b.next?.day} vs ${b.next?.challenger.name}`).join('\n'));
console.log(out.featured.commentary.map((l) => `[${l.round}] H: ${l.hank}\n   S: ${l.sam}`).join('\n'));
