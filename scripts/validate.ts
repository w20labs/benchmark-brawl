/**
 * Checks for the data build. Upstream files change shape without warning; these make the build fail loudly instead
 * of publishing a roster with a missing round, 0% scores or no prices. A failed build keeps yesterday's data live.
 */
import type { BrawlData } from '../src/types.ts';

/** A number from a CSV cell, or null for a blank or non-numeric cell (never a silent 0). For optional columns only. */
export function num(cell: string | undefined): number | null {
  if (cell == null || cell.trim() === '') return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}

/**
 * A number from a CSV cell we rely on: null only when the cell is blank (missing). A non-blank cell that isn't a
 * number, or is outside [min, max], fails the build: it means the source changed format, and guessing would publish
 * wrong scores or drop error margins without anyone noticing.
 */
export function strictNum(cell: string | undefined, where: string, min = -Infinity, max = Infinity): number | null {
  if (cell == null || cell.trim() === '') return null;
  const n = Number(cell);
  if (!Number.isFinite(n)) throw new Error(`${where}: "${cell}" is not a number`);
  if (n < min || n > max) throw new Error(`${where}: ${n} is outside ${min}..${max}`);
  return n;
}

/** A price from models.dev: a finite, non-negative number (numeric strings are accepted), else null. */
export function priceNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Throws unless every column is present in the file's header. */
export function requireColumns(rows: Record<string, string>[], columns: string[], file: string) {
  if (!rows.length) throw new Error(`${file}: no rows`);
  const have = new Set(Object.keys(rows[0]));
  const missing = columns.filter((c) => !have.has(c));
  if (missing.length) throw new Error(`${file}: missing column(s) ${missing.map((c) => `"${c}"`).join(', ')}`);
}

type ModelsDev = Record<string, { models?: Record<string, { name?: string; cost?: { input?: number; output?: number }; release_date?: string }> }>;
/** Throws unless models.dev looks like a provider -> models map with prices. */
export function checkModelsDev(md: unknown): asserts md is ModelsDev {
  if (!md || typeof md !== 'object' || Array.isArray(md)) throw new Error('models.dev: expected an object of providers');
  const providers = Object.values(md as Record<string, unknown>).filter((p) => p && typeof p === 'object' && 'models' in (p as object));
  const priced = providers.flatMap((p) => Object.values((p as { models: Record<string, { cost?: { input?: number } }> }).models ?? {})).filter((m) => typeof m?.cost?.input === 'number');
  if (providers.length < 5 || priced.length < 50) throw new Error(`models.dev: unexpected shape (${providers.length} providers, ${priced.length} priced models)`);
}

/** Only web links may become source links on the page. */
export const isWebUrl = (url: string) => { try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; } };

/** Same benchmark version? "v1.1" and "1.1" match; a claim without a version matches; a stated different one doesn't. */
export function sameVersion(claim: string | null | undefined, ours: string | undefined): boolean {
  if (!ours || claim == null) return true;
  const n = (v: string) => v.toLowerCase().replace(/^v/, '').trim();
  return n(claim) === n(ours);
}

/** Days between two dates (YYYY-MM-DD or YYYY-MM). */
export const daysApart = (a: string, b: string) => Math.abs(Date.parse(a.length === 7 ? `${a}-15` : a) - Date.parse(b.length === 7 ? `${b}-15` : b)) / 864e5;

/**
 * Compares a new build with the one it replaces and throws on a suspicious drop: a default round or prices
 * vanishing, or the roster, a round's coverage, prices or claims shrinking by more than 40%.
 */
export function checkCoverage(next: BrawlData, prev: BrawlData | null, defaultRounds: string[]) {
  const coverage = (d: BrawlData, id: string) => {
    const r = d.rounds.find((x) => x.id === id);
    return r ? d.models.filter((m) => r.benches.some((b) => m.scores[b])).length : 0;
  };
  const problems: string[] = [];
  for (const id of defaultRounds) if (!coverage(next, id)) problems.push(`no fighter has a result for ${id}`);
  if (!next.models.some((m) => m.price)) problems.push('no fighter has a price');
  if (!next.models.some((m) => m.eci != null)) problems.push('no fighter has a Capabilities Index');
  if (prev) {
    const shrink = (what: string, a: number, b: number) => { if (b > 0 && a < b * 0.6) problems.push(`${what} fell from ${b} to ${a}`); };
    shrink('the roster', next.models.length, prev.models.length);
    shrink('priced fighters', next.models.filter((m) => m.price).length, prev.models.filter((m) => m.price).length);
    shrink('checkable claims', next.claims.length, prev.claims?.length ?? 0);
    shrink('fighters with a Capabilities Index (tournament seeding)', next.models.filter((m) => m.eci != null).length, prev.models.filter((m) => m.eci != null).length);
    for (const id of defaultRounds) shrink(`${id} coverage`, coverage(next, id), coverage(prev, id));
  }
  if (problems.length) throw new Error(`Refusing to publish this data:\n  - ${problems.join('\n  - ')}\n(Set BRAWL_ALLOW_DROP=1 if the drop is real.)`);
}
