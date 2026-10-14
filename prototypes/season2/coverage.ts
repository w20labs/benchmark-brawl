import { readFileSync } from 'node:fs';
import { BELTS, ROUNDS, eligible, type BeltId } from './simulate.ts';
import type { BrawlData, Model } from '../../src/types.ts';
const data: BrawlData = JSON.parse(readFileSync('data/brawl.json', 'utf8'));
const has = (id: string, m: Model) => data.rounds.find((r) => r.id === id)!.benches.some((b) => !!m.scores[b]);
for (const b of Object.keys(BELTS) as BeltId[]) {
  const ms = data.models.filter(BELTS[b].test);
  console.log(`\n${b}: ${ms.length} in class; per round: ${ROUNDS.map((r) => `${r} ${ms.filter((m) => has(r, m)).length}`).join(', ')}`);
  for (const k of [5, 4, 3]) console.log(`  >=${k} rounds: ${ms.filter((m) => ROUNDS.filter((r) => has(r, m)).length >= k).length}`);
  for (const d of ['2026-04-05', '2026-06-07', '2026-07-05', '2026-08-02']) console.log(`  eligible by ${d}: ${ms.filter((m) => m.released <= d && eligible(b, m)).length}`);
}
