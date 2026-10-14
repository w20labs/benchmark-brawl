/**
 * When each fighter first joined our roster, as the daily data build saw it. That's not its release date: a model
 * joins once the sources have enough of its results, often weeks after release.
 *
 * The record only grows. A fighter keeps its first arrival day if it later leaves and comes back, and a day once
 * written is never changed (checked by the build, so a bug can't rewrite it). Fighters already on the roster when
 * tracking began are recorded as null: their arrival day is unknown, so they are never announced.
 *
 * Tracking runs on every build, whether or not Season 2 has started. It's invisible and changes no fight: the page
 * only uses it, for new-challenger announcements, once the season is on (see seasonOn in titles.ts).
 */
export type Arrivals = {
  /** The first day tracked. */
  since: string;
  /** Fighter id → the day it was first seen on the roster, or null if it was already there when tracking began. */
  seen: Record<string, string | null>;
};

/** How long Today announces a new arrival: the arrival day and the six days after it (UTC). */
export const ANNOUNCE_DAYS = 7;

/**
 * Adds today's roster to the record. `prev` is the last good record; `prevRoster` the ids in the last good data
 * (to start tracking from: ids not in it arrived today, the rest get null). With neither, everything gets null.
 */
export function trackArrivals(prev: Arrivals | undefined, prevRoster: string[] | undefined, roster: string[], day: string): Arrivals {
  if (!prev) {
    const before = prevRoster ? new Set(prevRoster) : null;
    return { since: day, seen: Object.fromEntries(roster.map((id) => [id, before && !before.has(id) ? day : null])) };
  }
  const seen = { ...prev.seen };
  for (const id of roster) if (!(id in seen)) seen[id] = day;
  return { since: prev.since, seen };
}

/** Throws unless `next` keeps every record of `prev` exactly: arrivals are only ever added. */
export function checkArrivals(prev: Arrivals | undefined, next: Arrivals) {
  if (!prev) return;
  if (next.since !== prev.since) throw new Error(`arrival tracking start changed from ${prev.since} to ${next.since}`);
  for (const [id, day] of Object.entries(prev.seen)) {
    if (!(id in next.seen)) throw new Error(`arrival record for ${id} was removed`);
    if (next.seen[id] !== day) throw new Error(`arrival record for ${id} changed from ${day} to ${next.seen[id]}`);
  }
}

const DAY = 864e5;
/** Fighters that arrived within ANNOUNCE_DAYS up to and including `today` (never later), newest first, then by id. */
export function recentArrivals(arrivals: Arrivals | undefined, today: string): { id: string; day: string }[] {
  if (!arrivals) return [];
  const from = new Date(Date.parse(today) - (ANNOUNCE_DAYS - 1) * DAY).toISOString().slice(0, 10);
  return Object.entries(arrivals.seen)
    .filter((x): x is [string, string] => x[1] != null && x[1] >= from && x[1] <= today)
    .map(([id, day]) => ({ id, day }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id));
}
