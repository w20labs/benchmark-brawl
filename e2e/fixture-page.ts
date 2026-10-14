import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrawlData } from '../src/types.ts';

/** The Season 2 preview's data: real rounds and benchmarks, for fixtures with made-up fighters. */
export const preview: BrawlData = JSON.parse(readFileSync('_preview/brawl.json', 'utf8'));
const html = readFileSync(resolve('_preview/index.html'), 'utf8');
const [, json] = html.match(/<script type="application\/json" id="brawl-data">([\s\S]*?)<\/script>/)!;

/** The preview page with `d` as its data, written beside it (so its relative links work). Returns its file:// URL. */
export function pageFor(d: BrawlData, name: string) {
  const file = resolve(`_preview/fixture-${name}.html`);
  const tmp = `${file}.${process.pid}.tmp`; // each worker writes its own copy, then swaps it in whole
  writeFileSync(tmp, html.replace(json, () => JSON.stringify(d).replace(/</g, '\\u003c')));
  renameSync(tmp, file);
  return `file://${file}`;
}
