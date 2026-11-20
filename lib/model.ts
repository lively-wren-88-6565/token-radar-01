// Token Radar model (radar-4): one sealed snapshot in, one ranked board out.
//
// The board ranks the 196 clean pre-token protocols in the snapshot: every
// protocol that records no token (mcap, gecko_id and symbol all null), whose
// category is not Bridge, Canonical Bridge, Cross Chain Bridge, Liquid
// Staking, Liquid Restaking, Restaked BTC or CEX, whose name carries no whole
// word wrapped, staked or staking, whose name does not end in a version
// marker, and whose name does not start with an exchange's name. That set
// includes all 40 watchlist slugs. One protocol the house's spaced version
// regex lets through, CommunityV3, is left out: its name ends in a glued
// version marker (V3 with no space), so this board treats a trailing V-digit
// marker as versioned too. Live-token protocols are kept apart and shown
// with their market cap, never mixed into the ranked board.
//
// Implied value is fitted from the traded comps in the same snapshot, the
// same function for every row, no protocol name ever special-cased:
//
//   comps       = traded protocols with TVL > 0 and mcap > 0 (n = 128)
//   log-log     = OLS of log(mcap) on log(TVL) over the comps
//                 log(mcap) = a + b * log(TVL);  R^2 is reported, not hidden
//   multiple    = median mcap/TVL per category where the category has
//                 >= 5 comps, else the global median multiple; clamped
//                 to [0.05, 1.00]
//   category    = TVL x multiple          (what the category usually trades at)
//   curve       = exp(a + b * log(TVL))    (what size alone predicts)
//   base        = exp(0.5 * log(category) + 0.5 * log(curve))
//                 the geometric mean of the two fitted estimators
//   growth      = 1 + clamp(change_7d, -30, 60) / 100 x 0.5
//   age         = 0.70 + 0.30 x min(age_days, 1095) / 1095
//                 age is days since DefiLlama first listed the protocol
//                 with no token on record; unknown age counts as 365 days
//   chains      = 1 + 0.02 x min(chains - 1, 5)
//   implied     = round(base x growth x age x chains)
//
// The fit is weak and the dashboard says so: the log-log R^2 is about 0.19,
// so an implied value is an order-of-magnitude read, not a price. The
// held-out test (deterministic 80/20 split of the comps by slug, fit on the
// 80%, scored on the 20%) is computed at build time and printed on the
// dashboard alongside the in-sample fit; no number there is hand-written.
//
// Token odds are a separate column, not multiplied into implied value:
// a logistic regression on all 758 protocols, outcome "records a token"
// (gecko_id, symbol or mcap set), features log10(TVL) and age in years.
// Older, larger protocols are more likely to record a token; the fitted
// coefficients and the AUC are printed on the dashboard, and the detail view
// shows implied x odds as the odds-adjusted value.
//
// Farm plans are costed, every row: each step states a dollar cost and a
// time, gas is priced by the chain the step runs on, capital is tiered by
// TVL, and the last step ends with a net verdict (Farm / Thin / Skip) from
// the implied value against the total gas the plan burns over four weeks:
// Farm at $25M implied or more, Thin at $5M-$25M, Skip below $5M, each
// downgraded one step when the plan burns more than $50 of gas and the
// implied value is under $100M. Capital is locked, not spent, and the
// verdict says so.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  blend_weight: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  multiple_floor: number;
  multiple_cap: number;
  min_category_n: number;
  farm_threshold_usd: number;
  thin_threshold_usd: number;
  gas_downgrade_usd: number;
}

export const MODEL: ModelConstants = {
  blend_weight: 0.5,
  growth_weight: 0.5,
  growth_floor: -30,
  growth_cap: 60,
  age_floor: 0.7,
  age_range: 0.3,
  age_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max_extra: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  min_category_n: 5,
  farm_threshold_usd: 25_000_000,
  thin_threshold_usd: 5_000_000,
  gas_downgrade_usd: 50,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One held-out method's score, computed at build time, never hand-written. */
export interface FitMethod {
  method: string;
  median_abs_log_error: number;
  mean_abs_log_error: number;
  oos_r2: number;
}

/** Everything fitted from the snapshot's traded comps. */
export interface FitResult {
  comps_n: number;
  loglog_intercept: number;
  loglog_slope: number;
  loglog_r2: number;
  global_median_multiple: number;
  category_multiples: { category: string; n: number; median: number }[];
  blend_weight: number;
  oos_train_n: number;
  oos_test_n: number;
  oos: FitMethod[];
  token_odds: {
    intercept: number;
    per_log10_tvl: number;
    per_age_year: number;
    auc: number;
    base_rate: number;
    young_rate: number;
    old_rate: number;
  };
}

/** The 758-protocol census: every protocol accounted for, none dropped silently. */
export interface Census {
  total: number;
  ranked: number;
  watchlist: number;
  watchlist_covered: number;
  traded_mcap: number;
  token_recorded_no_mcap: number;
  pretoken_excluded: number;
  excluded_by: { reason: string; n: number }[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_usd: number;
    curve_usd: number;
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    chain_multiplier: number;
    token_odds: number;
    odds_adjusted_usd: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  token_odds: number;
  category_multiple: number;
  base_usd: number;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A traded comp: the fitted model's anchor, shown with its actual market cap. */
export interface CompRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
  category_multiple: number;
  fitted_usd: number;
}

/** Everything the dashboard needs: the board, the live set, the comps, and the fit. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
  comps: CompRow[];
  fit: FitResult;
  census: Census;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Whole days from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The traded comps the model is fitted on: a token that trades, with TVL and mcap both positive. */
export function tradedComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** OLS of log(mcap) on log(TVL). */
export function fitLogLog(comps: SnapshotProtocol[]): { intercept: number; slope: number; r2: number } {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope, r2: (sxy * sxy) / (sxx * syy) };
}

/** Median mcap/TVL per category (n >= minN) plus the global median fallback. */
export function fitMultiples(
  comps: SnapshotProtocol[],
  minN: number,
): { global: number; per: Map<string, number>; counts: Map<string, number> } {
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const c = p.category ?? 'Other';
    const list = byCat.get(c) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCat.set(c, list);
  }
  const global = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  const per = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [c, v] of byCat) {
    counts.set(c, v.length);
    if (v.length >= minN) per.set(c, median(v));
  }
  return { global, per, counts };
}

/** One fit: the log-log curve and the category multiples, fitted on one list of comps. */
export interface CompFit {
  loglog: { intercept: number; slope: number; r2: number };
  multiples: { global: number; per: Map<string, number> };
}

export function fitComps(comps: SnapshotProtocol[], model: ModelConstants): CompFit {
  const m = fitMultiples(comps, model.min_category_n);
  return { loglog: fitLogLog(comps), multiples: { global: m.global, per: m.per } };
}

/** The fitted multiple for one category: its own median where n >= 5, else the global median. */
export function categoryMultiple(category: string | null, fit: CompFit, model: ModelConstants): number {
  const raw = fit.multiples.per.get(category ?? 'Other') ?? fit.multiples.global;
  return clamp(raw, model.multiple_floor, model.multiple_cap);
}

/** The two fitted TVL-only estimates and their geometric blend, for one protocol. */
export function fittedBase(
  protocol: SnapshotProtocol,
  fit: CompFit,
  model: ModelConstants,
): { categoryUsd: number; curveUsd: number; baseUsd: number; multiple: number } {
  const multiple = categoryMultiple(protocol.category, fit, model);
  const categoryUsd = protocol.tvl_usd * multiple;
  const curveUsd = Math.exp(fit.loglog.intercept + fit.loglog.slope * Math.log(protocol.tvl_usd));
  const w = model.blend_weight;
  const baseUsd = Math.exp(w * Math.log(categoryUsd) + (1 - w) * Math.log(curveUsd));
  return { categoryUsd, curveUsd, baseUsd, multiple };
}

/** The growth, age and chain multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompFit,
  model: ModelConstants,
): {
  implied: number;
  multiple: number;
  categoryUsd: number;
  curveUsd: number;
  baseUsd: number;
  growthPct: number;
  growthMult: number;
  ageMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const base = fittedBase(protocol, fit, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageMult =
    model.age_floor +
    (Math.min(Math.max(ageForModel, 0), model.age_days) / model.age_days) * model.age_range;
  const chainCount = Array.isArray(protocol.chains) ? protocol.chains.length : 0;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(chainCount - 1, 0), model.chain_max_extra);
  const implied = Math.max(1, Math.round(base.baseUsd * growthMult * ageMult * chainMult));
  return {
    implied,
    multiple: base.multiple,
    categoryUsd: base.categoryUsd,
    curveUsd: base.curveUsd,
    baseUsd: base.baseUsd,
    growthPct,
    growthMult,
    ageMult,
    chainMult,
    age,
  };
}

/**
 * Token odds: a logistic regression on all 758 protocols, outcome "records
 * a token" (gecko_id, symbol or mcap set), features log10(TVL) and age in
 * years (unknown age counts as 1 year). Deterministic gradient descent on
 * standardised features, 3000 steps; the returned coefficients are in raw
 * units, so odds = 1 / (1 + exp(-(b0 + b1*log10(TVL) + b2*age_years))).
 */
export function fitTokenOdds(snapshot: Snapshot): FitResult['token_odds'] {
  const rows = snapshot.protocols.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    return {
      y: p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null ? 1 : 0,
      x1: Math.log10(Math.max(1, p.tvl_usd)),
      x2: (age ?? 365) / 365,
      age,
    };
  });
  const n = rows.length;
  const m1 = rows.reduce((s, r) => s + r.x1, 0) / n;
  const m2 = rows.reduce((s, r) => s + r.x2, 0) / n;
  const s1 = Math.sqrt(rows.reduce((s, r) => s + (r.x1 - m1) ** 2, 0) / n);
  const s2 = Math.sqrt(rows.reduce((s, r) => s + (r.x2 - m2) ** 2, 0) / n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let it = 0; it < 3000; it++) {
    let g0 = 0;
    let g1 = 0;
    let g2 = 0;
    for (const r of rows) {
      const z1 = (r.x1 - m1) / s1;
      const z2 = (r.x2 - m2) / s2;
      const pr = 1 / (1 + Math.exp(-(b0 + b1 * z1 + b2 * z2)));
      const d = pr - r.y;
      g0 += d;
      g1 += d * z1;
      g2 += d * z2;
    }
    const lr = 0.1 / n;
    b0 -= lr * g0;
    b1 -= lr * g1;
    b2 -= lr * g2;
  }
  // Back to raw units: logit = b0 + b1*(x1-m1)/s1 + b2*(x2-m2)/s2.
  const intercept = b0 - (b1 * m1) / s1 - (b2 * m2) / s2;
  const perLog10Tvl = b1 / s1;
  const perAgeYear = b2 / s2;
  const oddsOf = (r: (typeof rows)[number]): number =>
    1 / (1 + Math.exp(-(intercept + perLog10Tvl * r.x1 + perAgeYear * r.x2)));
  // AUC by Mann-Whitney: every token pair against every no-token pair.
  const pos = rows.filter((r) => r.y === 1);
  const neg = rows.filter((r) => r.y === 0);
  let wins = 0;
  let ties = 0;
  for (const a of pos) {
    const pa = oddsOf(a);
    for (const b of neg) {
      const pb = oddsOf(b);
      if (pa > pb) wins++;
      else if (pa === pb) ties++;
    }
  }
  const auc = (wins + 0.5 * ties) / (pos.length * neg.length);
  const young = rows.filter((r) => (r.age ?? 365) < 180);
  const old = rows.filter((r) => (r.age ?? 0) >= 730);
  return {
    intercept,
    per_log10_tvl: perLog10Tvl,
    per_age_year: perAgeYear,
    auc,
    base_rate: pos.length / n,
    young_rate: young.length > 0 ? young.filter((r) => r.y === 1).length / young.length : 0,
    old_rate: old.length > 0 ? old.filter((r) => r.y === 1).length / old.length : 0,
  };
}

/** Token odds for one protocol under the fitted logistic. */
export function tokenOdds(
  protocol: SnapshotProtocol,
  asOf: string,
  odds: FitResult['token_odds'],
): number {
  const age = ageDays(asOf, protocol.listed_at);
  const x1 = Math.log10(Math.max(1, protocol.tvl_usd));
  const x2 = (age ?? 365) / 365;
  return 1 / (1 + Math.exp(-(odds.intercept + odds.per_log10_tvl * x1 + odds.per_age_year * x2)));
}

/**
 * The held-out test: comps sorted by slug, every 5th to the test set
 * (deterministic, no randomness), fit on the 80%, scored on the 20%.
 * Four predictors are scored the same way so the blend has to earn its place:
 * one global multiple, the log-log curve, the per-category multiple, and the
 * blend of the last two. Error is in log space: a median absolute log error
 * of 1.0 means the typical prediction is off by a factor of e^1.
 */
export function heldOutTest(
  comps: SnapshotProtocol[],
  model: ModelConstants,
): { trainN: number; testN: number; methods: FitMethod[] } {
  const sorted = [...comps].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const train = sorted.filter((_, i) => i % 5 !== 4);
  const test = sorted.filter((_, i) => i % 5 === 4);
  const fit = fitComps(train, model);
  const predict = (p: SnapshotProtocol, method: string): number => {
    if (method === 'global multiple') return p.tvl_usd * fit.multiples.global;
    if (method === 'log-log curve') return Math.exp(fit.loglog.intercept + fit.loglog.slope * Math.log(p.tvl_usd));
    const base = fittedBase(p, fit, model);
    if (method === 'category multiple') return base.categoryUsd;
    return base.baseUsd;
  };
  const methods: FitMethod[] = [];
  for (const method of ['global multiple', 'log-log curve', 'category multiple', 'blend']) {
    const errs = test.map((p) => Math.abs(Math.log(predict(p, method)) - Math.log(p.mcap_usd!)));
    const preds = test.map((p) => Math.log(predict(p, method)));
    const actual = test.map((p) => Math.log(p.mcap_usd!));
    const meanActual = actual.reduce((s, v) => s + v, 0) / actual.length;
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < actual.length; i++) {
      ssRes += (actual[i]! - preds[i]!) ** 2;
      ssTot += (actual[i]! - meanActual) ** 2;
    }
    methods.push({
      method,
      median_abs_log_error: median(errs),
      mean_abs_log_error: errs.reduce((s, v) => s + v, 0) / errs.length,
      oos_r2: 1 - ssRes / ssTot,
    });
  }
  return { trainN: train.length, testN: test.length, methods };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * DefiLlama's version-marker rule, plus a glued trailing V-digit marker:
 * the house pattern needs a space before V2, so CommunityV3 passes it, but
 * a name ending in V3 is a versioned product all the same, and this board
 * leaves it out. The watchlist is untouched by this: every watchlist slug
 * is ranked regardless (all 40 pass the clean rule either way).
 */
const VERSIONED = /(?:\s|^)(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$|V\d+(?:\.\d+)?$/;

/** Categories that are a wrapped, staked or bridged product, not a protocol of their own. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name that says the product is a wrapped or staked version of something else. */
const WRAPPED_NAME = /\b(wrapped|staked|staking)\b/i;

/** A name that starts with an exchange's name. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is one the board may rank: clean pre-token by the rule above. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !WRAPPED_NAME.test(p.name) &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_NAME.test(p.name)
  );
}

/** The first reason a pre-token protocol is left off the board, or null when it is rankable. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return null;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return `category ${p.category}`;
  if (WRAPPED_NAME.test(p.name)) return 'name carries wrapped / staked / staking';
  if (VERSIONED.test(p.name)) return 'name ends in a version marker';
  if (EXCHANGE_NAME.test(p.name)) return 'name starts with an exchange name';
  return null;
}

/** The 758-protocol census, computed from the snapshot. */
export function buildCensus(snapshot: Snapshot, ranked: number): Census {
  const tradedMcap = snapshot.protocols.filter((p) => p.mcap_usd !== null).length;
  const tokenRecordedNoMcap = snapshot.protocols.filter(
    (p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null),
  ).length;
  const excludedBy = new Map<string, number>();
  let pretokenExcluded = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const reason = exclusionReason(p);
    if (reason !== null) {
      pretokenExcluded++;
      excludedBy.set(reason, (excludedBy.get(reason) ?? 0) + 1);
    }
  }
  const watchlistCovered = snapshot.watchlist.filter((s) =>
    snapshot.protocols.some((p) => p.slug === s && isRankable(p)),
  ).length;
  return {
    total: snapshot.protocols.length,
    ranked,
    watchlist: snapshot.watchlist.length,
    watchlist_covered: watchlistCovered,
    traded_mcap: tradedMcap,
    token_recorded_no_mcap: tokenRecordedNoMcap,
    pretoken_excluded: pretokenExcluded,
    excluded_by: [...excludedBy.entries()]
      .map(([reason, n]) => ({ reason, n }))
      .sort((a, b) => b.n - a.n),
  };
}

/** Fit everything the dashboard reports, from the snapshot's comps. */
export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): { fit: FitResult; compFit: CompFit } {
  const comps = tradedComps(snapshot);
  const compFit = fitComps(comps, model);
  const multiples = fitMultiples(comps, model.min_category_n);
  const heldOut = heldOutTest(comps, model);
  const odds = fitTokenOdds(snapshot);
  const fit: FitResult = {
    comps_n: comps.length,
    loglog_intercept: compFit.loglog.intercept,
    loglog_slope: compFit.loglog.slope,
    loglog_r2: compFit.loglog.r2,
    global_median_multiple: multiples.global,
    category_multiples: [...multiples.per.entries()]
      .map(([category, medianValue]) => ({
        category,
        n: multiples.counts.get(category) ?? 0,
        median: medianValue,
      }))
      .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1)),
    blend_weight: model.blend_weight,
    oos_train_n: heldOut.trainN,
    oos_test_n: heldOut.testN,
    oos: heldOut.methods,
    token_odds: odds,
  };
  return { fit, compFit };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  compFit?: CompFit,
  odds?: FitResult['token_odds'],
): BoardRow[] {
  const fit = compFit ?? fitComps(tradedComps(snapshot), model);
  const oddsFit = odds ?? fitTokenOdds(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug in it is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other clean pre-token protocol, not just the top few by TVL.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    const o = tokenOdds(p, snapshot.as_of, oddsFit);
    return { p, ...v, odds: o };
  });
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.multiple),
      category_usd: Math.round(s.categoryUsd),
      curve_usd: Math.round(s.curveUsd),
      base_usd: Math.round(s.baseUsd),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      chain_multiplier: round4(s.chainMult),
      token_odds: round4(s.odds),
      odds_adjusted_usd: Math.round(s.implied * s.odds),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied, model).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * What one transaction typically costs on a chain, in whole US dollars:
 * Ethereum is the expensive one, the big L2s are cents, Solana is a cent.
 * These are the plan's own stated allowances, not a live quote, and the
 * dashboard says so.
 */
const GAS_USD: Record<string, number> = {
  Ethereum: 8,
  Bitcoin: 5,
  Solana: 0.01,
  Tron: 1,
  Bittensor: 1,
  Binance: 0.3,
  Polygon: 0.1,
  Avalanche: 0.5,
};
const L2_CHAINS = new Set([
  'Base', 'Arbitrum', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Blast',
  'Mode', 'Ink', 'Mantle', 'Unichain', 'Abstract', 'Berachain', 'Sonic',
  'Fraxtal', 'Gravity', 'Sei', 'Starknet', 'Polygon zkEVM', 'opBNB',
]);

export function gasUsd(chain: string): number {
  if (chain in GAS_USD) return GAS_USD[chain]!;
  if (L2_CHAINS.has(chain)) return 0.5;
  return 2;
}

/** A gas allowance as the plan states it: $8, $0.50, $0.01. */
export function gasText(gas: number): string {
  return gas >= 1 ? `$${gas}` : `$${gas.toFixed(2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the borrow side open.`;
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('liquidity manager'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction'))
    return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable') || c.includes('rwa'))
    return `Mint $${capital} of the protocol's yield asset through ${name} on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('aggregator'))
    return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and keep the shares.`;
  if (c.includes('payment') || c.includes('card'))
    return `Spend $${capital} through ${name}'s card or payment flow on ${chain} and keep the receipts.`;
  if (c.includes('governance') || c.includes('index'))
    return `Deposit $${capital} into ${name} on ${chain} and vote once with the position.`;
  if (c.includes('chain')) return `Use $${capital} of activity on ${name}'s chain through its own bridge or app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly action: volume, the thing most point systems count twice. */
function weeklyFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Swap $${Math.max(10, Math.round(capital / 5))} back and forth in ${name}'s main pool on ${chain} to build volume.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Borrow $${Math.max(10, Math.round(capital / 5))} against the deposit on ${name} and repay it the same week.`;
  if (c.includes('bridge'))
    return `Bridge $${Math.max(10, Math.round(capital / 5))} through ${name} again so the bridge counts a second week.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Close and reopen one small position on ${name} to keep weekly trading activity.`;
  if (c.includes('prediction')) return `Place one more market position on ${name} each week.`;
  if (c.includes('governance') || c.includes('index')) return `Vote once a week on ${name} with the position.`;
  return `Make one more qualifying action on ${name} each week, such as a deposit, a swap or a vote.`;
}

/** The net verdict for a plan: implied value against the gas the plan burns. */
export function farmVerdict(implied: number, gasTotal: number, model: ModelConstants): 'Farm' | 'Thin' | 'Skip' {
  let verdict: 'Farm' | 'Thin' | 'Skip' =
    implied >= model.farm_threshold_usd ? 'Farm' : implied >= model.thin_threshold_usd ? 'Thin' : 'Skip';
  if (gasTotal > model.gas_downgrade_usd && implied < 100_000_000) {
    verdict = verdict === 'Farm' ? 'Thin' : 'Skip';
  }
  return verdict;
}

/**
 * A protocol's farm plan: seven steps, each an action with a dollar cost
 * and a time, ending in a net verdict. The plan is derived from the
 * protocol's own record (category, chains, TVL, age) and its implied value,
 * never from a hand-written list of names.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  implied: number,
  model: ModelConstants = MODEL,
): FarmStep[] {
  const chain = chainOf(p);
  const gas1 = gasUsd(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const gas2 = secondChain !== null ? gasUsd(secondChain) : gas1;
  const gasTotal = Math.round((gas1 + gas1 * 4 + gas2 + gas1) * 100) / 100;
  const capitalTotal = secondChain !== null ? capital * 2 : capital;
  const verdict = farmVerdict(implied, gasTotal, model);
  const verdictWhy =
    verdict === 'Farm'
      ? `the $${Math.round(implied / 1e6)}M implied value is worth about ${gasText(gasTotal)} of gas and $${capitalTotal} locked for ${hold} days`
      : verdict === 'Thin'
        ? `the $${Math.round(implied / 1e6)}M implied value only just covers about ${gasText(gasTotal)} of gas and $${capitalTotal} locked for ${hold} days, so farm small and only on cheap gas`
        : `the $${Math.round(implied / 1e6)}M implied value does not cover about ${gasText(gasTotal)} of gas and $${capitalTotal} locked for ${hold} days`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: '$0, no transaction, only setup',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital, returned when you unwind, and about ${gasText(gas1)} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p, capital, chain),
      cost: `about ${gasText(gas1)} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text:
        secondChain !== null
          ? `Repeat the same position on ${secondChain} so the activity is counted on two chains, not one.`
          : `After two weeks, add a second position of the same size so the activity is counted twice.`,
      cost: `another $${capital} of capital, returned when you unwind, and about ${gasText(gas2)} of gas`,
      time: '15 minutes',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `$${capitalTotal} stays locked in the position, $0 out of pocket`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: `no fee to check, about ${gasText(gas1)} of gas only if you claim`,
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log. Verdict: ${verdict} — ${verdictWhy}.`,
      cost: '$0 to log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The traded comps, by market cap, for the dashboard's Comps view. */
export function compRows(snapshot: Snapshot, compFit: CompFit, model: ModelConstants): CompRow[] {
  return tradedComps(snapshot)
    .map((p) => {
      const base = fittedBase(p, compFit, model);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        change_7d: p.change_7d,
        ratio: p.mcap_usd! / p.tvl_usd,
        category_multiple: round4(base.multiple),
        fitted_usd: Math.round(base.baseUsd),
      };
    })
    .sort((a, b) => b.mcap_usd - a.mcap_usd || b.tvl_usd - a.tvl_usd);
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    token_odds: row.model.token_odds,
    category_multiple: row.model.category_multiple,
    base_usd: row.model.base_usd,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { fit, compFit } = fitModel(snapshot, model);
  const board = buildBoard(snapshot, model, compFit, fit.token_odds);
  const live = liveRows(snapshot);
  const comps = compRows(snapshot, compFit, model);
  const census = buildCensus(snapshot, board.length);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const totalImplied = board.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: totalImplied,
    rows: board.map(radarRow),
    live,
    comps,
    fit,
    census,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
