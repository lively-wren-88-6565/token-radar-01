# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lively-wren-88-6565/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lively-wren-88-6565/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar of pre-token protocols from the DefiLlama protocol index (snapshot 2026-11-14), ranked by a value model fitted on the snapshot's traded tokens: a Theil-Sen log-log size curve over 90 cleaned comps (one per ticker, house categories and receipt tokens out), plus a sector effect shrunk with 8 pseudo-comps, blended in log space with a v4-style ensemble (category multiple x log-log curve, blended with a multivariate OLS) at a grid-chosen weight of 0.5, plus compressed growth and age terms. 196 rows, all 40 watchlist protocols covered, each with a P25–P75 range, a rank range over 200 refits, three named comps, and a costed farm plan on a $1,000 ticket at a 10% share, net of the play's fees and the 4% T-bill the ticket gives up, ending in a Farm / Thin / Skip verdict (65 / 99 / 32). The live-token protocols are set aside with their market caps shown, never mixed into the ranking, and the 146 set-aside pre-token protocols each carry a demoted value (TVL x the median multiple of the 5 nearest live tokens, never ranked). Implied value is a model, not a price and not a prediction of a launch.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Node 22.18 or later. `main.ts` reads the sealed snapshot, scores every rankable pre-token protocol, and writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. The run is deterministic: the same snapshot bytes always write the same output bytes. The dashboard in `dashboard/` renders offline from `data.js`; the three screenshots in `screenshots/` are the board, a protocol's detail view, and a filtered view.

## How implied value is computed

```
TS value   = exp( 7.876 + 0.466 x log(TVL) ) x exp(sector effect)   [Theil-Sen, n = 90 cleaned comps; sector shrunk n/(n+8)]
ensemble   = (2/3) blend of (category multiple x log-log curve) + (1/3) multivariate OLS
blended    = exp( 0.5 x log(TS value) + 0.5 x log(ensemble value) )   [weight by grid search]
growth     = (1 + clamp(7d growth, +-0.40))^0.466
age        = clamp( exp( 0.25 x -0.147 x (age in years - 2.66) ), 0.9, 1.15 )
implied    = round( blended x growth x age )
range      = implied x P25-P75 of the leave-one-out residuals (young <540d x0.31-x9.51, older x0.34-x2.88)
```

Blind-test ladder (miss in x units, median |log error| exponentiated; L3/L4 are kept on the combined (LOO + walk-forward)/2 miss, the rest on both tests):

```
L0 flat multiple           LOO x5.07   walk-forward x4.64   kept (baseline)
L1 + size curve            LOO x3.53   walk-forward x2.98   kept
L2 + sector                LOO x3.45   walk-forward x2.56   kept
L3 + ensemble blend        LOO x3.33   walk-forward x2.72   dropped (combined miss worse than L2)
L4 + compressed growth+age LOO x3.20   walk-forward x2.48   kept (combined miss improves)
```

The two blind tests agree about growth and age this time — unlike in the #3 entry's ladder and in v6, L4 improves both tests over L2 (LOO x3.45 to x3.20, walk-forward x2.56 to x2.48). The grid re-picked the age shrink to 0.25 under the same combined-miss rule, with the sector shrinkage hardened to 8 pseudo-comps. The blend alone does not earn its place; the blend with the compressed terms does. The growth clamp was tied on the comps (0.2/0.4/0.6 score alike), so it takes the #3 entry's +-40%.

The bands hold 46/90 leave-one-out and 19/33 walk-forward. Rank ranges over 200 bootstrap refits of the comps: median width 36 ranks (v6: 37), P90 69, so the ordering is fragile and the page says so on every row. The two independent estimators agree within 3x on 84/90 comps and within 2x on 78/90; every row's detail view shows both numbers.

Farm economics, per row: slice = implied x 10% x $1,000/(TVL+$1,000) x hold/(ahead+hold), ahead = half the days with no token, the age capped at a year first (at most 182.5 days); fees = the funding fee plus every transaction's gas on the cheapest of the protocol's first three chains plus the play's percentage fees and carry — a vault needs 5 transactions in 90 days, perps 23 in 60 — all costed from the #3 entry's farm table, whose Ethereum allowance is $2.50 a transaction and whose L2s are $0.03 (v6 charged $8 and $0.50, which is what set its Skip count at 125); net = slice - fees - the 4% T-bill the ticket gives up over the hold (60 or 90 days by play); Farm when net > 0, Thin when the slice covers the fees, Skip below that. Verdicts 65 / 99 / 32 against the #3 entry's 66 / 88 / 38 on its own values; the median slice is $10.02 against median fees of $2.65. Best per hour: GoonFi +$18.46/h. No threshold was moved.

One fitted function scores every protocol; no name is special-cased. The dashboard states the formula, the sector effects, and the ladder, and recomputes each row from it, so the page's code and `board.json` visibly agree. Token odds come from a logistic regression on all 758 protocols and are shown as their own column, not multiplied in.

---

Entered on [make.fun](https://make.fun/?ref=4j22ejz5&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
