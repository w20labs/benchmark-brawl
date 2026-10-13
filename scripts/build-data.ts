/**
 * Builds data/brawl.json from Epoch AI's Benchmarking Hub (CC BY 4.0) and OpenRouter's public model list (prices).
 *
 *   npm run data             download fresh data
 *   npm run data -- --cached reuse data/cache (no network)
 *
 * One fighter per Epoch "model group" (e.g. "Claude Opus 5.5"). For each benchmark we keep the group's best
 * reported score across reasoning settings, and say which setting it was.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { parseCsv } from '../src/csv.ts';
import type { Benchmark, BrawlData, Model, Price, Round, Score } from '../src/types.ts';

const EPOCH_ZIP = 'https://epoch.ai/data/benchmark_data.zip';
const OPENROUTER = 'https://openrouter.ai/api/v1/models';
const CACHE = 'data/cache';
const cached = process.argv.includes('--cached');

const EPOCH = { name: 'Epoch AI Benchmarking Hub', url: 'https://epoch.ai/benchmarks', license: 'CC BY 4.0' };
const via = (name: string, url: string) => ({ name: `${name}, via Epoch AI`, url, license: 'Original source terms (see their site)' });

type Spec = Benchmark & { file: string; scoreCol: string; seFrom?: 'stderr' | 'ci95' };
const SPECS: Spec[] = [
  { id: 'deepswe', name: 'DeepSWE', what: 'Fix real software issues, every model in the same agent setup', kind: 'score', epochRun: false,
    source: via('DeepSWE by Datacurve', 'https://deepswe.datacurve.ai/'), file: 'deepswe_external.csv', scoreCol: 'Pass@1', seFrom: 'ci95' },
  { id: 'frontiercode', name: 'FrontierCode', what: 'Long coding tasks, each lab in its own agent', kind: 'score', epochRun: false,
    source: via('FrontierCode by Cognition', 'https://cognition.com/frontiercode'), file: 'frontiercode_external.csv', scoreCol: 'Main score' },
  { id: 'frontiermath', name: 'FrontierMath Tiers 1–3', what: 'Research-level math problems', kind: 'score', epochRun: true,
    source: EPOCH, file: 'frontiermath_tiers_1_3_v2.csv', scoreCol: 'Best score (across scorers)', seFrom: 'stderr' },
  { id: 'aime', name: 'OTIS Mock AIME', what: 'High-school competition math', kind: 'score', epochRun: true,
    source: EPOCH, file: 'otis_mock_aime_2024_2025.csv', scoreCol: 'Best score (across scorers)', seFrom: 'stderr' },
  { id: 'gpqa', name: 'GPQA Diamond', what: 'PhD-level science questions', kind: 'score', epochRun: true,
    source: EPOCH, file: 'gpqa_diamond.csv', scoreCol: 'Best score (across scorers)', seFrom: 'stderr' },
  { id: 'simpleqa', name: 'SimpleQA Verified', what: 'Short factual questions, no web search', kind: 'score', epochRun: true,
    source: EPOCH, file: 'simpleqa_verified.csv', scoreCol: 'Best score (across scorers)', seFrom: 'stderr' },
  { id: 'mystery', name: 'Mystery Game Puzzles', what: 'Work out the rules of games never seen before', kind: 'score', epochRun: true,
    source: EPOCH, file: 'mystery_game_puzzles.csv', scoreCol: 'Best score (across scorers)', seFrom: 'stderr' },
  { id: 'chess', name: 'Chess Puzzles', what: 'Find the winning move', kind: 'score', epochRun: true,
    source: EPOCH, file: 'chess_puzzles.csv', scoreCol: 'Best score (across scorers)', seFrom: 'stderr' },
];
const PRICE: Benchmark = {
  id: 'price', name: 'OpenRouter list price', what: 'Cheaper wins: dollars per million tokens, blended 3:1 input to output', kind: 'price', epochRun: false,
  source: { name: 'OpenRouter model list', url: 'https://openrouter.ai/models', license: 'Public list prices' },
};
const ROUNDS: Round[] = [
  { id: 'coding', name: 'Coding', benches: ['deepswe', 'frontiercode'] },
  { id: 'math', name: 'Math', benches: ['frontiermath', 'aime'] },
  { id: 'science', name: 'Science', benches: ['gpqa'] },
  { id: 'facts', name: 'Facts', benches: ['simpleqa'] },
  { id: 'puzzles', name: 'Puzzles', benches: ['mystery'] },
  { id: 'chess', name: 'Chess', benches: ['chess'] },
  { id: 'price', name: 'Price', benches: ['price'] },
];
const DEFAULT_ROUNDS = ['coding', 'math', 'science', 'facts', 'puzzles'];
/** Fighters: released in the last year, and with a result in at least three of the default rounds. */
const MAX_AGE_DAYS = 365, MIN_DEFAULT_ROUNDS = 3;
const hasRound = (scores: Record<string, Score>, id: string) => ROUNDS.find((r) => r.id === id)!.benches.some((b) => scores[b]);

async function fetchCached(url: string, file: string): Promise<Buffer> {
  const path = `${CACHE}/${file}`;
  if (cached) return readFileSync(path);
  const res = await fetch(url, { headers: { 'user-agent': 'benchmark-brawl data build (github.com/w20labs)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, buf);
  return buf;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const SETTING = /_(max|xhigh|high|medium|low|minimal|none|unknown|promax|\d+K)$/;

async function main() {
  const zip = unzipSync(new Uint8Array(await fetchCached(EPOCH_ZIP, 'benchmark_data.zip')));
  const csv = (name: string) => {
    const key = Object.keys(zip).find((k) => k === name || k.endsWith(`/${name}`));
    if (!key) throw new Error(`${name} missing from Epoch's download`);
    return parseCsv(strFromU8(zip[key]));
  };

  // model version -> group, org, release, access
  const meta = new Map<string, Record<string, string>>();
  for (const r of csv('model_metadata.csv')) if (r.model_version) meta.set(r.model_version, r);
  const groupOf = (version: string, row: Record<string, string>) => meta.get(version)?.model_group || meta.get(version.replace(SETTING, ''))?.model_group || row['Name'] || version.replace(SETTING, '');
  const settingOf = (version: string, row: Record<string, string>) => row['Reasoning effort'] || version.match(SETTING)?.[1] || 'default';

  type Acc = { name: string; org: string; released: string; access: string; scores: Record<string, Score> };
  const groups = new Map<string, Acc>();
  for (const spec of SPECS) {
    for (const row of csv(spec.file)) {
      const version = row['Model version'];
      const raw = Number(row[spec.scoreCol] || row['mean_score']);
      if (!version || !Number.isFinite(raw)) continue;
      const name = groupOf(version, row);
      const m = meta.get(version) ?? meta.get(version.replace(SETTING, ''));
      const g = groups.get(name) ?? { name, org: row['Organization'] || m?.organization || '', released: row['Release date'] || m?.date || '', access: m?.accessibility || '', scores: {} };
      if (!g.released && row['Release date']) g.released = row['Release date'];
      if (!g.access && m?.accessibility) g.access = m.accessibility;
      groups.set(name, g);
      const v = Math.round(raw * 1000) / 10;
      const se = spec.seFrom === 'stderr' && row['stderr'] ? Number(row['stderr']) * 100
        : spec.seFrom === 'ci95' && row['95% CI half-width'] ? (Number(row['95% CI half-width']) * 100) / 1.96 : null;
      const prev = g.scores[spec.id];
      if (!prev || v > prev.v) {
        g.scores[spec.id] = { v, se: se != null && Number.isFinite(se) ? Math.round(se * 100) / 100 : null, setting: settingOf(version, row), ...(row['Log viewer'] ? { log: row['Log viewer'] } : {}) };
      }
    }
  }

  const eci = new Map(csv('epoch_capabilities_index/eci_scores.csv').map((r) => [r['Model'], Number(r['eci'])]));

  // OpenRouter list prices, matched by name ("Anthropic: Claude Opus 5.5" <-> "Claude Opus 5.5")
  const or = JSON.parse((await fetchCached(OPENROUTER, 'openrouter-models.json')).toString()) as { data: { id: string; name: string; pricing: { prompt: string; completion: string } }[] };
  const prices = new Map<string, Price>();
  for (const m of or.data) {
    if (m.id.includes(':')) continue; // :batch, :free and other variants
    const input = Number(m.pricing.prompt) * 1e6, output = Number(m.pricing.completion) * 1e6;
    if (!(input > 0 && output > 0)) continue;
    const key = norm(m.name.replace(/^[^:]*:\s*/, ''));
    if (!prices.has(key)) prices.set(key, { input: round2(input), output: round2(output), blended: round2((3 * input + output) / 4), openrouterId: m.id });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 864e5).toISOString().slice(0, 10);
  const models: Model[] = [...groups.values()]
    .filter((g) => g.released >= cutoff && !/unreleased/i.test(g.access))
    .filter((g) => DEFAULT_ROUNDS.filter((id) => hasRound(g.scores, id)).length >= MIN_DEFAULT_ROUNDS)
    .map((g) => ({
      id: norm(g.name),
      name: g.name,
      org: g.org.split(',')[0].trim(),
      released: g.released,
      open: /^open weights/i.test(g.access),
      eci: eci.get(g.name) ?? null,
      price: prices.get(norm(g.name)) ?? null,
      scores: g.scores,
    }))
    .sort((a, b) => (b.eci ?? 0) - (a.eci ?? 0) || b.released.localeCompare(a.released));

  const data: BrawlData = {
    generatedAt: now.toISOString(),
    benchmarks: [...SPECS.map(({ file: _f, scoreCol: _c, seFrom: _s, ...b }) => b), PRICE],
    rounds: ROUNDS,
    defaultRounds: DEFAULT_ROUNDS,
    models,
  };
  mkdirSync('data', { recursive: true });
  writeFileSync('data/brawl.json', `${JSON.stringify(data, null, 1)}\n`);
  const priced = models.filter((m) => m.price).length;
  console.log(`Wrote data/brawl.json: ${models.length} fighters (${priced} with prices), ${data.benchmarks.length} rounds.`);
  for (const id of DEFAULT_ROUNDS) console.log(`  ${id}: ${models.filter((m) => hasRound(m.scores, id)).length}/${models.length}`);
}

function round2(n: number) { return Math.round(n * 100) / 100; }

main().catch((e) => { console.error(e); process.exit(1); });
