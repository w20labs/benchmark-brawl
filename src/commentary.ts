/**
 * Sigma Sam: the commentator who says what the numbers support (Overfit FC, Season 2 title fights).
 *
 * Every line is built only from a fight's recorded result (src/fight.ts): the benchmark, both scores and their
 * settings, the margin of error, the damage and the HP. Nothing is invented and nothing is random, so the same
 * fight always gets the same lines. Commentary never changes a fight.
 */
import { DAMAGE_PER_POINT, PRICE_POINTS_PER_DOUBLING, PRICE_TIE_RATIO, TIE_GRAZE, formatValue, type FightResult, type RoundResult } from './fight.ts';
import type { Round } from './types.ts';

export type SamLine = { round: string | null; text: string };

const list = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/** The exact gap, to two decimals: the scores are shown to one, and the damage uses the exact gap, so this lets a reader check it. */
const pts = (n: number) => `${n.toFixed(2)} point${n.toFixed(2) === '1.00' ? '' : 's'}`;

/** Sam's lines for a fight: an opening line, one per round played, a note on rounds the K.O. cut, and the result. */
export function samLines(p: FightResult, roundsAsked: Round[]): SamLine[] {
  const name = (k: 0 | 1) => p.fighters[k].name;
  const played = p.rounds.map((R) => R.round.id), skipped = p.skipped.map((r) => r.name);
  const lines: SamLine[] = [{ round: null, text: [
    `${p.rounds.length === 1 ? 'One round has' : `${p.rounds.length} rounds have`} a benchmark both models have results for: ${list(p.rounds.map((R) => R.round.name))}.`,
    skipped.length ? `${list(skipped)} ${skipped.length === 1 ? 'is' : 'are'} skipped: no benchmark in common.` : '',
    'Each score is the model\'s best reported result across reasoning settings.',
  ].filter(Boolean).join(' ') }];
  for (const R of p.rounds) lines.push({ round: R.round.name, text: roundLine(p, R) });
  const cut = roundsAsked.filter((r) => !played.includes(r.id) && !p.skipped.some((s) => s.id === r.id)).map((r) => r.name);
  if (p.ko && cut.length) lines.push({ round: null, text: `${list(cut)} ${cut.length === 1 ? "wasn't" : "weren't"} needed: the fight ended by K.O.` });
  lines.push({ round: null, text: resultLine(p, name) });
  return lines;
}

function roundLine(p: FightResult, R: RoundResult): string {
  const name = (k: 0 | 1) => p.fighters[k].name, b = R.bench!;
  if (b.kind === 'price') return priceLine(p, R);
  // what was compared: one benchmark, or the average of several
  const [x, y] = R.parts ? R.parts.reduce(([s0, s1], q) => [s0 + q.values[0] / R.parts!.length, s1 + q.values[1] / R.parts!.length], [0, 0]) : [R.values[0]!, R.values[1]!];
  const scores = (k: 0 | 1) => (R.parts ? null : p.fighters[k].scores[b.id]);
  const on = R.parts ? `averaged over the ${R.parts.length} benchmarks both have (${list(R.parts.map((q) => q.bench.name))})` : `on ${b.name}`;
  const setting = R.parts ? '' : scores(0)!.setting === scores(1)!.setting ? ` (both at the ${scores(0)!.setting} setting)` : ` (${scores(0)!.setting} and ${scores(1)!.setting} settings)`;
  const both = `${name(0)} ${formatValue(b, R.values[0])}, ${name(1)} ${formatValue(b, R.values[1])} ${on}${setting}.`;
  const gap = Math.abs(x - y);
  // the margin of error: from both scores' standard errors; without them, only equal scores tie
  const noMargin = R.parts ? 'Not every benchmark here publishes a margin of error, so only equal scores would count as a tie.'
    : `${list(([0, 1] as const).filter((k) => scores(k)!.se == null).map(name))} ${([0, 1] as const).filter((k) => scores(k)!.se == null).length > 1 ? 'have' : 'has'} no published margin of error here, so only equal scores would count as a tie.`;
  if (R.winner === -1) {
    const graze = R.graze[0] === R.graze[1] ? `Both lose ${R.graze[0]} HP` : `${name(0)} loses ${R.graze[0]} HP and ${name(1)} ${R.graze[1]}`;
    const why = R.tie === 'exact' ? 'Equal scores: a tie.' : `The gap of ${pts(gap)} is inside the ±${R.margin} margin of error: a tie.`;
    const capped = R.graze.some((g) => g < TIE_GRAZE) ? ' (a tie never takes anyone below 1 HP)' : '';
    return `${both} ${why} ${graze}${capped}.`;
  }
  const w = R.winner as 0 | 1, l = (1 - w) as 0 | 1, twice = gap * DAMAGE_PER_POINT;
  const margin = R.margin != null ? `outside the ±${R.margin} margin of error` : null;
  const rounding = Math.round(twice) >= 1 ? `Twice the gap is ${twice.toFixed(2)}; rounded to whole HP, that's ${R.dmg} damage.`
    : `Twice the gap is ${twice.toFixed(2)}, which rounds to 0, but a won round always does at least 1 HP.`;
  const lost = R.hpBefore[l] - R.hpAfter[l];
  const ko = R.hpAfter[l] === 0 ? (lost < R.dmg ? ` ${name(l)} had only ${R.hpBefore[l]} HP left: K.O.` : ` That takes ${name(l)} to 0 HP: K.O.`) : '';
  return `${both} ${name(w)} leads by ${pts(gap)}${margin ? `, ${margin}` : ''}.${margin ? '' : ` ${noMargin}`} ${rounding}${ko}`;
}

function priceLine(p: FightResult, R: RoundResult): string {
  const name = (k: 0 | 1) => p.fighters[k].name, [a, b] = R.values as [number, number];
  const ratio = Math.max(a, b) / Math.min(a, b);
  const both = `${name(0)} ${formatValue(R.bench, a)}, ${name(1)} ${formatValue(R.bench, b)} per million tokens.`;
  if (R.winner === -1) return `${both} Within ${Math.round((PRICE_TIE_RATIO - 1) * 100)}% of each other (${ratio.toFixed(2)}×): a tie. Both lose ${R.graze[0]} HP.`;
  const w = R.winner as 0 | 1, l = (1 - w) as 0 | 1, points = Math.log2(ratio) * PRICE_POINTS_PER_DOUBLING;
  return `${both} ${name(l)} costs ${ratio.toFixed(2)}× as much; each doubling is worth ${PRICE_POINTS_PER_DOUBLING} points, so ${points.toFixed(2)} points, and twice that, rounded to whole HP, is ${R.dmg} damage.`;
}

function resultLine(p: FightResult, name: (k: 0 | 1) => string): string {
  const [h0, h1] = p.hp;
  if (p.winner === -1) return `Same HP after the last round, ${h0} each: a draw. Rounds won: ${p.roundsWon[0]} to ${p.roundsWon[1]}.`;
  const w = p.winner, l = (1 - w) as 0 | 1;
  const how = p.ko ? `by K.O., ${name(l)} at 0 HP` : `on HP, ${p.hp[w]} to ${p.hp[l]}`;
  const rounds = `${p.roundsWon[w]} round${p.roundsWon[w] === 1 ? '' : 's'} to ${p.roundsWon[l]}`;
  const why = p.decision === 'split' ? ` A split decision: fewer or as many rounds won, but bigger wins.` : p.decision === 'unanimous' ? ' A unanimous decision: more HP and more rounds won.' : '';
  return `${name(w)} wins ${how}, ${rounds}.${why}`;
}
