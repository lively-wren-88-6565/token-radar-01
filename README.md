# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lively-wren-88-6565/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lively-wren-88-6565/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar of pre-token protocols from the DefiLlama protocol index (snapshot 2026-11-14), ranked by a value model fitted on the snapshot's traded tokens: a Theil-Sen log-log size curve over 90 cleaned comps (one per ticker, house categories and receipt tokens out), plus a shrunken sector effect. Every term was tested on a blind-test ladder (leave-one-out and old-to-new walk-forward) and kept only when it lowered the miss on both: the sector stays, growth and age do not. 196 rows, all 40 watchlist protocols covered, each with a P25–P75 range, a rank range over 200 refits, three named comps, and a costed farm plan on a $1,000 ticket at a 10% share, net of gas and the 4% T-bill the ticket gives up, ending in a Farm / Thin / Watch / Skip verdict (30 / 37 / 60 / 69). The live-token protocols are set aside with their market caps shown, never mixed into the ranking. Implied value is a model, not a price and not a prediction of a launch.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Node 22.18 or later. `main.ts` reads the sealed snapshot, scores every rankable pre-token protocol, and writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. The run is deterministic: the same snapshot bytes always write the same output bytes. The dashboard in `dashboard/` renders offline from `data.js`; the three screenshots in `screenshots/` are the board, a protocol's detail view, and a filtered view.

## How implied value is computed

```
curve    = exp( 7.876 + 0.466 x log(TVL) )   [Theil-Sen, median pairwise slope, n = 90 cleaned comps]
implied  = round( curve x exp(sector effect) )   [sector shrunk n/(n+4); Trading x1.92, Vaults x0.41]
range    = implied x P25-P75 of the leave-one-out residuals (young <540d x0.35-x8.82, older x0.31-x2.96)
```

Blind-test ladder (miss in x units, median |log error| exponentiated):

```
L0 flat multiple   LOO x5.07   walk-forward x4.64   kept (baseline)
L1 + size curve    LOO x3.53   walk-forward x2.98   kept
L2 + sector        LOO x3.24   walk-forward x2.64   kept
L3 + growth, age   LOO x3.63   walk-forward x3.08   dropped (helps neither test)
```

Walk-forward fits on listings 900+ days old (plus comps with no listing date, never known-new) and tests on the 33 newer listings. The bands hold 46/90 leave-one-out and 19/33 walk-forward. Rank ranges over 200 bootstrap refits of the comps: median width 43 ranks, so the ordering is fragile and the page says so on every row.

Farm economics, per row: slice = implied x 10% x $1,000/(TVL+$1,000) x hold/(ahead+hold), ahead = half the days with no token (capped at 365); net = slice - gas - the 4% T-bill the ticket gives up over the hold (60 or 90 days by play); Farm when net > 0, Thin when the slice covers gas, Watch when it covers a quarter of gas, Skip below that. Best per hour: GoonFi +$22.15/h.

One fitted function scores every protocol; no name is special-cased. The dashboard states the formula, the sector effects, and the ladder, and recomputes each row from it, so the page's code and `board.json` visibly agree. Token odds come from a logistic regression on all 758 protocols and are shown as their own column, not multiplied in (multiplying them would reshuffle the top 10: 8/10 overlap, Bittensor dTAO would fall from #1 to #4).

---

Entered on [make.fun](https://make.fun/?ref=4j22ejz5&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
