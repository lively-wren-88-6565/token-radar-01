# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lively-wren-88-6565/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lively-wren-88-6565/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar of pre-token protocols from the DefiLlama protocol index (snapshot 2026-11-14), ranked by one model of TVL, 7-day growth, age, chains and category: 190 rows, all 40 watchlist protocols covered, wrapped/staked/bridged products excluded, each with a farm plan. The live-token protocols are set aside with their market caps shown, never mixed into the ranking. Implied value is a model, not a price and not a prediction of a launch.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Node 22.18 or later. `main.ts` reads the sealed snapshot, scores every rankable pre-token protocol, and writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. The run is deterministic: the same snapshot bytes always write the same output bytes. The dashboard in `dashboard/` renders offline from `data.js`; the three screenshots in `screenshots/` are the board, a protocol's detail view, and a filtered view.

## How implied value is computed

```
implied = round( tvl_usd x 0.25 x size x growth x maturity x chains x category )
size     = clamp( (1,000,000,000 / tvl_usd)^0.06, 0.75, 1.30 )
growth   = 1 + clamp(change_7d, -50, 150) / 100 x 0.7
maturity = 0.6 + min(age_days, 1095) / 1095 x 0.4
chains   = 1 + 0.03 x min(chains - 1, 4)
category = 1.15 accrual, 0.85 infrastructure, 1.00 other
```

One function scores every protocol; no name is special-cased. The dashboard states the formula and recomputes each row from it, so the page's code and `board.json` visibly agree.

---

Entered on [make.fun](https://make.fun/?ref=4j22ejz5&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
