import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BrawlData, Model } from '../src/types.ts';
import { advanceTitles, checkAppendOnly, fingerprint, pairKey, qualifies, replayTitle, sharedRounds, standings, TITLE_RULES, type TitleEvent, type TitleLog } from '../src/titles.ts';

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
    expect(open).toMatchObject({ kind: 'opening', belt: 'undisputed', day: START, champion: 'm1', rules: TITLE_RULES, dataDate: '2026-01-01' });
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

  it('explains a night with no fight accurately, per contender', () => {
    // Jan 11: m2 and m4 met m1 in the opening, m3 met it on Jan 4, and a can't be compared with it
    const aPartial = model('a', 149.5, { weirdml: 10, aime: 10, gpqa: 10, simpleqa: 10 }, { released: '2026-01-05' });
    const log = run(roster([...eight, aPartial]), '2026-01-11', run(roster(eight), '2026-01-04'));
    expect(log.events.at(-1)).toMatchObject({ kind: 'quiet', reason: 'no challenger: no top contender meets the booking rules',
      blocked: [{ id: 'a', why: 'not comparable' }, { id: 'm2', why: 'met' }, { id: 'm3', why: 'met' }] });
  });

  it('explains a vacant belt that stays vacant with the real reason', () => {
    // m1 leaves; the only ranked models left all met each other in the opening bracket or can't be compared
    const few = [eight[1], eight[2]]; // m2 and m3 met in the opening semi-final, and are comparable
    const log = run(roster(eight), '2026-01-10');
    const after = run(roster(few), '2026-01-11', log);
    expect(after.events.at(-1)).toMatchObject({ kind: 'quiet', reason: 'vacant: no pair meets the vacant-title booking rules', pairs: { met: 1, 'not comparable': 0 } });
    const solo = run(roster([eight[1]]), '2026-01-11', log);
    expect(solo.events.at(-1)).toMatchObject({ kind: 'quiet', reason: 'vacant: fewer than two ranked contenders' });
  });

  it("books a day ahead on that day's roster: a champion who turns 366 days old on title night gives up the belt", () => {
    // m1 is released 2025-01-03: 365 days old on Saturday Jan 3 (still a fighter), 366 on Sunday Jan 4 (past the cutoff)
    const old = [model('m1', 150, full(80), { released: '2025-01-03' }), ...eight.slice(1)];
    const upToSaturday = run(roster(old, '2026-01-02T06:30:00Z'), '2026-01-03');
    expect(standings(roster(old), upToSaturday.events).champions.undisputed).toBe('m1');
    // Saturday's build forecasts Sunday with Saturday's data, which still lists m1
    const forecast = run(roster(old, '2026-01-03T06:30:00Z'), '2026-01-04', upToSaturday);
    // Sunday's own build no longer lists m1 (the data build drops it at the same cutoff)
    const fresh = run(roster(old.slice(1), '2026-01-04T06:30:00Z'), '2026-01-04', upToSaturday);
    const sunday = (log: TitleLog) => log.events.slice(upToSaturday.events.length).map(({ dataDate, ...e }) => e);
    expect(sunday(forecast)).toEqual(sunday(fresh));
    expect(sunday(forecast).map((e) => e.kind)).toEqual(['vacated', 'vacant']);
    expect(forecast.events.at(-2)).toMatchObject({ kind: 'vacated', model: 'm1', reason: 'vacated: left the roster' });
    expect(forecast.events.at(-1)).toMatchObject({ kind: 'vacant', a: { id: 'm2' }, b: { id: 'm4' } }); // m2 and m3 met in the opening
    // and Sunday's build, carrying the forecast forward, keeps it exactly
    const kept = run(roster(old.slice(1), '2026-01-04T06:30:00Z'), '2026-01-04', forecast);
    expect(kept).toEqual(forecast);
    expect(() => checkAppendOnly(forecast, kept)).not.toThrow();
  });
});

// v1.2 on the same fixture: m1 wins the Jan 1 opening (meeting m8, m4 and m2); title night is Sun Jan 4. Without
// newcomers m3 is booked (the top 3 by index are m2, m3, m4, and only m3 hasn't met m1). m4 (all 65) is the #3.
describe('newcomer title shots (v1.2)', () => {
  const opened = run(roster(eight), START);
  const unindexed = (id: string, scores: Record<string, number>, extra: Partial<Model> = {}) => model(id, 0, scores, { eci: null, ...extra });
  const withArrivals = (d: BrawlData, seen: Record<string, string | null>): BrawlData => ({ ...d, arrivals: { since: '2025-12-01', seen } });
  const night = (models: Model[], seen: Record<string, string | null> = {}, through = '2026-01-04', log = opened) => run(withArrivals(roster(models), seen), through, log);
  const lastTitle = (log: TitleLog) => titles(log).at(-1)!;

  it('without newcomers, books the top contender as before', () => {
    expect(lastTitle(night(eight))).toMatchObject({ day: '2026-01-04', challenger: { id: 'm3' }, why: 'top contender', rules: TITLE_RULES });
    expect(TITLE_RULES).toBe('v1.2');
  });

  it('gives a newcomer with no index the shot when it beats the #3 contender; the check is not a meeting', () => {
    const n = unindexed('n', full(70)), d = withArrivals(roster([...eight, n]), {});
    const log = night([...eight, n]);
    const e = lastTitle(log);
    expect(e).toMatchObject({ challenger: { id: 'n' }, why: 'new challenger', qualified: { by: 'beat #3', ref: 'm4' }, rules: 'v1.2' });
    const met = standings(d, log.events).met;
    expect(met.has(pairKey(d, eight[0], n))).toBe(true);
    expect(met.has(pairKey(d, eight[3], n))).toBe(false); // beating #3 was a check, not a fight
    expect(replayTitle(d, e)).toMatchObject({ hp: e.hp, winner: e.winner }); // replays from its saved scores
  });

  it('a draw or a loss against #3 earns nothing: the newcomer waits for an index', () => {
    for (const v of [65, 60]) { // 65: the same scores as m4, a draw
      expect(qualifies(real, unindexed('n', full(v)), eight[3])).toBe('did not beat #3');
      expect(lastTitle(night([...eight, unindexed('n', full(v))])).challenger.id).toBe('m3');
    }
  });

  it('an indexed newcomer outside the top 3 cannot use the exception, however strong', () => {
    expect(lastTitle(night([...eight, model('n', 100, full(95))])).challenger.id).toBe('m3');
  });

  it('with no #3 contender, the newcomer waits, and the quiet night says why', () => {
    // only m1 and m2 have an index; m2 already met m1 in the opening, so nobody can be booked
    const ms = eight.map((m, k) => (k < 2 ? m : { ...m, eci: null }));
    const log = run(withArrivals(roster([...ms, unindexed('n', full(95))]), {}), '2026-01-04', run(roster(ms), START));
    expect(log.events.at(-1)).toMatchObject({ kind: 'quiet', day: '2026-01-04', waiting: [{ id: 'n', why: 'no #3 contender' }] });
  });

  it('needs 3 comparable rounds against #3, not only against the champion', () => {
    // n has DeepSWE and OTIS AIME, which m1 also has but m4 (#3) doesn't: comparable with m1 on 4 rounds, with m4 on 2
    const m1 = model('m1', 150, { ...full(80), deepswe: 80, aime: 80 }), ms = [m1, ...eight.slice(1)];
    const n = unindexed('n', { deepswe: 95, aime: 95, gpqa: 95, simpleqa: 95 });
    expect(sharedRounds(real, n, m1)).toBe(4);
    expect(qualifies(real, n, eight[3])).toBe('not comparable with #3');
    const log = run(withArrivals(roster([...ms, n]), {}), '2026-01-04', run(roster(ms), START));
    expect(lastTitle(log).challenger.id).toBe('m3');
  });

  it('orders newcomers that beat #3 by roster arrival, unknown first, then by id', () => {
    const a = unindexed('na', full(90)), b = unindexed('nb', full(95));
    expect(lastTitle(night([...eight, a, b], { na: '2026-01-03', nb: '2026-01-02' })).challenger.id).toBe('nb');
    expect(lastTitle(night([...eight, a, b], { na: '2026-01-02', nb: '2026-01-02' })).challenger.id).toBe('na');
    expect(lastTitle(night([...eight, a, b], { na: '2026-01-02', nb: null })).challenger.id).toBe('nb'); // on the roster before tracking
    expect(lastTitle(night([...eight, a, b])).challenger.id).toBe('na'); // no record at all: unknown, by id
  });

  it('books in three tiers: newcomers in the top 3 by index, then newcomers that beat #3, then the other top 3', () => {
    const a = unindexed('na', full(90));
    // ni joins the top 3 (ni, m2, m3: #3 is m3, all 70); it goes first even though na arrived earlier
    const ni = model('ni', 149.5, full(50)), nj = model('nj', 149.8, full(50));
    expect(lastTitle(night([...eight, ni, a], { ni: '2026-01-03', na: '2026-01-02' }))).toMatchObject({ challenger: { id: 'ni' }, why: 'new challenger', pending: ['na'] });
    expect(lastTitle(night([...eight, ni, nj, a]))).toMatchObject({ challenger: { id: 'nj' } }); // highest index first
    // a newcomer that beat #3 goes before m3, an established top-3 contender
    expect(lastTitle(night([...eight, a]))).toMatchObject({ challenger: { id: 'na' }, qualified: { by: 'beat #3', ref: 'm4' } });
  });

  it('keeps every qualified newcomer in line until it gets its shot, without changing earlier entries', () => {
    // the review's case: na and nb both beat #3 and can fight m1; Jan 4 books na, and nb must still get its shot
    const ms = [...eight, unindexed('na', full(90)), unindexed('nb', full(95))];
    const d = withArrivals(roster(ms), {});
    const jan4 = night(ms);
    expect(lastTitle(jan4)).toMatchObject({ day: '2026-01-04', challenger: { id: 'na' }, pending: ['nb'] });
    const later = night(ms, {}, '2026-02-28');
    const nb = titles(later).find((e) => e.challenger.id === 'nb');
    expect(nb).toMatchObject({ day: '2026-01-11', why: 'new challenger', qualified: { by: 'beat #3' } });
    expect(nb!.pending).toBeUndefined(); // nobody left in line
    expect(later.events.slice(0, jan4.events.length)).toEqual(jan4.events);
    // one night at a time gives the same log as all at once
    let step = opened;
    for (const day of ['2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25', '2026-02-01', '2026-02-28']) step = run(d, day, step);
    expect(step).toEqual(later);
    expect(repeats(d, later)).toBe(0);
  });

  it('an indexed newcomer taking the first slot leaves a qualified one in line too', () => {
    const ms = [...eight, model('ni', 149.5, full(50)), unindexed('na', full(90))];
    const log = night(ms, {}, '2026-01-31');
    expect(titles(log).map((e) => [e.day, e.challenger.id])).toEqual(expect.arrayContaining([['2026-01-04', 'ni'], ['2026-01-11', 'na']]));
  });

  it('rechecks a waiting qualifier each night: it waits while it no longer beats #3, and leaves the line once indexed', () => {
    const ms = [...eight, model('ni', 149.5, full(50)), unindexed('na', full(90))];
    const jan4 = night(ms); // ni booked, na in line
    expect(lastTitle(jan4).pending).toEqual(['na']);
    // by Jan 11 na's scores dropped below #3 (m3, all 70): no shot, still in line, and the reason is on record
    const weaker = ms.map((m) => (m.id === 'na' ? unindexed('na', full(60)) : m));
    const jan11 = run(withArrivals(roster(weaker), {}), '2026-01-11', jan4);
    expect(jan11.events.at(-1)).toMatchObject({ day: '2026-01-11', pending: ['na'] });
    expect(titles(jan11).filter((e) => e.challenger.id === 'na')).toHaveLength(0);
    // with an index, na is an ordinary contender: out of the line
    const indexedNa = ms.map((m) => (m.id === 'na' ? { ...m, eci: 10 } : m));
    const jan18 = run(withArrivals(roster(indexedNa), {}), '2026-01-18', jan11);
    expect(standings(roster(indexedNa), jan18.events).pending.undisputed?.has('na')).toBe(false);
  });

  it('never books the same pairing twice on unchanged scores', () => {
    const n = unindexed('n', full(70)), d = withArrivals(roster([...eight, n]), {});
    const log = night([...eight, n], {}, '2026-02-28');
    expect(titles(log).filter((e) => e.challenger.id === 'n')).toHaveLength(1); // m1 kept the belt; n can't meet it again
    expect(repeats(d, log)).toBe(0);
  });

  it('uses the roster of the night being booked: release dates and the one-year cutoff', () => {
    const late = unindexed('n', full(70), { released: '2026-01-05' });
    expect(titles(night([...eight, late])).some((e) => e.challenger.id === 'n')).toBe(false);
    expect(lastTitle(night([...eight, late], {}, '2026-01-11'))).toMatchObject({ day: '2026-01-11', challenger: { id: 'n' } });
    // m4 turns 366 days old on Jan 4: off the roster, so #3 is m5 (all 60), whom n (62) beats; m4 (65) would have stopped it
    const ms = eight.map((m, k) => (k === 3 ? { ...m, released: '2025-01-03' } : m));
    const log = run(withArrivals(roster([...ms, unindexed('n', full(62))]), {}), '2026-01-04', run(roster(ms), START));
    expect(lastTitle(log)).toMatchObject({ challenger: { id: 'n' }, qualified: { ref: 'm5' } });
  });

  it('keeps earlier entries and their rules version; new entries are v1.2', () => {
    const v11 = { ...opened, events: opened.events.map((e) => ({ ...e, rules: 'v1.1' })) };
    const log = night([...eight, unindexed('n', full(70))], {}, '2026-01-04', v11);
    expect(log.events.slice(0, v11.events.length)).toEqual(v11.events);
    expect(log.events.slice(v11.events.length).map((e) => e.rules)).toEqual(['v1.2']);
    expect(() => checkAppendOnly(v11, log)).not.toThrow();
  });

  it('does nothing while Season 2 is off or not yet started', () => {
    const d = withArrivals(roster([...eight, unindexed('n', full(95))]), {});
    expect(advanceTitles(d, EMPTY, '2026-01-04', null)).toEqual(EMPTY);
    expect(advanceTitles(d, EMPTY, '2026-01-04', '2026-01-10')).toEqual(EMPTY);
  });
});

