import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BrawlData, Model } from '../src/types.ts';
import { advanceTitles, checkAppendOnly, fingerprint, pairKey, replayTitle, sharedRounds, standings, type TitleEvent, type TitleLog } from '../src/titles.ts';

// real benchmarks and rounds, synthetic fighters
const real: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const S = (v: number) => ({ v, se: 0.5, setting: 'max' });
const model = (id: string, eci: number, scores: Record<string, number>, extra: Partial<Model> = {}): Model =>
  ({ id, name: id, org: id, released: '2026-01-01', open: false, eci, price: null, scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, S(v)])), ...extra });
const full = (v: number) => ({ swebench: v, frontiermath: v, gpqa: v, simpleqa: v, mystery: v });
// eight models, m1 strongest everywhere
const eight = Array.from({ length: 8 }, (_, k) => model(`m${k + 1}`, 150 - k, full(80 - k * 5)));
const roster = (models: Model[], generatedAt = '2026-01-01T06:30:00Z'): BrawlData => ({ ...real, models, generatedAt, daily: [], titles: undefined });
const EMPTY: TitleLog = { through: null, events: [] };
const START = '2026-01-01'; // a Thursday; title nights are Jan 4, 11, 18…
const run = (d: BrawlData, today: string, log = EMPTY) => advanceTitles(d, log, today, START);
const titles = (log: TitleLog) => log.events.filter((e): e is Extract<TitleEvent, { kind: 'title' }> => e.kind === 'title');
const pairsOf = (d: BrawlData, log: TitleLog) => log.events.flatMap((e) =>
  e.kind === 'opening' ? e.matches.map((m) => pairKey(d, e.field.find((x) => x.id === m.a)!, e.field.find((x) => x.id === m.b)!))
  : e.kind === 'title' ? [pairKey(d, e.champion, e.challenger)] : e.kind === 'vacant' ? [pairKey(d, e.a, e.b)] : []);
const repeats = (d: BrawlData, log: TitleLog) => { const p = pairsOf(d, log); return p.length - new Set(p).size; };

describe('title log', () => {
  it('stays empty until Season 2 starts', () => {
    expect(advanceTitles(roster(eight), EMPTY, '2026-10-14')).toEqual(EMPTY); // SEASON_START is null
    expect(advanceTitles(roster(eight), EMPTY, '2025-12-31', START)).toEqual(EMPTY);
  });

  it('opens a belt with a tournament, keeping only the championship scores', () => {
    const log = run(roster(eight), START);
    expect(log.through).toBe(START);
    const [open] = log.events;
    expect(open).toMatchObject({ kind: 'opening', belt: 'undisputed', day: START, champion: 'm1', rules: 'v1.1', dataDate: '2026-01-01' });
    if (open.kind !== 'opening') throw new Error();
    expect(open.matches).toHaveLength(7);
    expect(Object.keys(open.field[0].scores).sort()).toEqual(['frontiermath', 'gpqa', 'mystery', 'simpleqa', 'swebench']);
    expect(standings(roster(eight), log.events).champions.undisputed).toBe('m1');
  });

  it('gives the same log whether built day by day or all at once', () => {
    const d = roster([...eight, model('x', 160, full(95))]);
    let log = EMPTY;
    for (let day = START; day <= '2026-02-28'; day = new Date(Date.parse(day) + 864e5).toISOString().slice(0, 10)) log = run(d, day, log);
    expect(log).toEqual(run(d, '2026-02-28'));
  });

  it('never looks at a day it has already covered', () => {
    const before = run(roster(eight), '2026-01-10');
    // a new contender appears after the fact: Jan 4 is not refought, the next title night picks it up
    const after = run(roster([...eight, model('x', 160, full(95))]), '2026-01-11', before);
    expect(after.events.slice(0, before.events.length)).toEqual(before.events);
    expect(titles(after).map((e) => [e.day, e.challenger.id])).toEqual([...titles(before).map((e) => [e.day, e.challenger.id]), ['2026-01-11', 'x']]);
  });

  it('keeps a recorded title fight when the scores change later', () => {
    const x = model('x', 160, full(95)); // joins the roster after the opening
    const log = run(roster([...eight, x]), '2026-01-04', run(roster(eight), START));
    const fight = titles(log)[0];
    expect(fight).toMatchObject({ challenger: { id: 'x' }, winner: 1 });
    // x's scores collapse in a later refresh: the reign it won stands, and the fight replays as recorded
    const worse = roster([...eight, { ...x, scores: Object.fromEntries(Object.keys(x.scores).map((k) => [k, S(1)])) }], '2026-02-01T06:30:00Z');
    const later = run(worse, '2026-01-31', log);
    expect(later.events.slice(0, log.events.length)).toEqual(log.events);
    const st = standings(worse, later.events);
    expect(st.reigns.find((r) => r.model === 'x')).toMatchObject({ from: '2026-01-04', how: 'beat m1 (K.O.)' });
    expect(replayTitle(worse, fight).hp).toEqual(fight.hp);
  });

  it('never repeats a pairing on unchanged scores, in either role, opening matches included', () => {
    const d = roster([...eight, model('x', 160, full(95))]);
    const log = run(d, '2026-06-30', run(roster(eight), START));
    expect(repeats(d, log)).toBe(0);
    // m1 lost the belt to x; with the same scores, x never faces m1 again
    expect(titles(log).filter((e) => [e.champion.id, e.challenger.id].sort().join() === 'm1,x')).toHaveLength(1);
  });

  it('allows a rematch once either fighter has new scores', () => {
    const a = eight[0], b = { ...a, scores: { ...a.scores, gpqa: S(10) } };
    expect(fingerprint(real, a)).not.toBe(fingerprint(real, b));
    expect(pairKey(real, a, eight[1])).not.toBe(pairKey(real, b, eight[1]));
    expect(pairKey(real, a, eight[1])).toBe(pairKey(real, eight[1], a));
  });

  it('only books models with at least 3 comparable rounds, in openings and title fights', () => {
    // z ranks first and qualifies alone, but shares only Science and Facts with everyone
    const z = model('z', 300, { weirdml: 99, aime: 99, gpqa: 99, simpleqa: 99 });
    expect(sharedRounds(real, z, eight[0])).toBe(2);
    const log = run(roster([...eight, model('m9', 100, full(30)), z]), '2026-03-31');
    const open = log.events[0];
    if (open.kind !== 'opening') throw new Error();
    expect(open.field.map((m) => m.id)).not.toContain('z');
    expect(titles(log).some((e) => e.challenger.id === 'z')).toBe(false);
  });

  it('waits to open until there is a valid field', () => {
    const z = model('z', 300, { weirdml: 99, aime: 99, gpqa: 99, simpleqa: 99 });
    const log = run(roster([...eight.slice(0, 7), z]), '2026-02-28');
    expect(log).toEqual({ through: '2026-02-28', events: [] });
  });

  it("doesn't replay an opening bracket in a second belt", () => {
    const allOpen = eight.map((m) => ({ ...m, open: true }));
    const log = run(roster(allOpen), '2026-01-31');
    expect(log.events.filter((e) => e.kind === 'opening').map((e) => e.belt)).toEqual(['undisputed']); // no fresh field for Open weights
    const more = Array.from({ length: 8 }, (_, k) => model(`p${k + 1}`, 120 - k, full(50 - k), { open: true }));
    const d2 = roster([...allOpen, ...more]), log2 = run(d2, '2026-02-28', log);
    expect(log2.events.filter((e) => e.kind === 'opening').map((e) => [e.belt, e.day])).toEqual([['undisputed', START], ['open', '2026-02-01']]);
    expect(repeats(d2, log2)).toBe(0);
  });

  it('alternates title nights between open belts', () => {
    // both belts open on day one; then a new open-weight contender joins before each title night
    let ms = [...eight.map((m) => ({ ...m, open: true })), ...Array.from({ length: 8 }, (_, k) => model(`p${k + 1}`, 120 - k, full(50 - k), { open: true }))];
    let log = run(roster(ms), START);
    for (const [k, day] of ['2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25'].entries()) {
      ms = [...ms, model(`new${k}`, 300 + k, full(20), { open: true })]; // ranked first, so it is a top contender
      log = run(roster(ms), day, log);
    }
    const belts = log.events.filter((e) => e.kind === 'title').map((e) => e.belt);
    expect(belts).toHaveLength(4);
    expect(new Set(belts)).toEqual(new Set(['undisputed', 'open']));
    for (let i = 1; i < belts.length; i++) expect(belts[i]).not.toBe(belts[i - 1]);
  });

  it('vacates the belt when the champion leaves, then the top two fight for it', () => {
    const log = run(roster(eight), '2026-01-10');
    const after = run(roster(eight.slice(1)), '2026-01-11', log); // m1 is gone
    const added = after.events.slice(log.events.length);
    expect(added[0]).toMatchObject({ kind: 'vacated', model: 'm1', reason: 'vacated: left the roster', day: '2026-01-11' });
    // m2 met m3 in the opening semi-final, so the next unmet pair fights for the belt
    expect(added[1]).toMatchObject({ kind: 'vacant', a: { id: 'm2' }, b: { id: 'm4' } });
    const st = standings(roster(eight.slice(1)), after.events);
    expect(st.reigns[0]).toMatchObject({ model: 'm1', to: '2026-01-11', ended: 'vacated: left the roster' });
    expect(st.champions.undisputed).toBe('m2');
  });

  it('refuses a log that changed or lost an entry', () => {
    const log = run(roster([...eight, model('x', 160, full(95))]), '2026-01-31');
    expect(() => checkAppendOnly(log, run(roster(eight), '2026-02-07', log))).not.toThrow();
    const edited = { ...log, events: log.events.map((e, i) => (i === 1 ? { ...e, day: '2026-01-05' } : e)) };
    expect(() => checkAppendOnly(log, edited)).toThrow('was changed or removed');
    expect(() => checkAppendOnly(log, { ...log, events: log.events.slice(1) })).toThrow('was changed or removed');
    expect(() => checkAppendOnly(log, { ...log, through: '2026-01-01' })).toThrow('went back');
  });

  it('keeps the rules on the real roster, whichever belts open', () => {
    // the roster changes every day, so this checks the rules hold, not which belts open (a synthetic test covers that)
    const log = advanceTitles(real, EMPTY, '2026-11-29', '2026-10-15');
    expect(repeats(real, log)).toBe(0);
    for (const e of log.events) {
      if (e.kind === 'title') expect(sharedRounds(real, e.champion, e.challenger)).toBeGreaterThanOrEqual(3);
      if (e.kind === 'vacant') expect(sharedRounds(real, e.a, e.b)).toBeGreaterThanOrEqual(3);
      if (e.kind === 'opening') for (const m of e.matches) expect(sharedRounds(real, e.field.find((x) => x.id === m.a)!, e.field.find((x) => x.id === m.b)!)).toBeGreaterThanOrEqual(3);
      if (e.kind === 'title' || e.kind === 'vacant') expect(replayTitle(real, e.kind === 'title' ? e : { ...e, champion: e.a, challenger: e.b } as never).hp).toEqual(e.hp);
    }
  });

  it("catches up missed days without booking a model before its release", () => {
    const log = run(roster(eight), '2026-01-04');
    // the next build is two weeks late; y was released in between, on Jan 15
    const y = model('y', 160, full(95), { released: '2026-01-15' });
    const after = run(roster([...eight, y]), '2026-01-18', log);
    // Jan 11: y wasn't out yet, and everyone else has met the champion, so no fight (without the release check, y would fight here)
    const jan11 = after.events.find((e) => e.day === '2026-01-11');
    expect(jan11).toMatchObject({ kind: 'quiet' });
    expect(jan11?.kind === 'quiet' && jan11.eligible.includes('y')).toBe(false);
    expect(titles(after).find((e) => e.day === '2026-01-18')).toMatchObject({ challenger: { id: 'y' }, why: 'new challenger' });
  });

  it('remembers who was eligible on a night with no fight, so they are not new challengers later', () => {
    // a joins Jan 5, ranked second, but can't be compared with the champion yet: Jan 11 has no fight
    const aPartial = model('a', 149.5, { weirdml: 10, aime: 10, gpqa: 10, simpleqa: 10 }, { released: '2026-01-05' });
    const log = run(roster([...eight, aPartial]), '2026-01-11', run(roster(eight), '2026-01-04'));
    expect(log.events.at(-1)).toMatchObject({ kind: 'quiet', day: '2026-01-11' });
    expect(standings(roster(eight), log.events).seen.undisputed!.has('a')).toBe(true);
    // by Jan 18, a has comparable scores and b has arrived, ranked just below a: b is the new challenger, so b goes first
    const a = model('a', 149.5, full(10), { released: '2026-01-05' }), b = model('b', 149.2, full(10), { released: '2026-01-15' });
    const next = run(roster([...eight, a, b]), '2026-01-18', log);
    expect(titles(next).at(-1)).toMatchObject({ day: '2026-01-18', challenger: { id: 'b' }, why: 'new challenger' });
  });
});
