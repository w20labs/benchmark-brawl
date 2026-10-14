import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { samLines } from '../src/commentary.ts';
import { formatValue, planFight } from '../src/fight.ts';
import { CHAMPIONSHIP_ROUNDS } from '../src/titles.ts';
import type { BrawlData, Model, Score } from '../src/types.ts';

// real rounds and benchmarks, made-up fighters
const real: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const S = (v: number, se: number | null = 0.5, setting = 'max'): Score => ({ v, se, setting });
const model = (id: string, scores: Record<string, Score>): Model => ({ id, name: id, org: id, released: '2026-01-01', open: false, eci: 100, price: null, scores });
const all = (v: number, se: number | null = 0.5) => ({ swebench: S(v, se), frontiermath: S(v, se), gpqa: S(v, se), simpleqa: S(v, se), mystery: S(v, se) });
const rounds = CHAMPIONSHIP_ROUNDS.map((id) => real.rounds.find((r) => r.id === id)!);
const sam = (a: Model, b: Model) => { const p = planFight(real, a, b, CHAMPIONSHIP_ROUNDS); return { p, lines: samLines(p, rounds) }; };
const line = (lines: { round: string | null; text: string }[], round: string) => lines.find((l) => l.round === round)!.text;

describe('Sigma Sam', () => {
  it('opens with the rounds that will be played, and the setting rule', () => {
    const { lines } = sam(model('A', all(80)), model('B', all(70)));
    expect(lines[0]).toEqual({ round: null, text: "5 rounds have a benchmark both models have results for: Coding, Math, Science, Facts and Puzzles. Each score is the model's best reported result across reasoning settings." });
  });

  it('calls a won round from the scores, the margin and the whole-HP damage', () => {
    const { p, lines } = sam(model('A', all(80)), model('B', all(70)));
    const R = p.rounds[0];
    expect(line(lines, 'Coding')).toBe(`A 80.0, B 70.0 on SWE-bench Verified (both at the max setting). A leads by 10.00 points, outside the ±${R.margin} margin of error. Twice the gap is 20.00; rounded to whole HP, that's 20 damage.`);
  });

  it('shows the exact doubled gap, so the rounding to whole HP can be checked', () => {
    const { p, lines } = sam(model('A', { ...all(80), swebench: S(73.25) }), model('B', { ...all(80), swebench: S(70) }));
    expect(p.rounds[0].dmg).toBe(7);
    expect(line(lines, 'Coding')).toContain('A 73.3, B 70.0'); // scores to one decimal
    expect(line(lines, 'Coding')).toContain('A leads by 3.25 points'); // the exact gap
    expect(line(lines, 'Coding')).toContain("Twice the gap is 6.50; rounded to whole HP, that's 7 damage.");
  });

  it('says when a tiny win still does 1 HP, and who has no margin of error', () => {
    const { p, lines } = sam(model('A', { ...all(80), swebench: S(70.2, null) }), model('B', { ...all(80), swebench: S(70, 0.5) }));
    expect(p.rounds[0].dmg).toBe(1);
    expect(line(lines, 'Coding')).toBe("A 70.2, B 70.0 on SWE-bench Verified (both at the max setting). A leads by 0.20 points. A has no published margin of error here, so only equal scores would count as a tie. Twice the gap is 0.40, which rounds to 0, but a won round always does at least 1 HP.");
  });

  it('calls exact ties and ties inside the margin differently', () => {
    const exact = sam(model('A', all(80)), model('B', all(80))).lines;
    expect(line(exact, 'Math')).toBe('A 80.0, B 80.0 on FrontierMath Tiers 1–3 (both at the max setting). Equal scores: a tie. Both lose 3 HP.');
    const near = sam(model('A', { ...all(80), gpqa: S(80.5, 1) }), model('B', { ...all(80), gpqa: S(80, 1) }));
    expect(line(near.lines, 'Science')).toBe(`A 80.5, B 80.0 on GPQA Diamond (both at the max setting). The gap of 0.50 points is inside the ±${near.p.rounds[2].margin} margin of error: a tie. Both lose 3 HP.`);
  });

  it('says when a tie stops at 1 HP', () => {
    // Coding leaves B at 2 HP; Math is an exact tie, which can only take B to 1
    const { p, lines } = sam(model('A', { ...all(80), swebench: S(90) }), model('B', { ...all(80), swebench: S(41) }));
    expect(p.rounds[1].graze).toEqual([3, 1]);
    expect(line(lines, 'Math')).toContain('A loses 3 HP and B 1 (a tie never takes anyone below 1 HP).');
  });

  it('calls a K.O. that overshoots, and the rounds it made unnecessary', () => {
    const { p, lines } = sam(model('A', { ...all(80), swebench: S(95) }), model('B', { ...all(80), swebench: S(30) }));
    expect(p.ko).toBe(true);
    expect(line(lines, 'Coding')).toContain("Twice the gap is 130.00; rounded to whole HP, that's 130 damage. B had only 100 HP left: K.O.");
    expect(lines.at(-2)!.text).toBe("Math, Science, Facts and Puzzles weren't needed: the fight ended by K.O.");
    expect(lines.at(-1)!.text).toBe('A wins by K.O., B at 0 HP, 1 round to 0.');
  });

  it('names skipped rounds, averaged rounds and different settings', () => {
    const a = model('A', { ...all(80), deepswe: S(60, 1, 'high'), mystery: S(50) }), b = model('B', { swebench: S(70, 0.5, 'high'), deepswe: S(55, 1), frontiermath: S(70), gpqa: S(70), simpleqa: S(70) });
    const { lines } = sam(a, b);
    expect(lines[0].text).toContain('Puzzles is skipped: no benchmark in common.');
    expect(line(lines, 'Coding')).toMatch(/^A 70\.0, B 62\.5 averaged over the 2 benchmarks both have \(DeepSWE and SWE-bench Verified\)\. A leads by 7\.50 points, outside the ±\d+\.\d margin of error\./);
    expect(line(sam(model('A', { ...all(80), gpqa: S(90, 0.5, 'high') }), model('B', all(70))).lines, 'Science')).toContain('(high and max settings)');
  });

  it('explains the result: unanimous, split and draw', () => {
    expect(sam(model('A', all(80)), model('B', all(75))).lines.at(-1)!.text).toBe('A wins on HP, 100 to 50, 5 rounds to 0. A unanimous decision: more HP and more rounds won.');
    // B wins three small rounds; A wins two big ones and the fight
    const split = sam(model('A', { ...all(70), swebench: S(95), frontiermath: S(95) }), model('B', all(72))).lines.at(-1)!.text;
    expect(split).toMatch(/^A wins on HP, \d+ to \d+, 2 rounds to 3\. A split decision: fewer or as many rounds won, but bigger wins\.$/);
    expect(sam(model('A', all(80)), model('B', all(80))).lines.at(-1)!.text).toBe('Same HP after the last round, 85 each: a draw. Rounds won: 0 to 0.');
  });

  it('is grounded in every fight: each round quotes its own scores, margin and damage, and nothing is random', () => {
    let x = 7; const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 300; n++) {
      const pick = () => Object.fromEntries(['swebench', 'deepswe', 'frontiermath', 'aime', 'gpqa', 'simpleqa', 'mystery'].filter(() => rnd() < 0.8)
        .map((b) => [b, S(Math.round(rnd() * 1000) / 10, rnd() < 0.2 ? null : Math.round(rnd() * 30) / 10)]));
      const a = model('A', pick()), b = model('B', pick());
      const p = planFight(real, a, b, CHAMPIONSHIP_ROUNDS), lines = samLines(p, rounds);
      expect(samLines(p, rounds)).toEqual(lines);
      p.rounds.forEach((R, i) => {
        const t = lines[i + 1].text;
        expect(lines[i + 1].round).toBe(R.round.name);
        expect(t).toContain(`A ${formatValue(R.bench, R.values[0])}, B ${formatValue(R.bench, R.values[1])}`);
        if (R.winner === 0 || R.winner === 1) expect(t).toContain(`${R.dmg} damage`);
        if (R.winner === -1) expect(t).toMatch(/a tie\./);
        if (R.margin != null && R.tie !== 'exact') expect(t).toContain(`±${R.margin}`);
      });
      expect(lines.at(-1)!.text).toContain(p.winner === -1 ? 'a draw' : `${p.fighters[p.winner].name} wins`);
    }
  });
});
