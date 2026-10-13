# Contributing to Benchmark Brawl

Thanks for your interest. Please read this first: **this project does not accept pull requests from outside its contributors list.**

## Who can open pull requests

Only collaborators on this repository can open pull requests. GitHub enforces this, on purpose: every change is reviewed by hand and we don't merge unsolicited code. If you'd like to become a contributor, open an issue saying what you'd like to work on and why.

## How everyone else can help

- **Report a wrong number.** Every score links to its source. If a number in the game doesn't match the source, open a "Wrong number" issue with both links. This is the most useful report there is.
- **Report a bug**: say what you did, what you expected and what happened, plus browser and device.
- **Suggest a benchmark or round**: it needs a public source whose terms allow reuse, and results for most of the roster.
- **Security problems**: report them privately, see [SECURITY.md](SECURITY.md).

## For contributors

You need **Node.js 24** (`nvm use`).

```sh
npm install
npm run data             # download fresh data (add -- --cached to reuse data/cache)
npm run build            # write _site/index.html
open _site/index.html
npm run typecheck && npm test
npx playwright install chromium && npm run test:e2e
```

Rules for changes:

1. Open or pick an issue first for anything bigger than a typo.
2. One change per pull request, branched from `main`.
3. `npm run typecheck`, `npm test` and `npm run test:e2e` must pass; CI runs them.
4. Changes to the fight rules (`src/fight.ts`) need a test and a line in the README's rules table. The rules are the product: they must stay simple, public and fair to every lab.
5. Never edit scores by hand. Numbers come only from the data build.

By contributing you agree your contribution is licensed under the [MIT License](LICENSE).
