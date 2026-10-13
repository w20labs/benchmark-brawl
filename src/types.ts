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

export type BrawlData = {
  generatedAt: string;
  benchmarks: Benchmark[];
  rounds: Round[];
  /** Round ids of the default arena. */
  defaultRounds: string[];
  models: Model[];
};
