/**
 * Overfit FC title belts: the rulebook, and the title log it writes.
 *
 * The log is append-only. Each data build adds what happened on the days since the last build (an opening tournament,
 * a title fight, a vacated belt) and never changes an earlier entry. Every entry keeps both fighters' championship
 * scores as they were, so a later score refresh can't rewrite a reign. Champions, reigns and who has met whom are
 * always worked out by replaying the log, never from live scores.
 */
import { judgeRound, planFight, type FightResult } from './fight.ts';
import { onRosterOn, runTournament, snapshotFighters } from './league.ts';
import type { BrawlData, Model } from './types.ts';

/**
 * v1.1: the top 3 contenders by Capabilities Index can challenge, newcomers first.
 * v1.2: also a newcomer with no Capabilities Index yet that beats the #3 contender on the championship rounds;
 *       newcomers are ordered by roster arrival. Entries keep the version they were written under.
 */
export const TITLE_RULES = 'v1.2';
/** The first day belts can open. null: Season 2 hasn't started, and the log stays empty. */
export const SEASON_START: string | null = null;
/**
 * Whether Season 2 is on for a UTC day: the one gate for everything in it (title bookings, the Belts tab,
 * new-challenger announcements). The data build checks the day being booked; the page checks today.
 */
export const seasonOn = (day: string, start: string | null | undefined = SEASON_START) => !!start && day >= start;
/**
 * The start day a page is built with: always this code's SEASON_START, never one saved in the data, so a page built
 * from older data (after a failed refresh) can't switch the season on, or start it earlier, than the code says.
 * `override` is for local previews only (BRAWL_SEASON_START): a YYYY-MM-DD day, or '' for off.
 */
export function pageSeasonStart(override?: string): string | null {
  if (override === undefined) return SEASON_START;
  if (override === '') return null;
  // a real calendar day: Date.parse would quietly roll Feb 30 over to Mar 2, so the day must read back unchanged
  const real = /^\d{4}-\d{2}-\d{2}$/.test(override) && !Number.isNaN(Date.parse(override)) && new Date(Date.parse(override)).toISOString().slice(0, 10) === override;
  if (!real) throw new Error(`BRAWL_SEASON_START must be YYYY-MM-DD or empty, not "${override}"`);
  return override;
}
/** Every title fight uses these rounds, in this order. */
export const CHAMPIONSHIP_ROUNDS = ['coding', 'math', 'science', 'facts', 'puzzles'];
/** Title night: Sunday (UTC). */
export const TITLE_NIGHT = 0;
/** Rounds (of 5) a model needs results in to be eligible. */
export const MIN_ROUNDS_WITH_RESULTS = 4;
/** Two models need results in at least this many of the same rounds to be booked against each other. */
export const MIN_SHARED = 3;
/** Only the top N eligible contenders by Capabilities Index can challenge. */
export const TOP_CONTENDERS = 3;
export const FIELD_SIZE = 8;

export type BeltId = 'undisputed' | 'open';
export const BELTS: { id: BeltId; name: string; test: (m: Model) => boolean }[] = [
  { id: 'undisputed', name: 'Undisputed', test: () => true },
  { id: 'open', name: 'Open weights', test: (m) => m.open },
];

/** A fighter as it was when the entry was written: only the championship-round scores are kept. */
export type Snapshot = Model;
export type BracketMatch = { a: string; b: string; winner: string; tiebreak: boolean; hp: [number, number] };
export type TitleEvent =
  | { kind: 'opening'; belt: BeltId; day: string; rules: string; dataDate: string; eligible: string[]; field: Snapshot[]; matches: BracketMatch[]; champion: string }
  | { kind: 'title'; belt: BeltId; day: string; rules: string; dataDate: string; eligible: string[]; why: 'new challenger' | 'top contender';
      /** v1.2, a new challenger with no Capabilities Index: it qualified by beating `ref`, the #3 contender (a check, not a fight on record). */
      qualified?: { by: 'beat #3'; ref: string };
      champion: Snapshot; challenger: Snapshot; winner: 0 | 1 | -1; decision: FightResult['decision']; hp: [number, number]; roundsWon: [number, number] }
  | { kind: 'vacant'; belt: BeltId; day: string; rules: string; dataDate: string; eligible: string[]; a: Snapshot; b: Snapshot;
      winner: 0 | 1 | -1; decision: FightResult['decision']; hp: [number, number]; roundsWon: [number, number]; champion: string }
  | { kind: 'vacated'; belt: BeltId; day: string; rules: string; dataDate: string; model: string; reason: string }
  /** A title night with no fight. Kept so the log remembers who was already eligible: they aren't new challengers later. */
  | { kind: 'quiet'; belt: BeltId; day: string; rules: string; dataDate: string; eligible: string[]; reason: string;
      /** Title night: why each top contender wasn't booked against the champion. */
      blocked?: { id: string; why: Blocked }[];
      /** Vacant belt: how many ranked pairs were ruled out, and why. */
      pairs?: Record<Blocked, number>;
      /** v1.2: newcomers with no Capabilities Index yet that didn't qualify against the #3 contender, and why. */
      waiting?: { id: string; why: NotQualified }[] };
/** Why a newcomer with no Capabilities Index didn't earn a title shot: it waits for an index. */
export type NotQualified = 'no #3 contender' | 'not comparable with #3' | 'did not beat #3';
/** Why a pairing can't be booked: they already met on these scores, or fewer than MIN_SHARED rounds can be compared. */
export type Blocked = 'met' | 'not comparable';
export type TitleLog = { through: string | null; events: TitleEvent[] };

// ---------- eligibility, comparability, fingerprints ----------
const roundById = (data: BrawlData, id: string) => data.rounds.find((r) => r.id === id)!;
const hasRound = (data: BrawlData, id: string, m: Model) => roundById(data, id).benches.some((b) => !!m.scores[b]);
export const eligibleFor = (data: BrawlData, belt: BeltId, m: Model) =>
  BELTS.find((b) => b.id === belt)!.test(m) && CHAMPIONSHIP_ROUNDS.filter((r) => hasRound(data, r, m)).length >= MIN_ROUNDS_WITH_RESULTS;
/** Rounds the two can actually be compared on. */
export const sharedRounds = (data: BrawlData, a: Model, b: Model) =>
  CHAMPIONSHIP_ROUNDS.filter((id) => judgeRound(data, roundById(data, id), a, b).winner != null).length;
/** The championship scores a fight depends on. Same fingerprints, same result. */
export const fingerprint = (data: BrawlData, m: Model) =>
  JSON.stringify(CHAMPIONSHIP_ROUNDS.flatMap((id) => roundById(data, id).benches).filter((b) => m.scores[b]).map((b) => [b, m.scores[b].v, m.scores[b].se]));
/** Who met whom, on which scores, in either role. */
export const pairKey = (data: BrawlData, a: Model, b: Model) => [a, b].map((m) => `${m.id}:${fingerprint(data, m)}`).sort().join('|');
const snap = (data: BrawlData, a: Model, b: Model) => snapshotFighters(data, a, b, CHAMPIONSHIP_ROUNDS);
const ranked = (ms: Model[]) => [...ms].sort((a, b) => (b.eci ?? -1) - (a.eci ?? -1) || a.id.localeCompare(b.id));

// ---------- replaying the log ----------
export type Reign = { belt: BeltId; model: string; name: string; from: string; to: string | null; defenses: number; how: string; ended: string | null };
export type Standings = {
  champions: Partial<Record<BeltId, string | null>>;
  opened: Partial<Record<BeltId, string>>;
  reigns: Reign[];
  /** pairKeys of every meeting so far. */
  met: Set<string>;
  /** Per belt, every model that has been eligible on an earlier entry: anyone else is a new challenger. */
  seen: Partial<Record<BeltId, Set<string>>>;
};

/** Champions, reigns and meetings, from the log alone. */
export function standings(data: BrawlData, events: TitleEvent[]): Standings {
  const s: Standings = { champions: {}, opened: {}, reigns: [], met: new Set(), seen: {} };
  const current = (belt: BeltId) => s.reigns.findLast((r) => r.belt === belt && r.to == null);
  const crown = (belt: BeltId, model: Snapshot | string, name: string, day: string, how: string) => {
    const id = typeof model === 'string' ? model : model.id;
    s.champions[belt] = id; s.reigns.push({ belt, model: id, name, from: day, to: null, defenses: 0, how, ended: null });
  };
  const nameIn = (ms: Snapshot[], id: string) => ms.find((m) => m.id === id)?.name ?? id;
  for (const e of events) {
    if (e.kind !== 'vacated') { const seen = (s.seen[e.belt] ??= new Set()); for (const id of e.eligible) seen.add(id); }
    if (e.kind === 'opening') {
      s.opened[e.belt] = e.day;
      for (const m of e.matches) s.met.add(pairKey(data, e.field.find((x) => x.id === m.a)!, e.field.find((x) => x.id === m.b)!));
      crown(e.belt, e.champion, nameIn(e.field, e.champion), e.day, 'won the opening tournament');
    } else if (e.kind === 'title') {
      s.met.add(pairKey(data, e.champion, e.challenger));
      if (e.winner === 1) {
        Object.assign(current(e.belt)!, { to: e.day, ended: `lost to ${e.challenger.name}` });
        crown(e.belt, e.challenger, e.challenger.name, e.day, `beat ${e.champion.name} (${e.decision === 'ko' ? 'K.O.' : e.decision})`);
      } else current(e.belt)!.defenses++;
    } else if (e.kind === 'vacant') {
      s.met.add(pairKey(data, e.a, e.b));
      const w = e.winner === 1 ? e.b : e.a, other = w === e.a ? e.b : e.a;
      crown(e.belt, w, w.name, e.day, e.winner === -1 ? 'drew the vacant-title fight, ranked higher' : `won the vacant-title fight vs ${other.name}`);
    } else if (e.kind === 'quiet') {
      // nothing changes hands
    } else {
      Object.assign(current(e.belt)!, { to: e.day, ended: e.reason });
      s.champions[e.belt] = null;
    }
  }
  return s;
}

// ---------- writing the log ----------
const DAY = 864e5;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
/** Belt order on title nights: alternate between the belts already open, by week. */
export const titleNightBelt = (day: string, open: BeltId[]) => open[Math.floor(Date.parse(day) / (7 * DAY)) % open.length];
/** The data build records this many days ahead, so a page built the day before already has the night's fight (like the daily schedule). */
export const TITLE_LOOKAHEAD_DAYS = 1;
/** The two fighters of a recorded fight, champion (or higher-ranked) first. */
export const fightersOf = (e: TitleEvent): [Snapshot, Snapshot] | null => (e.kind === 'title' ? [e.champion, e.challenger] : e.kind === 'vacant' ? [e.a, e.b] : null);
export const beltName = (id: BeltId) => BELTS.find((b) => b.id === id)!.name;

/**
 * Adds the days after `log.through`, up to and including `today`, using the roster as it is now. Earlier entries are
 * returned untouched, and a day already covered is never looked at again.
 */
export function advanceTitles(data: BrawlData, log: TitleLog, today: string, seasonStart = SEASON_START): TitleLog {
  if (!seasonStart || !seasonOn(today, seasonStart)) return log; // the day being booked must be in the season
  const events = [...log.events], dataDate = data.generatedAt.slice(0, 10);
  const first = log.through && log.through >= seasonStart ? addDays(log.through, 1) : seasonStart;
  const fightable = (a: Model, b: Model) => sharedRounds(data, a, b) >= MIN_SHARED;
  const blockedWhy = (a: Model, b: Model): Blocked => (fightable(a, b) ? 'met' : 'not comparable');
  for (let day = first; day <= today; day = addDays(day, 1)) {
    let st = standings(data, events);
    const base = { day, rules: TITLE_RULES, dataDate };

    // openings: 8 eligible models, every pair comparable and not yet met; the highest-ranked such field
    // the roster as it is on that day: released by then (a catch-up run must not put a later model into an earlier
    // fight) and not yet past the one-year cutoff (a booking made a day ahead must match that day's own build)
    const roster = data.models.filter((m) => onRosterOn(m, day));
    for (const belt of BELTS) {
      if (st.opened[belt.id]) continue;
      const pool = roster.filter((m) => eligibleFor(data, belt.id, m));
      const f = field(pool, (x, y) => fightable(x, y) && !st.met.has(pairKey(data, x, y)));
      if (!f) continue; // no valid field yet: the belt opens later
      const bracket = runTournament(data, f, CHAMPIONSHIP_ROUNDS)!;
      const snaps = f.map((m) => snapshotFighters(data, m, m, CHAMPIONSHIP_ROUNDS)[0]);
      events.push({ kind: 'opening', belt: belt.id, ...base, eligible: pool.map((m) => m.id), field: snaps,
        matches: bracket.rounds.flat().map((m) => ({ a: m.a.id, b: m.b.id, winner: m.winner.id, tiebreak: m.tiebreak, hp: m.fight.hp })), champion: bracket.champion.id });
      st = standings(data, events);
    }

    if (new Date(`${day}T00:00:00Z`).getUTCDay() !== TITLE_NIGHT) continue;
    const open = BELTS.map((b) => b.id).filter((b) => st.opened[b] && st.opened[b]! < day);
    if (!open.length) continue;
    const belt = titleNightBelt(day, open), pool = roster.filter((m) => eligibleFor(data, belt, m)), eligible = pool.map((m) => m.id);
    const champId = st.champions[belt];
    let champion = champId ? pool.find((m) => m.id === champId) ?? null : null;

    // a champion who left the roster or the class gives up the belt
    if (champId && !champion) {
      events.push({ kind: 'vacated', belt, ...base, model: champId, reason: roster.some((m) => m.id === champId) ? 'vacated: no longer eligible' : 'vacated: left the roster' });
      st = standings(data, events);
    }
    if (!champion) {
      // vacant: the two highest-ranked eligible models that can be compared and haven't met on these scores
      const order = ranked(pool.filter((m) => m.eci != null));
      let pair: [Model, Model] | null = null;
      for (let i = 0; i < order.length && !pair; i++) for (let j = i + 1; j < order.length && !pair; j++)
        if (fightable(order[i], order[j]) && !st.met.has(pairKey(data, order[i], order[j]))) pair = [order[i], order[j]];
      if (!pair) {
        const pairs: Record<Blocked, number> = { met: 0, 'not comparable': 0 };
        order.forEach((x, i) => order.slice(i + 1).forEach((y) => pairs[blockedWhy(x, y)]++));
        events.push({ kind: 'quiet', belt, ...base, eligible, pairs,
          reason: order.length < 2 ? 'vacant: fewer than two ranked contenders' : 'vacant: no pair meets the vacant-title booking rules' });
        continue;
      }
      const fight = planFight(data, pair[0], pair[1], CHAMPIONSHIP_ROUNDS), [a, b] = snap(data, pair[0], pair[1]);
      events.push({ kind: 'vacant', belt, ...base, eligible, a, b, winner: fight.winner, decision: fight.decision, hp: fight.hp, roundsWon: fight.roundsWon, champion: (fight.winner === 1 ? b : a).id });
      continue;
    }

    // a title fight. Contenders: the top 3 eligible by Capabilities Index (champion excluded), plus any newcomer with
    // no index yet that beats the #3 of them. Newcomers (eligible for this belt for the first time) go first, earliest
    // roster arrival first; then the others by index. Every booking still needs 3 comparable rounds and no meeting on these scores.
    const holder = champion, seen = st.seen[belt] ?? new Set();
    const indexed = ranked(pool.filter((m) => m.id !== holder.id && m.eci != null));
    const top = new Set(indexed.slice(0, TOP_CONTENDERS).map((m) => m.id)), third = indexed[TOP_CONTENDERS - 1] ?? null;
    const bookable = (m: Model) => fightable(holder, m) && !st.met.has(pairKey(data, holder, m));
    const isNew = (m: Model) => m.id !== holder.id && !seen.has(m.id);
    const unindexed = pool.filter((m) => isNew(m) && m.eci == null);
    const verdicts = new Map(unindexed.map((m) => [m.id, qualifies(data, m, third)]));
    const newcomers = pool.filter((m) => isNew(m) && (top.has(m.id) || verdicts.get(m.id) === true) && bookable(m)).sort(byArrival(data));
    const ch = newcomers[0] ?? ranked(pool.filter((m) => top.has(m.id) && !isNew(m) && bookable(m)))[0];
    const waiting = unindexed.flatMap((m) => { const v = verdicts.get(m.id)!; return v === true ? [] : [{ id: m.id, why: v }]; });
    if (!ch) { // the normal daily brawl runs
      const blocked = [...top].map((id) => ({ id, why: blockedWhy(holder, pool.find((m) => m.id === id)!) }));
      events.push({ kind: 'quiet', belt, ...base, eligible, blocked, ...(waiting.length ? { waiting } : {}),
        reason: top.size ? 'no challenger: no top contender meets the booking rules' : 'no challenger: no ranked contenders' });
      continue;
    }
    const fight = planFight(data, holder, ch, CHAMPIONSHIP_ROUNDS), [c, x] = snap(data, holder, ch);
    events.push({ kind: 'title', belt, ...base, eligible, why: isNew(ch) ? 'new challenger' : 'top contender',
      ...(ch.eci == null ? { qualified: { by: 'beat #3' as const, ref: third!.id } } : {}),
      champion: c, challenger: x, winner: fight.winner, decision: fight.decision, hp: fight.hp, roundsWon: fight.roundsWon });
  }
  return { through: today, events };
}

/**
 * v1.2: whether a newcomer with no Capabilities Index earns a title shot: it must strictly beat `third`, the belt's #3
 * contender by index, under the championship fight rules, on at least MIN_SHARED comparable rounds. A draw doesn't
 * qualify; with no #3, or too few comparable rounds, it waits for an index. This check isn't a fight on record.
 */
export function qualifies(data: BrawlData, m: Model, third: Model | null): true | NotQualified {
  if (!third) return 'no #3 contender';
  if (sharedRounds(data, m, third) < MIN_SHARED) return 'not comparable with #3';
  return planFight(data, m, third, CHAMPIONSHIP_ROUNDS).winner === 0 ? true : 'did not beat #3';
}
/** Earliest roster arrival first, then id. Fighters with no known arrival day (on the roster before tracking began) come first. */
const byArrival = (data: BrawlData) => (a: Model, b: Model) =>
  (data.arrivals?.seen[a.id] ?? '').localeCompare(data.arrivals?.seen[b.id] ?? '') || a.id.localeCompare(b.id);

/** The highest-ranked group of FIELD_SIZE where every pair passes `ok`: rank order, skipping a model only when no valid field includes it. */
function field(pool: Model[], ok: (a: Model, b: Model) => boolean): Model[] | null {
  const order = ranked(pool);
  const pick = (from: number, f: Model[]): Model[] | null => {
    if (f.length === FIELD_SIZE) return f;
    for (let i = from; i <= order.length - (FIELD_SIZE - f.length); i++) {
      if (!f.every((x) => ok(x, order[i]))) continue;
      const done = pick(i + 1, [...f, order[i]]);
      if (done) return done;
    }
    return null;
  };
  return pick(0, []);
}

/** Throws unless `next` keeps every entry of `prev` exactly as it was, in order: the log only grows. */
export function checkAppendOnly(prev: TitleLog | undefined, next: TitleLog) {
  if (!prev) return;
  if (prev.through && (!next.through || next.through < prev.through)) throw new Error(`title log went back from ${prev.through} to ${next.through}`);
  prev.events.forEach((e, i) => {
    if (JSON.stringify(e) !== JSON.stringify(next.events[i])) throw new Error(`title log entry ${i} (${e.kind}, ${e.belt}, ${e.day}) was changed or removed`);
  });
}

/** A recorded title fight, replayed from its snapshots: the same result as when it was written. */
export const replayTitle = (data: BrawlData, e: Extract<TitleEvent, { kind: 'title' }>) => planFight(data, e.champion, e.challenger, CHAMPIONSHIP_ROUNDS);
