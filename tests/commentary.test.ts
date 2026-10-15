import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hankLines, hankRound, samLines, type HankContext, type HankMove } from '../src/commentary.ts';
import { formatValue, planFight } from '../src/fight.ts';
import { CHAMPIONSHIP_ROUNDS } from '../src/titles.ts';
import type { BrawlData, Model, Score } from '../src/types.ts';

// real rounds and benchmarks, made-up fighters
const real: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const S = (v: number, se: number | null = 0.5, setting = 'max'): Score => ({ v, se, setting });
const model = (id: string, scores: Record<string, Score>): Model => ({ id, name: id, org: id, released: '2026-01-01', open: false, eci: 100, price: null, scores });
const all = (v: number, se: number | null = 0.5) => ({ swebench: S(v, se), frontiermath: S(v, se), gpqa: S(v, se), simpleqa: S(v, se), mystery: S(v, se) });
const rounds = CHAMPIONSHIP_ROUNDS.map((id) => real.rounds.find((r) => r.id === id)!);
const sam = (a: Model, b: Model) => { const p = planFight(real, a, b, CHAMPIONSHIP_ROUNDS); return { p, lines: samLines(real, p, rounds) }; };
const line = (lines: { round: string | null; text: string }[], round: string) => lines.find((l) => l.round === round)!.text;

describe('Sigma Sam', () => {
  it('opens with the rounds that will be played, and the setting rule', () => {
    const { lines } = sam(model('A', all(80)), model('B', all(70)));
    expect(lines[0]).toEqual({ round: null, text: "All 5 rounds have a benchmark both models have results for: Coding, Math, Science, Facts and Puzzles. Each score is the model's best reported result across reasoning settings." });
  });

  it('calls a won round from the scores, the margin and the whole-HP damage', () => {
    const { p, lines } = sam(model('A', all(80)), model('B', all(70)));
    const R = p.rounds[0];
    expect(line(lines, 'Coding')).toBe(`A 80.0 (max), B 70.0 (max) on SWE-bench Verified. A leads by 10.00 points, outside the ±${R.margin} margin of error. Twice the gap is 20.00; rounded to whole HP, that's 20 damage.`);
  });

  it('shows the exact doubled gap, so the rounding to whole HP can be checked', () => {
    const { p, lines } = sam(model('A', { ...all(80), swebench: S(73.25) }), model('B', { ...all(80), swebench: S(70) }));
    expect(p.rounds[0].dmg).toBe(7);
    expect(line(lines, 'Coding')).toContain('A 73.3 (max), B 70.0 (max)'); // scores to one decimal
    expect(line(lines, 'Coding')).toContain('A leads by 3.25 points'); // the exact gap
    expect(line(lines, 'Coding')).toContain("Twice the gap is 6.50; rounded to whole HP, that's 7 damage.");
  });

  it('says when a tiny win still does 1 HP, and who has no margin of error', () => {
    const { p, lines } = sam(model('A', { ...all(80), swebench: S(70.2, null) }), model('B', { ...all(80), swebench: S(70, 0.5) }));
    expect(p.rounds[0].dmg).toBe(1);
    expect(line(lines, 'Coding')).toBe('A 70.2 (max), B 70.0 (max) on SWE-bench Verified. A leads by 0.20 points. No margin of error is published for A, so only equal scores would count as a tie. Twice the gap is 0.40, which rounds to 0, but a won round always does at least 1 HP.');
  });

  it('calls exact ties and ties inside the margin differently', () => {
    const exact = sam(model('A', all(80)), model('B', all(80))).lines;
    expect(line(exact, 'Math')).toBe('A 80.0 (max), B 80.0 (max) on FrontierMath Tiers 1–3. Equal scores: a tie. Both lose 3 HP.');
    const near = sam(model('A', { ...all(80), gpqa: S(80.5, 1) }), model('B', { ...all(80), gpqa: S(80, 1) }));
    expect(line(near.lines, 'Science')).toBe(`A 80.5 (max), B 80.0 (max) on GPQA Diamond. The gap of 0.50 points is inside the ±${near.p.rounds[2].margin} margin of error: a tie. Both lose 3 HP.`);
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
    expect(lines[0].text).toMatch(/^All 5 rounds have a benchmark/); // scheduled and comparable, though only one is played
    expect(lines.at(-2)!.text).toBe("The fight ended by K.O. after 1 round: Math, Science, Facts and Puzzles weren't needed.");
    expect(lines.at(-1)!.text).toBe('A wins by K.O., B at 0 HP, 1 round to 0 (1 round played).');
  });

  it('names skipped rounds, averaged rounds and different settings', () => {
    const a = model('A', { ...all(80), deepswe: S(60, 1, 'high'), mystery: S(50) }), b = model('B', { swebench: S(70, 0.5, 'high'), deepswe: S(55, 1), frontiermath: S(70), gpqa: S(70), simpleqa: S(70) });
    const { lines } = sam(a, b);
    expect(lines[0].text).toMatch(/^4 of the 5 rounds have .*\. Puzzles is skipped: no benchmark in common\./);
    expect(line(lines, 'Coding')).toMatch(/^Averaged over the 2 benchmarks both have: DeepSWE: A 60\.0 \(high\), B 55\.0 \(max\); SWE-bench Verified: A 80\.0 \(max\), B 70\.0 \(high\)\. Averages: A 70\.0, B 62\.5\. A leads by 7\.50 points, outside the ±\d+\.\d margin of error\./);
    expect(line(sam(model('A', { ...all(80), gpqa: S(90, 0.5, 'high') }), model('B', all(70))).lines, 'Science')).toContain('A 90.0 (high), B 70.0 (max) on GPQA Diamond.');
  });

  it('explains the result: unanimous, split and draw', () => {
    expect(sam(model('A', all(80)), model('B', all(75))).lines.at(-1)!.text).toBe('A wins on HP, 100 to 50, 5 rounds to 0 (5 rounds played). A unanimous decision: more HP and more rounds won.');
    // B wins three small rounds; A wins two big ones and the fight
    const split = sam(model('A', { ...all(70), swebench: S(95), frontiermath: S(95) }), model('B', all(72))).lines.at(-1)!.text;
    expect(split).toMatch(/^A wins on HP, \d+ to \d+, 2 rounds to 3 \(5 rounds played\)\. A split decision: fewer or as many rounds won, but bigger wins\.$/);
    expect(sam(model('A', all(80)), model('B', all(80))).lines.at(-1)!.text).toBe('Same HP after the last round, 85 each: a draw. Rounds won: 0 to 0, 5 rounds played.');
  });

  it('is grounded in every fight: each round quotes its own scores, margin and damage, and nothing is random', () => {
    let x = 7; const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 300; n++) {
      const pick = () => Object.fromEntries(['swebench', 'deepswe', 'frontiermath', 'aime', 'gpqa', 'simpleqa', 'mystery'].filter(() => rnd() < 0.8)
        .map((b) => [b, S(Math.round(rnd() * 1000) / 10, rnd() < 0.2 ? null : Math.round(rnd() * 30) / 10)]));
      const a = model('A', pick()), b = model('B', pick());
      const p = planFight(real, a, b, CHAMPIONSHIP_ROUNDS), lines = samLines(real, p, rounds);
      expect(samLines(real, p, rounds)).toEqual(lines);
      p.rounds.forEach((R, i) => {
        const t = lines[i + 1].text;
        expect(lines[i + 1].round).toBe(R.round.name);
        expect(t).toContain(R.parts ? `Averages: A ${formatValue(R.bench, R.values[0])}, B ${formatValue(R.bench, R.values[1])}` : `A ${formatValue(R.bench, R.values[0])} (`);
        if (R.winner === 0 || R.winner === 1) expect(t).toContain(`${R.dmg} damage`);
        if (R.winner === -1) expect(t).toMatch(/a tie\./);
        if (R.margin != null && R.tie !== 'exact') expect(t).toMatch(new RegExp(`±${R.margin.toFixed(1).replace('.', '\\.')}0?( |\\))`)); // ±4.90 at an exact boundary
        // the stated doubled gap rounds to the damage dealt (or is the 1 HP minimum)
        const twice = t.match(/Twice the gap is (just (?:under|over) )?([\d.]+)/);
        if (twice && !twice[1] && R.winner !== -1 && Math.round(Number(twice[2])) >= 1) expect(Math.round(Number(twice[2]))).toBe(R.dmg);
      });
      expect(lines.at(-1)!.text).toContain(p.winner === -1 ? 'a draw' : `${p.fighters[p.winner].name} wins`);
    }
  });

  // the review's repros
  it('never states a doubled gap that rounds the other way: 3.4999… is "just under 3.50", 3 HP', () => {
    const a = model('A', { ...all(80), deepswe: S(79.0), swebench: S(79.1) }), b = model('B', { ...all(80), deepswe: S(77.2), swebench: S(77.4) });
    const { p, lines } = sam(a, b);
    expect(p.rounds[0].dmg).toBe(3);
    expect(line(lines, 'Coding')).toContain("Twice the gap is just under 3.50; rounded to whole HP, that's 3 damage.");
  });

  it('shows the margin precisely enough to explain a close call', () => {
    const { p, lines } = sam(model('A', { ...all(80), swebench: S(80.0) }), model('B', { ...all(80), swebench: S(78.6) }));
    expect(p.rounds[0]).toMatchObject({ winner: 0, margin: 1.4 }); // the engine's call: 1.40 beats the exact 1.3859…
    expect(line(lines, 'Coding')).toContain('A leads by 1.40 points, outside the ±1.39 (±1.4 rounded) margin of error.');
  });

  it('names whose result in an averaged round has no margin, with every setting', () => {
    const a = model('A', { ...all(80), deepswe: S(60, null, 'max') }), b = model('B', { ...all(80), swebench: S(70), deepswe: S(50, 1, 'low') });
    const t = line(sam(a, b).lines, 'Coding');
    expect(t).toContain("DeepSWE: A 60.0 (max), B 50.0 (low); SWE-bench Verified: A 80.0 (max), B 70.0 (max).");
    expect(t).toContain("No margin of error is published for A's DeepSWE result, so only equal averages would count as a tie.");
  });

  it('at an exact boundary, says the unrounded gap is a hair past the margin instead of printing equal numbers', () => {
    // the engine: a gap of 4.900000000000006 against a margin of 4.9 (1.96 × √(1.5² + 2²)), so A wins the round
    const { p, lines } = sam(model('A', { ...all(80), swebench: S(80, 1.5) }), model('B', { ...all(80), swebench: S(75.1, 2) }));
    expect(p.rounds[0]).toMatchObject({ winner: 0 });
    expect(line(lines, 'Coding')).toContain('A leads by 4.90 points, just outside the ±4.90 margin of error. Unrounded, the gap is a hair larger than the margin, though both show as 4.90.');
    expect(line(lines, 'Coding')).not.toMatch(/\d\.\d{5,}/);
  });
});


describe('Hype Hank', () => {
  const hank = (a: Model, b: Model, ctx: Partial<HankContext> = {}, moves?: HankMove[]) => {
    const p = planFight(real, a, b, CHAMPIONSHIP_ROUNDS);
    return { p, call: hankLines(p, { belt: 'Undisputed', kind: 'title', newChallenger: false, ...ctx }, moves ?? p.rounds.map(() => ({ name: 'PIANO DROP', signature: false }))) };
  };
  const numbers = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).map(Number);

  it('introduces the champion first and the challenger second, and says when the challenger is new', () => {
    const { call } = hank(model('Champ', all(80)), model('Kid', all(70)), { newChallenger: true });
    expect(call.intro).toContain('Undisputed');
    expect(call.intro.indexOf('Champ')).toBeLessThan(call.intro.indexOf('Kid'));
    expect(call.intro).toContain('NEW CHALLENGER');
    expect(hank(model('Champ', all(80)), model('Kid', all(70))).call.intro).not.toContain('NEW CHALLENGER');
    expect(hank(model('A', all(80)), model('B', all(70)), { kind: 'vacant' }).call.intro).toContain('VACANT');
  });

  it("calls the move the arena shows, and only says the round's real damage: never a score, gap or margin", () => {
    const a = model('A', { swebench: S(83.25), frontiermath: S(80), gpqa: S(80.4, null), simpleqa: S(70), mystery: S(81) });
    const { p, call } = hank(a, model('B', all(78)));
    p.rounds.forEach((R, i) => {
      expect(call.rounds[i]).toContain('PIANO DROP');
      expect(numbers(call.rounds[i]).every((n) => n === R.dmg || R.graze.includes(n))).toBe(true);
    });
  });

  it('calls a 1 HP poke devastating, while Sam says what it was', () => {
    const a = model('A', { ...all(80), swebench: S(70.2, null) }), b = model('B', { ...all(80), swebench: S(70, 0.5) });
    const { p, call } = hank(a, b);
    expect(p.rounds[0].dmg).toBe(1);
    expect(call.rounds[0]).toMatch(/DEVASTATING 1 HP!|1 HP! That one's gonna leave a MARK!/);
    expect(line(sam(a, b).lines, 'Coding')).toContain('A leads by 0.20 points');
  });

  it('calls a tie a double hit, never a knockdown, with the HP each loses', () => {
    const { call } = hank(model('A', all(80)), model('B', all(80)));
    expect(call.rounds[0]).toMatch(/CROSSFIRE!|DOUBLE HIT!/);
    expect(call.rounds.join(' ')).not.toMatch(/KNOCKDOWN/i);
    expect(call.rounds[0]).toContain('3 HP each!');
  });

  it("says when a tie can't take a fighter below 1 HP", () => {
    // Coding takes B to 2 HP; Math's tie can only take 1; Science's tie then takes A 3 and B none
    const { p, call } = hank(model('A', { ...all(80), swebench: S(90) }), model('B', { ...all(80), swebench: S(41) }));
    expect(p.rounds[1].graze).toEqual([3, 1]);
    expect(call.rounds[1]).toMatch(/A loses 3, B 1!$/);
    expect(p.rounds[2].graze).toEqual([3, 0]);
    expect(call.rounds[2]).toMatch(/A loses 3, and B hangs on at 1 HP!$/);
    expect(numbers(call.rounds[2]).every((n) => n === 3 || n === 1)).toBe(true);
  });

  it('calls each round from the move actually thrown', () => {
    const { p } = hank(model('A', all(80)), model('B', all(75)));
    const ctx: HankContext = { belt: 'Undisputed', kind: 'title', newChallenger: false };
    expect(hankRound(p, ctx, 0, { name: 'BOWLING BALL', signature: false })).toMatch(/^BOWLING BALL! /);
    expect(hankRound(p, ctx, 0, { name: 'CONTEXT CRUSHER', signature: true })).toMatch(/^THE SIGNATURE MOVE! CONTEXT CRUSHER! /);
  });

  it("introduces an opening final with no champion, and crowns the tournament's recorded winner", () => {
    const opening = (a: Model, b: Model, crowned: HankContext['crowned']) => hank(a, b, { kind: 'opening', crowned }).call;
    const won = opening(model('Fixture 4', all(75)), model('Fixture 2', all(80)), { k: 1, tiebreak: false });
    expect(won.intro).toContain('opening tournament');
    expect(won.intro).not.toMatch(/champion|walks in with the belt/i);
    expect(won.result).toBe('Fixture 2 wins the opening tournament and the FIRST Undisputed belt! By unanimous decision!');
    // the review's repro: a drawn final that the higher seed wins by tiebreak, listed second
    const drawn = opening(model('Fixture 4', all(80)), model('Fixture 2', all(80)), { k: 1, tiebreak: true });
    expect(drawn.result).toBe('A DRAW! The tiebreak decides it: Fixture 2, the higher seed, wins the opening tournament and the FIRST Undisputed belt!');
    expect([won, drawn].map((c) => [c.intro, ...c.rounds, c.result].join(' ')).join(' ')).not.toMatch(/KEEPS|STILL|TROUBLE|NEW .* CHAMPION/);
  });

  it('calls the K.O. and the signature move', () => {
    const { p, call } = hank(model('A', { ...all(80), swebench: S(95) }), model('B', { ...all(80), swebench: S(30) }), {}, [{ name: 'CONTEXT CRUSHER', signature: true }]);
    expect(p.ko).toBe(true);
    expect(call.rounds[0]).toMatch(/^THE SIGNATURE MOVE! CONTEXT CRUSHER!/);
    expect(call.rounds[0]).toMatch(/B IS DOWN|B is FLAT/);
    expect(call.result).toBe('AND STILL UNDISPUTED CHAMPION... A!!! By K.O.!');
  });

  it('crowns a new champion, keeps the belt on a draw, and fills a vacant belt', () => {
    expect(hank(model('Champ', all(75)), model('Kid', all(80))).call.result).toBe('AND THE NEW UNDISPUTED CHAMPION... Kid!!! By unanimous decision!');
    expect(hank(model('Champ', all(80)), model('Kid', all(80))).call.result).toBe('A DRAW! And a draw means Champ KEEPS the Undisputed belt!');
    expect(hank(model('A', all(75)), model('B', all(80)), { kind: 'vacant', belt: 'Open weights' }).call.result).toBe('B takes the VACANT Open weights belt! By unanimous decision!');
    expect(hank(model('A', all(80)), model('B', all(80)), { kind: 'vacant' }).call.result).toBe('A DRAW! A takes the Undisputed belt as the higher-ranked fighter!');
  });

  it('says the champ is in trouble once, when the challenger first takes the HP lead', () => {
    const { call } = hank(model('Champ', all(70)), model('Kid', all(75)));
    expect(call.rounds.filter((r) => r.includes('The champ is in TROUBLE!')).map((r) => call.rounds.indexOf(r))).toEqual([0]);
    expect(hank(model('Champ', all(70)), model('Kid', all(75)), { kind: 'vacant' }).call.rounds.join(' ')).not.toContain('TROUBLE');
  });

  it('is the same every time for the same fight, and varies its wording between rounds', () => {
    const run = () => hank(model('Champ', all(70)), model('Kid', all(75))).call;
    expect(run()).toEqual(run());
    const r = run().rounds.map((t) => t.replace(' The champ is in TROUBLE!', ''));
    expect(r[0]).not.toBe(r[1]);
  });
});
