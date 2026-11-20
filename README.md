# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lively-wren-88-6565/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lively-wren-88-6565/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar of pre-token protocols from the DefiLlama protocol index (snapshot 2026-11-14), ranked by a value model fitted on the snapshot's traded tokens (category multiples blended with a log-log TVL curve, then growth, age and chains): 196 rows, all 40 watchlist protocols covered, each with a costed farm plan ending in a Farm / Thin / Skip verdict. The live-token protocols are set aside with their market caps shown, never mixed into the ranking. Implied value is a model, not a price and not a prediction of a launch.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Node 22.18 or later. `main.ts` reads the sealed snapshot, scores every rankable pre-token protocol, and writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. The run is deterministic: the same snapshot bytes always write the same output bytes. The dashboard in `dashboard/` renders offline from `data.js`; the three screenshots in `screenshots/` are the board, a protocol's detail view, and a filtered view.

## How implied value is computed

```
base     = exp( 0.5 x log(TVL x category multiple) + 0.5 x log(exp(6.965 + 0.522 x log(TVL))) )
implied  = round( base x growth x age x chains )
growth   = 1 + clamp(change_7d, -30, 60) / 100 x 0.5
age      = 0.70 + min(age_days, 1095) / 1095 x 0.30
chains   = 1 + 0.02 x min(chains - 1, 5)
multiple = median mcap/TVL per category where the category has 5+ traded comps,
           else the global median (0.214), clamped to [0.05, 1.00]
```

One fitted function scores every protocol; no name is special-cased. The dashboard states the formula, the fitted multiples, and the held-out test (fit on 103 comps, scored on 25 unseen: blend median |log error| 1.19, out-of-sample R² 0.14), and recomputes each row from it, so the page's code and `board.json` visibly agree. Token odds come from a logistic regression on all 758 protocols and are shown as their own column, not multiplied in.

---

Entered on [make.fun](https://make.fun/?ref=4j22ejz5&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
