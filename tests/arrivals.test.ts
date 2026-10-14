import { describe, expect, it } from 'vitest';
import { checkArrivals, recentArrivals, trackArrivals, type Arrivals } from '../src/arrivals.ts';
import { seasonOn } from '../src/titles.ts';

describe('arrivals', () => {
  it('starts silently: fighters already on the roster get no arrival day', () => {
    expect(trackArrivals(undefined, undefined, ['a', 'b'], '2026-10-15')).toEqual({ since: '2026-10-15', seen: { a: null, b: null } });
    // from the last good data: only a fighter that wasn't in it arrived today
    expect(trackArrivals(undefined, ['a', 'b'], ['a', 'b', 'c'], '2026-10-15')).toEqual({ since: '2026-10-15', seen: { a: null, b: null, c: '2026-10-15' } });
    expect(recentArrivals(trackArrivals(undefined, undefined, ['a', 'b'], '2026-10-15'), '2026-10-15')).toEqual([]);
  });

  it('records a new fighter on the day it first joins, and keeps it through leaving and coming back', () => {
    let log = trackArrivals(undefined, undefined, ['a'], '2026-10-15');
    log = trackArrivals(log, undefined, ['a', 'new'], '2026-10-16');
    expect(log.seen.new).toBe('2026-10-16');
    const gone = trackArrivals(log, undefined, ['a'], '2026-10-17');
    expect(gone.seen.new).toBe('2026-10-16');
    const back = trackArrivals(gone, undefined, ['a', 'new'], '2026-10-30');
    expect(back.seen.new).toBe('2026-10-16');
    expect(recentArrivals(back, '2026-10-30')).toEqual([]);
    expect(() => checkArrivals(log, gone)).not.toThrow();
    expect(() => checkArrivals(gone, back)).not.toThrow();
  });

  it('refuses a record that changed, lost or restarted an entry', () => {
    const prev: Arrivals = { since: '2026-10-15', seen: { a: null, b: '2026-10-16' } };
    expect(() => checkArrivals(prev, { since: '2026-10-15', seen: { a: null } })).toThrow(/removed/);
    expect(() => checkArrivals(prev, { since: '2026-10-15', seen: { a: '2026-10-15', b: '2026-10-16' } })).toThrow(/changed/);
    expect(() => checkArrivals(prev, { since: '2026-10-16', seen: prev.seen })).toThrow(/start/);
    expect(() => checkArrivals(undefined, prev)).not.toThrow();
  });

  it('announces for seven UTC days, newest first, never ahead of today', () => {
    const log: Arrivals = { since: '2026-10-01', seen: { old: null, x: '2026-10-10', y: '2026-10-12', z: '2026-10-12', later: '2026-10-20' } };
    expect(recentArrivals(log, '2026-10-12')).toEqual([{ id: 'y', day: '2026-10-12' }, { id: 'z', day: '2026-10-12' }, { id: 'x', day: '2026-10-10' }]);
    expect(recentArrivals(log, '2026-10-16').map((x) => x.id)).toEqual(['y', 'z', 'x']); // day 7 for x
    expect(recentArrivals(log, '2026-10-17').map((x) => x.id)).toEqual(['y', 'z']); // x expired
    expect(recentArrivals(log, '2026-10-09')).toEqual([]);
    expect(recentArrivals(undefined, '2026-10-12')).toEqual([]);
  });
});

describe('the Season 2 gate', () => {
  it('is off with no start date, and before the start day', () => {
    expect(seasonOn('2026-10-14')).toBe(false); // SEASON_START is null
    expect(seasonOn('2026-10-14', null)).toBe(false);
    expect(seasonOn('2026-10-16', '2026-10-17')).toBe(false);
    expect(seasonOn('2026-10-17', '2026-10-17')).toBe(true);
    expect(seasonOn('2026-12-01', '2026-10-17')).toBe(true);
  });
});
