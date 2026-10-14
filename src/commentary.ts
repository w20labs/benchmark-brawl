/**
 * Sigma Sam: the commentator who says what the numbers support (Overfit FC, Season 2 title fights).
 *
 * Every line is built only from a fight's recorded result (src/fight.ts): the benchmark, both scores and their
 * settings, the margin of error, the damage and the HP. Nothing is invented and nothing is random, so the same
 * fight always gets the same lines. Commentary never changes a fight.
 *
 * The gap and margin are recomputed exactly as the engine computes them, so Sam can explain a call that rounded
 * numbers alone would make look wrong (a 1.40 gap beating a margin shown as ±1.4, or 3.4999… rounding down).
 */
import { DAMAGE_PER_POINT, judgeRound, PRICE_POINTS_PER_DOUBLING, PRICE_TIE_RATIO, TIE_GRAZE, TIE_Z, formatValue, type FightResult, type RoundResult } from './fight.ts';
import type { BrawlData, Round } from './types.ts';

export type SamLine = { round: string | null; text: string };

const list = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const points = (s: string) => `${s} point${s === '1.00' ? '' : 's'}`;
/** `x` to two decimals, or "just under/over" that when the shown figure would round to a different whole number. */
const twoDp = (x: number) => { const s = x.toFixed(2); return Math.round(Number(s)) === Math.round(x) ? s : `just ${x < Number(s) ? 'under' : 'over'} ${s}`; };

/** Sam's lines: the rounds both can be compared on, one per round played, rounds a K.O. cut, and the result. */
export function samLines(data: BrawlData, p: FightResult, roundsAsked: Round[]): SamLine[] {
  const [a, b] = p.fighters;
  // before the fight: which of the scheduled rounds the two can be compared on (whatever happens in the fight)
  const shared = roundsAsked.filter((r) => judgeRound(data, r, a, b).winner != null), apart = roundsAsked.filter((r) => !shared.includes(r));
  const lines: SamLine[] = [{ round: null, text: [
    `${shared.length === roundsAsked.length ? `All ${roundsAsked.length} rounds` : `${shared.length} of the ${roundsAsked.length} rounds`} have a benchmark both models have results for: ${list(shared.map((r) => r.name))}.`,
    apart.length ? `${list(apart.map((r) => r.name))} ${apart.length === 1 ? 'is' : 'are'} skipped: no benchmark in common.` : '',
    "Each score is the model's best reported result across reasoning settings.",
  ].filter(Boolean).join(' ') }];
  for (const R of p.rounds) lines.push({ round: R.round.name, text: roundLine(p, R) });
  const cut = shared.filter((r) => !p.rounds.some((R) => R.round.id === r.id)).map((r) => r.name);
  if (p.ko && cut.length) lines.push({ round: null, text: `The fight ended by K.O. after ${p.rounds.length} round${p.rounds.length === 1 ? '' : 's'}: ${list(cut)} ${cut.length === 1 ? "wasn't" : "weren't"} needed.` });
  lines.push({ round: null, text: resultLine(p) });
  return lines;
}

function roundLine(p: FightResult, R: RoundResult): string {
  const name = (k: 0 | 1) => p.fighters[k].name, b = R.bench!;
  if (b.kind === 'price') return priceLine(p, R);
  // the gap and margin exactly as the engine has them (compareOn / compareAverage)
  const benches = R.parts ? R.parts.map((q) => q.bench) : [b];
  const score = (k: 0 | 1, id: string) => p.fighters[k].scores[id];
  const n = benches.length, mean = (k: 0 | 1) => benches.reduce((s, x) => s + score(k, x.id).v, 0) / n;
  const gap = R.parts ? Math.abs(mean(0) - mean(1)) : Math.abs(score(0, b.id).v - score(1, b.id).v);
  const ses = benches.flatMap((x) => [score(0, x.id).se, score(1, x.id).se]);
  const exact = ses.every((x) => x != null) ? (R.parts ? (TIE_Z * Math.sqrt(ses.reduce((s, x) => s + x! ** 2, 0))) / n : TIE_Z * Math.hypot(ses[0]!, ses[1]!)) : null;
  // what was compared: each benchmark with both scores and settings (averaged rounds list every one)
  const one = (x: (typeof benches)[number]) => `${name(0)} ${formatValue(x, score(0, x.id).v)} (${score(0, x.id).setting}), ${name(1)} ${formatValue(x, score(1, x.id).v)} (${score(1, x.id).setting})`;
  const both = R.parts
    ? `Averaged over the ${n} benchmarks both have: ${benches.map((x) => `${x.name}: ${one(x)}`).join('; ')}. Averages: ${name(0)} ${formatValue(b, R.values[0])}, ${name(1)} ${formatValue(b, R.values[1])}.`
    : `${one(b)} on ${b.name}.`;
  // a margin shown with enough decimals to explain the call; its usual one-decimal form alongside
  const shownMargin = (win: boolean) => {
    for (let d = 1; d <= 6; d++) {
      const g = Number(gap.toFixed(Math.max(2, d))), m = Number(exact!.toFixed(d));
      if (win ? g > m : g <= m) return { gap: gap.toFixed(Math.max(2, d)), margin: d === 1 ? `±${exact!.toFixed(1)}` : `±${exact!.toFixed(d)} (±${exact!.toFixed(1)} rounded)` };
    }
    return { gap: gap.toFixed(6), margin: `±${exact!.toFixed(6)}` };
  };
  const missing = benches.flatMap((x) => ([0, 1] as const).filter((k) => score(k, x.id).se == null).map((k) => (R.parts ? `${name(k)}'s ${x.name} result` : name(k))));
  const noMargin = `No margin of error is published for ${list(missing)}, so only equal ${R.parts ? 'averages' : 'scores'} would count as a tie.`;
  if (R.winner === -1) {
    const graze = R.graze[0] === R.graze[1] ? `Both lose ${R.graze[0]} HP` : `${name(0)} loses ${R.graze[0]} HP and ${name(1)} ${R.graze[1]}`;
    const why = R.tie === 'exact' ? `Equal ${R.parts ? 'averages' : 'scores'}: a tie.` : (() => { const s = shownMargin(false); return `The gap of ${points(s.gap)} is inside the ${s.margin} margin of error: a tie.`; })();
    const capped = R.graze.some((g) => g < TIE_GRAZE) ? ' (a tie never takes anyone below 1 HP)' : '';
    return `${both} ${why} ${graze}${capped}.`;
  }
  const w = R.winner as 0 | 1, l = (1 - w) as 0 | 1, twice = gap * DAMAGE_PER_POINT;
  const lead = exact != null ? (() => { const s = shownMargin(true); return `${name(w)} leads by ${points(s.gap)}, outside the ${s.margin} margin of error.`; })()
    : `${name(w)} leads by ${points(gap.toFixed(2))}. ${noMargin}`;
  const rounding = Math.round(twice) >= 1 ? `Twice the gap is ${twoDp(twice)}; rounded to whole HP, that's ${R.dmg} damage.`
    : `Twice the gap is ${twoDp(twice)}, which rounds to 0, but a won round always does at least 1 HP.`;
  const lost = R.hpBefore[l] - R.hpAfter[l];
  const ko = R.hpAfter[l] === 0 ? (lost < R.dmg ? ` ${name(l)} had only ${R.hpBefore[l]} HP left: K.O.` : ` That takes ${name(l)} to 0 HP: K.O.`) : '';
  return `${both} ${lead} ${rounding}${ko}`;
}

function priceLine(p: FightResult, R: RoundResult): string {
  const name = (k: 0 | 1) => p.fighters[k].name, [a, b] = R.values as [number, number];
  const ratio = Math.max(a, b) / Math.min(a, b);
  const both = `${name(0)} ${formatValue(R.bench, a)}, ${name(1)} ${formatValue(R.bench, b)} per million tokens.`;
  if (R.winner === -1) return `${both} Within ${Math.round((PRICE_TIE_RATIO - 1) * 100)}% of each other (${ratio.toFixed(2)}×): a tie. Both lose ${R.graze[0]} HP.`;
  const w = R.winner as 0 | 1, l = (1 - w) as 0 | 1, pts = Math.log2(ratio) * PRICE_POINTS_PER_DOUBLING;
  return `${both} ${name(l)} costs ${ratio.toFixed(2)}× as much; each doubling is worth ${PRICE_POINTS_PER_DOUBLING} points, so ${pts.toFixed(2)} points, and twice that, rounded to whole HP, is ${R.dmg} damage.`;
}

function resultLine(p: FightResult): string {
  const name = (k: 0 | 1) => p.fighters[k].name, [h0] = p.hp;
  const played = `${p.rounds.length} round${p.rounds.length === 1 ? '' : 's'} played`;
  if (p.winner === -1) return `Same HP after the last round, ${h0} each: a draw. Rounds won: ${p.roundsWon[0]} to ${p.roundsWon[1]}, ${played}.`;
  const w = p.winner, l = (1 - w) as 0 | 1;
  const how = p.ko ? `by K.O., ${name(l)} at 0 HP` : `on HP, ${p.hp[w]} to ${p.hp[l]}`;
  const rounds = `${p.roundsWon[w]} round${p.roundsWon[w] === 1 ? '' : 's'} to ${p.roundsWon[l]} (${played})`;
  const why = p.decision === 'split' ? ' A split decision: fewer or as many rounds won, but bigger wins.' : p.decision === 'unanimous' ? ' A unanimous decision: more HP and more rounds won.' : '';
  return `${name(w)} wins ${how}, ${rounds}.${why}`;
}
