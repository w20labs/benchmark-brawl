/** Shapes of data/brawl.json, shared by the data build, the page and the tests. */

export type Source = { name: string; url: string; license: string };

export type Benchmark = {
  id: string;
  /** The benchmark's own name, e.g. "DeepSWE". */
  name: string;
  /** One line on what it tests. */
  what: string;
  kind: 'score' | 'price';
  source: Source;
  /** True for Epoch AI's own runs; false for results Epoch republishes from elsewhere. */
  epochRun: boolean;
  /** The benchmark version our results are for, when the source names one (claims must match it). */
  version?: string;
};

/** A round category. A fight uses the first benchmark in `benches` that both fighters have a result for. */
export type Round = {
  id: string;
  name: string;
  benches: string[];
  /** 'average': a 1v1 round averages the gaps over every benchmark in `benches` both fighters have. */
  combine?: 'average';
};

export type Score = {
  /** Percent, 0–100. */
  v: number;
  /** Standard error in percentage points, when the source publishes one. */
  se: number | null;
  /** The reasoning setting that produced this score, e.g. "max". */
  setting: string;
  /** Link to the run's logs when there is one. */
  log?: string;
};

export type Price = {
  /** US dollars per million tokens. */
  input: number;
  output: number;
  /** (3 × input + output) / 4: a common blend for typical chat traffic. */
  blended: number;
  /** Where the price comes from: the lab's own API, as listed on models.dev. */
  provider: string;
  modelsDevId: string;
};

export type Model = {
  id: string;
  name: string;
  org: string;
  /** YYYY-MM-DD */
  released: string;
  open: boolean;
  /** Epoch Capabilities Index, used to seed tournaments. */
  eci: number | null;
  price: Price | null;
  scores: Record<string, Score>;
};

/** A number a lab published about its own model, next to the independent result for the same benchmark. */
export type Claim = {
  modelId: string;
  bench: string;
  /** What the lab published, in percent. */
  claimed: number;
  version: string | null;
  /** What the lab says about how it ran it (effort, tools, harness…). */
  conditions: string;
  url: string;
  quote: string;
  published: string | null;
  /** The reasoning setting the lab names, if any. */
  labSetting: string | null;
  /** The independent result: at the same reasoning setting when the lab names one, else the best. */
  indep: { v: number; se: number | null; setting: string; sameSetting: boolean };
};

/**
 * One day's official fight. Written once and never changed. It keeps a snapshot of both fighters (their scores at
 * the time), so a later score refresh can't change that day's result, and it still plays if a fighter leaves the roster.
 */
export type DailyEntry = { no: number; day: string; a: string; b: string; rounds: string[]; featured: boolean; fighters?: [Model, Model] };

export type BrawlData = {
  generatedAt: string;
  benchmarks: Benchmark[];
  rounds: Round[];
  /** Round ids of the default arena. */
  defaultRounds: string[];
  models: Model[];
  /** Claim check: labs' own published numbers next to independent results. */
  claims: Claim[];
  /** The daily brawl schedule: past days are kept as they were, new days appended. */
  daily?: DailyEntry[];
  /** Overfit FC title belts: an append-only log of openings, title fights and vacated belts (see src/titles.ts). */
  titles?: import('./titles.ts').TitleLog;
};
