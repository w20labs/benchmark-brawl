# Overfit FC (Season 2) mock: review brief

Open `overfit-fc-mock.html` in a browser. It is one self-contained file (data and images inlined; only Google Fonts load from the web). Nothing here is live or committed.

## What to review

1. **The look**: Belts, Title fight (Context Window frame + Hype Hank / Sigma Sam commentary), Title history, New challenger.
2. **The proof** (Proof tab): does the backtest support rulebook v1.1?
3. **Commentary accuracy**: every Sam line must match the real numbers (`mock-data.json` → `featured.commentary`, from `src/fight.ts`).
4. **Fairness**: storylines frame the data and never change it; no claim reads as an accusation.

## Files

| File | What it is |
|---|---|
| `overfit-fc-mock.html` | The mock (generated; don't edit) |
| `mock.template.html` | Page source |
| `simulate.ts` | The belt rulebook v1.1 played week by week over the real roster (pure: takes the data) |
| `simulate.test.ts` | Synthetic tests: no rematch in either role or after an opening match, meetings counted only once played, no repeated pairings across two belts' openings, 3 comparable rounds before booking, valid opening fields (deferred when none), vacancies and vacant draws |
| `build-mock.ts` | Writes `mock-data.json`: belts, history, commentary, proof stats |
| `capture.ts` | Fight frames and portraits from the built game (`_site/`) |
| `assemble.py` | Inlines data and images into the HTML |
| `backtest.json`, `mock-data.json` | Generated data |

## Rebuild (from the repo root)

```sh
npm run build
npx vitest run --root prototypes/season2             # rule tests
npx tsx prototypes/season2/simulate.ts --json prototypes/season2/backtest.json   # backtest summary
npx tsx prototypes/season2/capture.ts claudefable5 gpt6astra title   # frames (after damage lands)
npx tsx prototypes/season2/build-mock.ts
python3 prototypes/season2/assemble.py
npx tsx prototypes/season2/check.mts /tmp            # screenshots, overflow and console errors
npx tsx prototypes/season2/phone.mts /tmp/320.png     # status row at 320px
```

## Known limits

- History is simulated: recalculated from current scores on every build. The append-only store isn't built.
- Backtest uses today's scores for every date; only the roster is "as of" each Sunday.
- The roster covers the last year only, so belts start late in the backtest.
- The arena inside the Context Window frame is still the game's Server Farm.

## Decisions (Oct 14)

1. Same-lab title fights stay: same selection rules for every lab (8 of 25 title fights in the backtest).
2. Budget belt opens later: launch with Undisputed and Open weights.
3. Stalled belts wait: no title fight that Sunday, the normal daily brawl runs.
