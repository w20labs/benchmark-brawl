<p align="center">
  <img src="assets/og.png" alt="Benchmark Brawl: two robots fight, an orbital laser hits one of them" width="100%">
</p>

<p align="center">
  <a href="https://github.com/w20labs/benchmark-brawl/actions/workflows/ci.yml"><img src="https://github.com/w20labs/benchmark-brawl/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/code-MIT-2EC4A6" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/scores-Epoch%20AI%20(CC%20BY)-F2B544" alt="Scores from Epoch AI">
</p>

**Benchmark Brawl turns AI benchmark tables into fights.** Pick two real models. Every round is a benchmark: the higher score lands the hit, and the bigger the gap, the bigger the weapon, from a machine gun up to an orbital laser. Scores are real, every number links to its source, and a round inside the margin of error is a tie.

## What you can do

| | |
|---|---|
| **Fight** | Any two of ~70 models released in the last year, with real scores from Epoch AI |
| **Build your arena** | Pick 3–7 rounds (Coding, Math, Science, Facts, Puzzles, Chess, Price) or a preset like *I write code* or *On a budget*. The fight answers "which model wins *for me*?" |
| **Price round** | The cheaper model wins; every halving of price is worth a 10-point hit |
| **Weight classes** | Closed vs open weights, and budget / mid / premium by price |
| **Battle royale** | 3 to 8 models in one arena. Each round the best result fires at everyone else; last one standing wins |
| **Tournament** | The top 8 of a weight class, seeded by Epoch Capabilities Index, fought out as a bracket |
| **New challenger** | The newest model (last 30 days) against the champion, on the front page |
| **Share** | A Wordle-style result line with a link that replays the same fight, and a **fight clip** (MP4) recorded in your browser |

<table>
  <tr>
    <td width="50%"><img src="assets/readme/arena-builder.png" alt="Build your arena: presets and round chips"></td>
    <td width="50%"><img src="assets/readme/bracket.png" alt="A tournament bracket"></td>
  </tr>
  <tr><td colspan="2"><img src="assets/readme/scorecard.png" alt="The scorecard after a fight: every score with its benchmark, source, setting and margin of error"></td></tr>
</table>

## Signature moves

Every lab has a signature move. It plays in place of the weapon on a model's **biggest hit** of the fight. It's just for fun: the damage is always exactly what the scores say.

| Lab | Move | |
|---|---|---|
| xAI | **Aura Farming** | Strikes a pose, shades drop, golden aura. On a K.O., RATIO |
| Anthropic | **I apologize for the confusion** | Apologizes politely, then throws the apology |
| OpenAI | **Em Dash Barrage** | It rains em dashes. Something about "delve" |
| Google DeepMind | **Two Million Tokens** | Opens a huge context window; the whole library falls out |
| DeepSeek | **Clearance Sale** | A giant 95% OFF tag, and coins everywhere |
| Alibaba | **Release Day** | Fourteen model sizes stampede across the arena |
| Moonshot | **Moonshot** | Launches the moon |
| Z.ai | **Zorro Slash** | Carves a giant Z |
| Thinking Machines | **Deep Thought** | Thinks for 7.5 million years, then throws 42 |
| MiniMax | **Mini → MAX** | A giant version of itself stomps down |
| Nvidia | **GPU Drop** | A graphics card falls from the sky. It's sold out |
| Mistral · Meta | **Mistral** · **Llama Spit** | Ready for when their models join the roster |
| Everyone else | **Hallucination** | Confidently summons an opponent that doesn't exist |

Moves live in [`src/page/specials.js`](src/page/specials.js). They're affectionate jokes about each lab, not claims about anyone.

## The rules

| Rule | Detail |
|---|---|
| One benchmark per round | A round lists benchmarks in order (Coding: DeepSWE, then FrontierCode). The fight uses the first one **both** models have, so it always compares like with like |
| Best reported setting | Each model's best score across its reasoning settings (low, high, max…); the scorecard says which |
| Damage | 2 × the score gap in percentage points |
| Ties | A gap inside the combined 95% margin of error is a tie: no damage. Rounds without a published margin only tie on equal scores, and the game says so |
| Price | Blended list price, (3 × input + output) / 4 per million tokens. Cheaper wins; within 15% is a tie |
| Weapons | Gap 1–4 machine gun · 5–9 rocket launcher · 10–15 meteor shower · 16+ orbital laser |
| Winner | K.O. at 0 HP, otherwise the most HP left. A model can win fewer rounds and still win, if its wins were bigger |
| Battle royale | Each round uses the round's benchmark most fighters have. The best result fires at everyone: 2 × their gap to it, a dodge inside the margin. A fighter without that result sits the round out. 0 HP is out; the last one standing, or the most HP, wins |
| Tournament | Top 8 by Epoch Capabilities Index; 1 v 8, 4 v 5, 2 v 7, 3 v 6; a draw goes to the higher seed |

The rules live in [`src/fight.ts`](src/fight.ts) and [`src/league.ts`](src/league.ts) and are covered by tests.

## Where the numbers come from

| Data | Source | Terms |
|---|---|---|
| Math, Science, Facts, Puzzles, Chess, Capabilities Index, model metadata | [Epoch AI Benchmarking Hub](https://epoch.ai/benchmarks), Epoch's own runs | CC BY 4.0 |
| Coding: DeepSWE | [Datacurve](https://deepswe.datacurve.ai/), as republished by Epoch AI | The original source's terms |
| Coding: FrontierCode | [Cognition](https://cognition.com/frontiercode), as republished by Epoch AI | The original source's terms |
| Prices | [OpenRouter](https://openrouter.ai/models) public model list | Public list prices |

The data is rebuilt every morning by [`scripts/build-data.ts`](scripts/build-data.ts). Numbers are never edited by hand. If you spot one that doesn't match its source, please [report it](https://github.com/w20labs/benchmark-brawl/issues/new?template=wrong-number.yml).

**Honest limits.** Benchmarks measure narrow skills, and the newest models aren't on every benchmark yet (a round with no shared benchmark is skipped). FrontierCode lets each lab use its own agent, so it is only used for Coding when DeepSWE doesn't cover both models. There is no speed round: we found no free, independent speed data whose terms allow reuse.

Visits to the site are counted anonymously with [GoatCounter](https://www.goatcounter.com/) (no cookies, no personal data).

Benchmark Brawl is independent and not affiliated with any AI lab, Epoch AI, Datacurve, Cognition or OpenRouter.

## Run it locally

You need **Node.js 24** (`nvm use`).

```sh
npm install
npm run data        # fresh scores and prices (-- --cached reuses data/cache)
npm run build       # writes _site/index.html
open _site/index.html
```

| Command | What it does |
|---|---|
| `npm run typecheck` / `npm test` | Type-check and unit tests (rules, league, data sanity) |
| `npm run test:e2e` | Browser tests on desktop and phone sizes (`npx playwright install chromium` once) |
| `node scripts/make-og.mjs` | Regenerates the link preview image from a real fight |

## Contributing

Bug reports, wrong-number reports and ideas are welcome as [issues](https://github.com/w20labs/benchmark-brawl/issues/new/choose). Pull requests are limited to the project's collaborators; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code: [MIT](LICENSE). Scores: Epoch AI, CC BY 4.0, plus the terms of the original sources listed above.
