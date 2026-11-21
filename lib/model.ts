// Token Radar model (radar-6): one sealed snapshot in, one ranked board out.
//
// What changed from radar-5, and why (see the leader study in
// ~/workspace/make-fun/leader-study-2026-11-21.md; the numbers below are all
// computed at build time from this snapshot, never hand-written):
//
//   1. Pricing is a concave robust curve, not a linear multiple. Radar-5
//      priced Steakhouse Financial at $146.6M; the #3 entry (sudhan,
//      Theil-Sen curve, slope 0.477) priced it at $31.8M, and a linear
//      multiple got another entry ranked #13,707. The value is now the
//      Theil-Sen fit of log(mcap) on log(TVL) over cleaned comps, plus a
//      shrunken sector effect. A blind-test ladder (leave-one-out and
//      old-to-new walk-forward) tests every term — flat multiple, size
//      curve, sector, growth+age — and a term is kept only when it lowers
//      the miss on BOTH tests. Growth and age are shown whether kept or
//      not; the dashboard names the kept level.
//   2. Comps are cleaned, one per ticker: house categories (Bridge,
//      Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC,
//      CEX) and receipt tokens (|mcap/TVL - 1| < 1.5%) are out, and
//      listings sharing a ticker and a name stem are merged into one
//      family with TVL summed. 128 traded tokens become 90 comps.
//   3. Every row carries a P25-P75 interval from the leave-one-out
//      residuals (young rows <540 days get their own, wider band) with
//      the held-out hit rates printed on the page, and a rank range over
//      200 bootstrap refits of the comps.
//   4. Farm economics are a fixed $1,000 ticket and a 10% airdrop share,
//      sliced by dollar-days, net of gas and of the 4% T-bill the ticket
//      gives up, with a break-even ticket and a $/hour figure. The
//      verdict is computed from those dollars: Farm when net > 0, Thin
//      when the slice covers gas but not the T-bill cost, Watch when it
//      covers a quarter of gas, Skip below that.
//
// The board still ranks the 196 clean pre-token protocols (the v4 clean
// rule is unchanged: no wrapped/staked/bridged product, no versioned
// name, no exchange name), all 40 watchlist slugs covered. Token odds
// stay a separate column, not multiplied into implied value: the detail
// view shows implied x odds as the odds-adjusted value.
//
// The run is deterministic: the same snapshot bytes always write the same
// output bytes. No network, no clock, no randomness except a fixed-seed
// bootstrap (seed 20261121), which is deterministic too.

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
  ticket_usd: number;
  airdrop_share: number;
  tbill_rate: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_days: number;
  unknown_age_days: number;
  sector_shrink_pseudo: number;
  young_days: number;
  walkforward_cut_days: number;
  bootstrap_refits: number;
  bootstrap_seed: number;
  watch_slice_fraction: number;
}

export const MODEL: ModelConstants = {
  ticket_usd: 1000,
  airdrop_share: 0.1,
  tbill_rate: 0.04,
  growth_weight: 0.5,
  growth_floor: -30,
  growth_cap: 60,
  age_floor: 0.7,
  age_range: 0.3,
  age_days: 1095,
  unknown_age_days: 365,
  sector_shrink_pseudo: 4,
  young_days: 540,
  walkforward_cut_days: 900,
  bootstrap_refits: 200,
  bootstrap_seed: 20261121,
  watch_slice_fraction: 0.25,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-6';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One rung of the blind-test ladder. Miss is reported in x units (exp of the median |log error|), and in log units beside it. */
export interface LadderLevel {
  level: string;
  label: string;
  loo_miss_x: number;
  loo_miss_log: number;
  loo_within3: number;
  loo_n: number;
  wf_miss_x: number;
  wf_miss_log: number;
  wf_within3: number;
  wf_train_n: number;
  wf_test_n: number;
  kept: boolean;
}

/** One sector's shrunken effect on log value. */
export interface SectorEffect {
  sector: string;
  n: number;
  effect_log: number;
  raw_median_log: number;
}

/** The P25-P75 bands from the leave-one-out residuals, split young/old, and their held-out hit rates. */
export interface IntervalStats {
  young_lo_factor: number;
  young_hi_factor: number;
  old_lo_factor: number;
  old_hi_factor: number;
  loo_hit_young: number;
  loo_n_young: number;
  loo_hit_old: number;
  loo_n_old: number;
  loo_hit_all: number;
  loo_n_all: number;
  wf_hit: number;
  wf_n: number;
}

/** The 200-refit stability summary. */
export interface RefitStats {
  refits: number;
  median_rank_width: number;
  p90_rank_width: number;
  rows_with_width_le_10: number;
}

/** The Theil-Sen size curve, fitted on the cleaned comps. */
export interface CurveFit {
  intercept: number;
  slope: number;
  r2: number;
  global_median_multiple: number;
  sector_effects: SectorEffect[];
  final_r2: number;
}

/** Everything fitted from the snapshot's traded comps. */
export interface FitResult {
  traded_n: number;
  house_excluded: number;
  receipt_excluded: number;
  families_merged: number;
  comps_n: number;
  curve: CurveFit;
  ladder: LadderLevel[];
  final_level: string;
  intervals: IntervalStats;
  refits: RefitStats;
  best_per_hour: { slug: string; name: string; per_hour_usd: number; verdict: string };
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
    sector: string;
    play: string;
    curve_usd: number;
    sector_usd: number;
    base_usd: number;
    growth_multiplier: number;
    age_multiplier: number;
    token_odds: number;
    odds_adjusted_usd: number;
    low_usd: number;
    high_usd: number;
    rank_lo: number;
    rank_hi: number;
    comps: string[];
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
  sector: string;
  play: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  token_odds: number;
  low_usd: number;
  high_usd: number;
  rank_lo: number;
  rank_hi: number;
  comps: string[];
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
  sector: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
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

/** A quantile of a list by linear interpolation (p in [0, 1]). */
export function quantile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0]!;
  const pos = p * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Whole days from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A seeded PRNG (mulberry32): the 200-refit bootstrap is deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Sectors and farm plays
// ---------------------------------------------------------------------------

/** The six sectors the ~40 DefiLlama categories fold into (sudhan's grouping). */
const SECTOR_OF: Record<string, string> = {
  Dexs: 'Trading',
  Derivatives: 'Trading',
  'Basis Trading': 'Trading',
  Options: 'Trading',
  'Prediction Market': 'Trading',
  Synthetics: 'Trading',
  Lending: 'Lending',
  CDP: 'Lending',
  'CDP Manager': 'Lending',
  'Uncollateralized Lending': 'Lending',
  'Collateral Management': 'Lending',
  'Collateral Markets': 'Lending',
  'Interest Rate Derivatives': 'Lending',
  Yield: 'Vaults',
  'Yield Aggregator': 'Vaults',
  Farm: 'Vaults',
  'Risk Curators': 'Vaults',
  'Onchain Capital Allocator': 'Vaults',
  'Liquidity Manager': 'Vaults',
  'Leveraged Farming': 'Vaults',
  Indexes: 'Vaults',
  'Options Vault': 'Vaults',
  'Staking Pool': 'Vaults',
  Restaking: 'Vaults',
  'Algo-Stables': 'Dollars',
  'Stablecoin Issuer': 'Dollars',
  'Dual-Token Stablecoin': 'Dollars',
  'Stablecoin Wrapper': 'Dollars',
  'Decentralized BTC': 'Dollars',
  'Anchor BTC': 'Dollars',
  'Reserve Currency': 'Dollars',
  RWA: 'RWA',
  'Token Locker': 'RWA',
  CeDeFi: 'RWA',
  Chain: 'Network',
  'Decentralized AI': 'Network',
  'AI Agents': 'Network',
  Privacy: 'Network',
  Payments: 'Network',
  'Crypto Card Issuer': 'Network',
  Insurance: 'Network',
  'Governance Incentives': 'Network',
  Launchpad: 'Network',
  'NFT Marketplace': 'Network',
  'OTC Marketplace': 'Network',
  DOR: 'Network',
};

/** A category's sector: the table above, Network for anything unlisted. */
export function sectorOf(category: string | null): string {
  if (category === null) return 'Network';
  return SECTOR_OF[category] ?? 'Network';
}

/** One mechanised farm play: how long the position must be held, in days. */
export interface PlayDef {
  play: string;
  hold_days: number;
}

/** The ten plays, keyed by category group. Hold is 90 days for the slow
 *  plays (vaults, lending, RWA) and 60 for the fast ones. */
const PLAY_OF: Record<string, PlayDef> = {
  vault: { play: 'vault', hold_days: 90 },
  lend: { play: 'lend', hold_days: 90 },
  dollar: { play: 'dollar', hold_days: 60 },
  rwa: { play: 'rwa', hold_days: 90 },
  pool: { play: 'pool', hold_days: 60 },
  perps: { play: 'perps', hold_days: 60 },
  market: { play: 'market', hold_days: 60 },
  stake: { play: 'stake', hold_days: 90 },
  network: { play: 'network', hold_days: 60 },
  pay: { play: 'pay', hold_days: 60 },
};

/** A category's play, from its name: vaults, lending, dollars, RWA, pools,
 *  perps, prediction markets, staking, chains, payments — anything else
 *  farms as a plain deposit (the 'pool' play, 60 days). */
export function playOf(category: string | null): PlayDef {
  const c = (category ?? '').toLowerCase();
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('farm') || c.includes('liquidity manager') || c.includes('leveraged farm') || c.includes('index') || c.includes('options vault') || c.includes('staking') || c.includes('restak'))
    return PLAY_OF.vault!;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized') || c.includes('interest rate'))
    return PLAY_OF.lend!;
  if (c.includes('stable') || c.includes('decentralized btc') || c.includes('anchor btc') || c.includes('reserve currency'))
    return PLAY_OF.dollar!;
  if (c.includes('rwa') || c.includes('token locker') || c.includes('cedefi')) return PLAY_OF.rwa!;
  if (c.includes('dex')) return PLAY_OF.pool!;
  if (c.includes('derivative') || c.includes('basis trading') || c.includes('options') || c.includes('synthetic'))
    return PLAY_OF.perps!;
  if (c.includes('prediction')) return PLAY_OF.market!;
  if (c.includes('chain') || c.includes('ai') || c.includes('privacy')) return PLAY_OF.network!;
  if (c.includes('payment') || c.includes('card') || c.includes('insurance') || c.includes('governance') || c.includes('launchpad') || c.includes('marketplace') || c.includes('dor'))
    return PLAY_OF.pay!;
  return PLAY_OF.pool!;
}

// ---------------------------------------------------------------------------
// Comps: traded tokens, cleaned one per ticker
// ---------------------------------------------------------------------------

/** A cleaned comp: one traded token (or one merged family) the curve is fitted on. */
export interface CleanComp {
  slug: string;
  name: string;
  category: string | null;
  sector: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
}

/** Categories that are a wrapped, staked or bridged product, not a protocol
 *  of their own — the house list sudhan's comps use. Cross Chain Bridge
 *  is not in it, so its traded tokens stay comps. */
const HOUSE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** The first alphanumeric word of a name, lower-cased: the family stem. */
function nameStem(name: string): string {
  const m = name.toLowerCase().match(/[a-z0-9]+/);
  return m === null ? '' : m[0]!;
}

/**
 * The traded comps the model is fitted on: a token that trades, with TVL
 * and mcap both positive, minus house categories, minus receipt tokens
 * (|mcap/TVL - 1| < 1.5%: a deposit receipt, not a priced token), with
 * listings that share a ticker AND a name stem merged into one family
 * (TVL and mcap summed, earliest listing kept). On this snapshot:
 * 128 traded -> 34 house -> 4 receipt -> 90 comps, 0 family merges
 * (the only shared ticker, BIFI, splits on stem: Beefy vs BiFi).
 */
export function cleanComps(snapshot: Snapshot): {
  comps: CleanComp[];
  traded_n: number;
  house_excluded: number;
  receipt_excluded: number;
  families_merged: number;
} {
  const traded = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  let houseExcluded = 0;
  let receiptExcluded = 0;
  const kept: SnapshotProtocol[] = [];
  for (const p of traded) {
    if (HOUSE_CATEGORIES.has(p.category ?? '')) {
      houseExcluded++;
      continue;
    }
    if (Math.abs(p.mcap_usd! / p.tvl_usd - 1) < 0.015) {
      receiptExcluded++;
      continue;
    }
    kept.push(p);
  }
  const families = new Map<string, SnapshotProtocol[]>();
  for (const p of kept) {
    const key = `${(p.symbol ?? '').toUpperCase()}|${nameStem(p.name)}`;
    const list = families.get(key) ?? [];
    list.push(p);
    families.set(key, list);
  }
  let merged = 0;
  const comps: CleanComp[] = [];
  for (const list of families.values()) {
    if (list.length > 1) merged += list.length - 1;
    const first = list[0]!;
    const listed = list.map((p) => p.listed_at).filter((d): d is string => d !== null).sort();
    comps.push({
      slug: first.slug,
      name: first.name,
      category: first.category,
      sector: sectorOf(first.category),
      chains: first.chains,
      tvl_usd: list.reduce((s, p) => s + p.tvl_usd, 0),
      mcap_usd: list.reduce((s, p) => s + p.mcap_usd!, 0),
      change_7d: first.change_7d,
      listed_at: listed.length > 0 ? listed[0]! : null,
      age_days: ageDays(snapshot.as_of, listed.length > 0 ? listed[0]! : null),
    });
  }
  comps.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { comps, traded_n: traded.length, house_excluded: houseExcluded, receipt_excluded: receiptExcluded, families_merged: merged };
}

/** The traded comps the model is fitted on (uncleaned count, for reference). */
export function tradedComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The concave fit: Theil-Sen log-log curve + shrunken sector effects
// ---------------------------------------------------------------------------

/** A fitted curve on one list of comps: Theil-Sen slope/intercept plus sector effects. */
export interface CurveModel {
  intercept: number;
  slope: number;
  sector_effects: Map<string, number>;
  global_median_multiple: number;
}

/** Theil-Sen fit of log(mcap) on log(TVL): the slope is the median pairwise
 *  slope, so one 400x outlier cannot drag the curve (an OLS fit can). */
export function fitTheilSen(comps: CleanComp[]): { intercept: number; slope: number; r2: number } {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd));
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const dx = xs[j]! - xs[i]!;
      if (Math.abs(dx) > 1e-12) slopes.push((ys[j]! - ys[i]!) / dx);
    }
  }
  const slope = median(slopes);
  const intercept = median(ys.map((y, i) => y - slope * xs[i]!));
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < ys.length; i++) {
    const pred = intercept + slope * xs[i]!;
    ssRes += (ys[i]! - pred) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  }
  return { intercept, slope, r2: 1 - ssRes / ssTot };
}

/** Sector effects from the curve's residuals: the median log residual per
 *  sector, shrunk toward zero by n/(n+4) pseudo-comps, so a sector with
 *  one comp cannot set its own price. */
export function fitSectorEffects(
  comps: CleanComp[],
  intercept: number,
  slope: number,
  shrinkPseudo: number,
): SectorEffect[] {
  const bySector = new Map<string, number[]>();
  const raw = new Map<string, number>();
  for (const p of comps) {
    const r = Math.log(p.mcap_usd) - (intercept + slope * Math.log(p.tvl_usd));
    const list = bySector.get(p.sector) ?? [];
    list.push(r);
    bySector.set(p.sector, list);
  }
  const effects: SectorEffect[] = [];
  for (const [sector, rs] of bySector) {
    const med = median(rs);
    raw.set(sector, med);
    effects.push({
      sector,
      n: rs.length,
      effect_log: (rs.length / (rs.length + shrinkPseudo)) * med,
      raw_median_log: med,
    });
  }
  return effects.sort((a, b) => b.effect_log - a.effect_log);
}

/** Fit the curve and its sector effects on one list of comps. */
export function fitCurve(comps: CleanComp[], model: ModelConstants): CurveModel {
  const ts = fitTheilSen(comps);
  const effects = fitSectorEffects(comps, ts.intercept, ts.slope, model.sector_shrink_pseudo);
  const map = new Map(effects.map((e) => [e.sector, e.effect_log]));
  return {
    intercept: ts.intercept,
    slope: ts.slope,
    sector_effects: map,
    global_median_multiple: median(comps.map((p) => p.mcap_usd / p.tvl_usd)),
  };
}

/** The growth and age multipliers (radar-4's shapes), for the L3 rung. */
export function growthAgeMultipliers(
  change7d: number | null,
  age: number | null,
  model: ModelConstants,
): { growth: number; ageMult: number } {
  const growthPct = clamp(finite(change7d, 0), model.growth_floor, model.growth_cap);
  const growth = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageMult =
    model.age_floor +
    (Math.min(Math.max(ageForModel, 0), model.age_days) / model.age_days) * model.age_range;
  return { growth, ageMult };
}

/**
 * One rung's log prediction for a protocol (or a comp) under a fitted curve.
 * L0 flat multiple, L1 size curve, L2 + sector, L3 + growth and age.
 */
export function levelLogPredict(
  level: string,
  tvl: number,
  sector: string,
  change7d: number | null,
  age: number | null,
  curve: CurveModel,
  model: ModelConstants,
): number {
  if (level === 'L0') return Math.log(tvl * curve.global_median_multiple);
  let log = curve.intercept + curve.slope * Math.log(tvl);
  if (level === 'L1') return log;
  log += curve.sector_effects.get(sector) ?? 0;
  if (level === 'L2') return log;
  const { growth, ageMult } = growthAgeMultipliers(change7d, age, model);
  return log + Math.log(growth) + Math.log(ageMult);
}

/** Score one rung's predictions against actual log mcaps: median |log error|, x miss, within-3x share. */
function scorePredictions(preds: number[], actuals: number[]): { miss_log: number; miss_x: number; within3: number } {
  const errs = preds.map((p, i) => Math.abs(p - actuals[i]!));
  const med = median(errs);
  return {
    miss_log: med,
    miss_x: Math.exp(med),
    within3: errs.filter((e) => Math.exp(e) <= 3).length,
  };
}

const LADDER_DEFS = [
  { level: 'L0', label: 'flat multiple (median mcap/TVL)' },
  { level: 'L1', label: '+ size curve (Theil-Sen log-log)' },
  { level: 'L2', label: '+ sector effect (shrunk)' },
  { level: 'L3', label: '+ growth and age' },
];

/**
 * The blind-test ladder: every rung is scored two ways — leave-one-out
 * (refit on the other n-1 comps, predict the held-out one) and
 * walk-forward (fit on listings 900+ days old, test on newer ones;
 * comps with no listing date sit on the training side, never known-new).
 * A rung is kept
 * only when it lowers the miss on BOTH tests against the last kept rung.
 * The LOO residuals of the final (kept) rung feed the interval bands.
 */
export function fitLadder(
  comps: CleanComp[],
  model: ModelConstants,
): {
  ladder: LadderLevel[];
  final_level: string;
  loo_residuals: { age_days: number | null; resid: number }[];
  wf_predictions: { age_days: number | null; pred_log: number; actual_log: number }[];
} {
  // Leave-one-out.
  const looPreds: Record<string, number[]> = { L0: [], L1: [], L2: [], L3: [] };
  const looActual: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const curve = fitCurve(train, model);
    const held = comps[i]!;
    looActual.push(Math.log(held.mcap_usd));
    for (const d of LADDER_DEFS) {
      looPreds[d.level]!.push(levelLogPredict(d.level, held.tvl_usd, held.sector, held.change_7d, held.age_days, curve, model));
    }
  }
  // Walk-forward: old listings fit, new listings test. Comps with no
  // listing date sit on the training side: they are never known-new, and
  // this reproduces sudhan's 57/33 split on the same 90 comps.
  const cut = model.walkforward_cut_days;
  const wfTrain = comps.filter((p) => p.age_days === null || p.age_days >= cut);
  const wfTest = comps.filter((p) => p.age_days !== null && p.age_days < cut);
  const wfCurve = fitCurve(wfTrain, model);
  const wfPreds: Record<string, number[]> = { L0: [], L1: [], L2: [], L3: [] };
  const wfActual: number[] = [];
  for (const p of wfTest) {
    wfActual.push(Math.log(p.mcap_usd));
    for (const d of LADDER_DEFS) {
      wfPreds[d.level]!.push(levelLogPredict(d.level, p.tvl_usd, p.sector, p.change_7d, p.age_days, wfCurve, model));
    }
  }
  // Keep rule: a rung stays only if it beats the last kept rung on both tests.
  const ladder: LadderLevel[] = [];
  let lastKept = 'L0';
  let lastLoo = Infinity;
  let lastWf = Infinity;
  for (const d of LADDER_DEFS) {
    const loo = scorePredictions(looPreds[d.level]!, looActual);
    const wf = scorePredictions(wfPreds[d.level]!, wfActual);
    let kept: boolean;
    if (d.level === 'L0') {
      kept = true;
    } else {
      kept = loo.miss_log < lastLoo && wf.miss_log < lastWf;
    }
    if (kept) {
      lastKept = d.level;
      lastLoo = loo.miss_log;
      lastWf = wf.miss_log;
    }
    ladder.push({
      level: d.level,
      label: d.label,
      loo_miss_x: round4(loo.miss_x),
      loo_miss_log: round4(loo.miss_log),
      loo_within3: loo.within3,
      loo_n: comps.length,
      wf_miss_x: round4(wf.miss_x),
      wf_miss_log: round4(wf.miss_log),
      wf_within3: wf.within3,
      wf_train_n: wfTrain.length,
      wf_test_n: wfTest.length,
      kept,
    });
  }
  const loo_residuals = comps.map((p, i) => ({
    age_days: p.age_days,
    resid: looPreds[lastKept]![i]! - Math.log(p.mcap_usd),
  }));
  const wf_predictions = wfTest.map((p, i) => ({
    age_days: p.age_days,
    pred_log: wfPreds[lastKept]![i]!,
    actual_log: Math.log(p.mcap_usd),
  }));
  return { ladder, final_level: lastKept, loo_residuals, wf_predictions };
}

/** The interval bands from the final rung's LOO residuals, split young/old,
 *  and their held-out hit rates (LOO per group, and walk-forward). */
export function fitIntervals(
  looResiduals: { age_days: number | null; resid: number }[],
  wfPredictions: { age_days: number | null; pred_log: number; actual_log: number }[],
  model: ModelConstants,
): IntervalStats {
  const young = looResiduals.filter((r) => (r.age_days ?? 1e9) < model.young_days).map((r) => r.resid);
  const old = looResiduals.filter((r) => (r.age_days ?? 1e9) >= model.young_days).map((r) => r.resid);
  // resid = log(pred) - log(actual), so actual/pred = exp(-resid): the
  // P25-P75 band of actual/pred is [exp(-q75), exp(-q25)].
  const youngLo = Math.exp(-quantile(young, 0.75));
  const youngHi = Math.exp(-quantile(young, 0.25));
  const oldLo = Math.exp(-quantile(old, 0.75));
  const oldHi = Math.exp(-quantile(old, 0.25));
  const hit = (pred: number, actual: number, age: number | null): boolean => {
    const lo = (age ?? 1e9) < model.young_days ? youngLo : oldLo;
    const hi = (age ?? 1e9) < model.young_days ? youngHi : oldHi;
    return actual >= pred + Math.log(lo) && actual <= pred + Math.log(hi);
  };
  let hitYoung = 0;
  let hitOld = 0;
  for (const r of looResiduals) {
    const isYoung = (r.age_days ?? 1e9) < model.young_days;
    const lo = isYoung ? youngLo : oldLo;
    const hi = isYoung ? youngHi : oldHi;
    // resid = pred - actual, so actual in band iff -resid in [log lo, log hi].
    if (-r.resid >= Math.log(lo) && -r.resid <= Math.log(hi)) {
      if (isYoung) hitYoung++;
      else hitOld++;
    }
  }
  let wfHit = 0;
  for (const w of wfPredictions) {
    if (hit(w.pred_log, w.actual_log, w.age_days)) wfHit++;
  }
  return {
    young_lo_factor: round4(youngLo),
    young_hi_factor: round4(youngHi),
    old_lo_factor: round4(oldLo),
    old_hi_factor: round4(oldHi),
    loo_hit_young: hitYoung,
    loo_n_young: young.length,
    loo_hit_old: hitOld,
    loo_n_old: old.length,
    loo_hit_all: hitYoung + hitOld,
    loo_n_all: looResiduals.length,
    wf_hit: wfHit,
    wf_n: wfPredictions.length,
  };
}

// ---------------------------------------------------------------------------
// Token odds (unchanged from radar-5: a separate column, not multiplied in)
// ---------------------------------------------------------------------------

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
  const intercept = b0 - (b1 * m1) / s1 - (b2 * m2) / s2;
  const perLog10Tvl = b1 / s1;
  const perAgeYear = b2 / s2;
  const oddsOf = (r: (typeof rows)[number]): number =>
    1 / (1 + Math.exp(-(intercept + perLog10Tvl * r.x1 + perAgeYear * r.x2)));
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

// ---------------------------------------------------------------------------
// Implied value, intervals, named comps
// ---------------------------------------------------------------------------

/** The fitted value of one protocol: the curve, the sector step, and the
 *  growth/age step only when the ladder kept L3. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  curve: CurveModel,
  finalLevel: string,
  model: ModelConstants,
): {
  implied: number;
  sector: string;
  curveUsd: number;
  sectorUsd: number;
  baseUsd: number;
  growthMult: number;
  ageMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const sector = sectorOf(protocol.category);
  const curveUsd = Math.exp(curve.intercept + curve.slope * Math.log(protocol.tvl_usd));
  const sectorUsd = curveUsd * Math.exp(curve.sector_effects.get(sector) ?? 0);
  let baseUsd = sectorUsd;
  let growthMult = 1;
  let ageMult = 1;
  if (finalLevel === 'L3') {
    const g = growthAgeMultipliers(protocol.change_7d, age, model);
    growthMult = g.growth;
    ageMult = g.ageMult;
    baseUsd = sectorUsd * growthMult * ageMult;
  } else if (finalLevel === 'L0') {
    baseUsd = protocol.tvl_usd * curve.global_median_multiple;
  } else if (finalLevel === 'L1') {
    baseUsd = curveUsd;
  }
  const implied = Math.max(1, Math.round(baseUsd));
  return { implied, sector, curveUsd, sectorUsd, baseUsd, growthMult, ageMult, age };
}

/** A row's low/high from its age group's P10-P90 factors. */
export function intervalFor(
  implied: number,
  age: number | null,
  intervals: IntervalStats,
  model: ModelConstants,
): { low: number; high: number } {
  const young = (age ?? 1e9) < model.young_days;
  const lo = young ? intervals.young_lo_factor : intervals.old_lo_factor;
  const hi = young ? intervals.young_hi_factor : intervals.old_hi_factor;
  return { low: Math.max(1, Math.round(implied * lo)), high: Math.max(1, Math.round(implied * hi)) };
}

/** The three nearest traded comps in the row's sector (by |log TVL|), filled
 *  from the nearest comps overall when the sector holds fewer than three. */
export function nearestComps(
  sector: string,
  tvl: number,
  comps: CleanComp[],
): string[] {
  const byDist = (list: CleanComp[]): CleanComp[] =>
    [...list].sort(
      (a, b) =>
        Math.abs(Math.log(a.tvl_usd) - Math.log(tvl)) - Math.abs(Math.log(b.tvl_usd) - Math.log(tvl)) ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
  const picked: string[] = [];
  for (const p of byDist(comps.filter((c) => c.sector === sector))) {
    if (picked.length >= 3) break;
    picked.push(p.slug);
  }
  if (picked.length < 3) {
    for (const p of byDist(comps)) {
      if (picked.length >= 3) break;
      if (!picked.includes(p.slug)) picked.push(p.slug);
    }
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Farm economics: a fixed $1,000 ticket, dollar-days, T-bill cost
// ---------------------------------------------------------------------------

/** What one transaction typically costs on a chain, in whole US dollars.
 *  These are the plan's own stated allowances, not a live quote, and the
 *  dashboard says so. */
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

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The cheapest of a protocol's first three chains: the farm runs there. */
export function cheapestChain(p: SnapshotProtocol): { chain: string; gas: number } {
  const chains = p.chains.length > 0 ? p.chains.slice(0, 3) : ['its main chain'];
  let best = chains[0]!;
  let bestGas = gasUsd(best);
  for (const c of chains) {
    const g = gasUsd(c);
    if (g < bestGas) {
      best = c;
      bestGas = g;
    }
  }
  return { chain: best, gas: bestGas };
}

/** The four farm tiers, in order: Farm, Thin, Watch, Skip. */
export type FarmVerdict = 'Farm' | 'Thin' | 'Watch' | 'Skip';

/** A row's farm economics on a ticket: slice, gas, T-bill, net, break-even, $/hour. */
export interface FarmEcon {
  ticket: number;
  share: number;
  hold_days: number;
  ahead_days: number;
  weeks: number;
  minutes: number;
  chain: string;
  gas_each: number;
  gas_total: number;
  slice_usd: number;
  tbill_usd: number;
  net_usd: number;
  breakeven_ticket: number | null;
  per_hour_usd: number;
  verdict: FarmVerdict;
}

/**
 * The farm economics for one protocol on one ticket (default $1,000, 10%
 * share). The slice is the protocol's implied value times the airdrop
 * share, times the ticket's share of the pool, times the hold's share of
 * the dollar-days window: slice = implied x share x C/(TVL+C) x
 * H/(ahead+H), where ahead is half the days the protocol has run with no
 * token (capped at 365). Gas is one transaction a week plus entry and
 * claim, on the cheapest of the protocol's first three chains. The
 * T-bill cost is what the ticket would have earned at 4% over the hold.
 * Break-even is the smallest ticket whose slice covers gas plus its own
 * T-bill cost, found by bisection; null when no ticket breaks even
 * (the slice saturates below gas). Minutes are 15 to fund, 10 to verify,
 * 15 to enter, 10 a week to upkeep, 5 a week to check the stop rule, 10
 * to claim and 5 to log.
 */
export function farmEcon(
  p: SnapshotProtocol,
  age: number | null,
  implied: number,
  model: ModelConstants = MODEL,
  ticket: number = MODEL.ticket_usd,
  share: number = MODEL.airdrop_share,
): FarmEcon {
  const play = playOf(p.category);
  const hold = play.hold_days;
  const ahead = Math.min((age ?? model.unknown_age_days) / 2, 365);
  const weeks = Math.ceil(hold / 7);
  const minutes = 65 + 15 * weeks;
  const { chain, gas } = cheapestChain(p);
  const gasTotal = Math.round((weeks + 2) * gas * 100) / 100;
  const slice = (implied * share * ticket) / (p.tvl_usd + ticket) * (hold / (ahead + hold));
  const tbill = ticket * model.tbill_rate * (hold / 365);
  const net = slice - gasTotal - tbill;
  // Break-even: K*C/(TVL+C) = r*C + gas, with K = implied*share*H/(ahead+H)
  // and r = tbill_rate*H/365. The net peaks at C* = sqrt(K*TVL/r) - TVL.
  const K = implied * share * (hold / (ahead + hold));
  const r = model.tbill_rate * (hold / 365);
  let breakeven: number | null = null;
  const cStar = Math.sqrt((K * p.tvl_usd) / r) - p.tvl_usd;
  if (cStar > 0) {
    const f = (c: number): number => (K * c) / (p.tvl_usd + c) - r * c - gasTotal;
    if (f(cStar) > 0) {
      let lo = 0.01;
      let hi = cStar;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) hi = mid;
        else lo = mid;
      }
      breakeven = Math.max(1, Math.round(hi));
    }
  }
  const perHour = net / (minutes / 60);
  const verdict: FarmVerdict =
    net > 0 ? 'Farm' : slice > gasTotal ? 'Thin' : slice > gasTotal * model.watch_slice_fraction ? 'Watch' : 'Skip';
  return {
    ticket,
    share,
    hold_days: hold,
    ahead_days: Math.round(ahead * 10) / 10,
    weeks,
    minutes,
    chain,
    gas_each: gas,
    gas_total: gasTotal,
    slice_usd: Math.round(slice * 100) / 100,
    tbill_usd: Math.round(tbill * 100) / 100,
    net_usd: Math.round(net * 100) / 100,
    breakeven_ticket: breakeven,
    per_hour_usd: Math.round(perHour * 100) / 100,
    verdict,
  };
}

/** A short dollar figure: $12.5M, $850K, $400, $25.60, -$3.20. */
export function fmtShortUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(Math.round((a / 1e6) * 10) / 10).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1e3)}K`;
  if (a >= 100) return `${sign}$${Math.round(a)}`;
  return `${sign}$${a.toFixed(2)}`;
}

/** A signed $/hour figure: +$4.85/hour, -$2.10/hour. */
export function fmtPerHour(n: number): string {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}/hour`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
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

/**
 * A protocol's farm plan: eight steps (Fund / Verify / Enter / Qualify /
 * Upkeep / Stop rule / Claim / Exit), each an action with a dollar cost and
 * a time, ending in a net verdict computed from the slice, the gas and the
 * T-bill cost. The plan is derived from the protocol's own record
 * (category, chains, TVL, age) and its implied value, never from a
 * hand-written list of names.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  implied: number,
  odds: number,
  model: ModelConstants = MODEL,
  ticket: number = MODEL.ticket_usd,
  share: number = MODEL.airdrop_share,
): FarmStep[] {
  const econ = farmEcon(p, age, implied, model, ticket, share);
  const chain = econ.chain;
  const gas1 = econ.gas_each;
  const verdictWhy =
    econ.verdict === 'Farm'
      ? `slice ${fmtShortUsd(econ.slice_usd)} - gas ${fmtShortUsd(econ.gas_total)} - T-bill ${fmtShortUsd(econ.tbill_usd)} = net ${fmtShortUsd(econ.net_usd)} on a $${ticket} ticket for ${econ.hold_days} days`
      : econ.verdict === 'Thin'
        ? `slice ${fmtShortUsd(econ.slice_usd)} covers gas ${fmtShortUsd(econ.gas_total)} but not the T-bill cost ${fmtShortUsd(econ.tbill_usd)}, net ${fmtShortUsd(econ.net_usd)} on a $${ticket} ticket for ${econ.hold_days} days`
        : econ.verdict === 'Watch'
          ? `slice ${fmtShortUsd(econ.slice_usd)} does not cover gas ${fmtShortUsd(econ.gas_total)} on a $${ticket} ticket for ${econ.hold_days} days, net ${fmtShortUsd(econ.net_usd)}`
          : `slice ${fmtShortUsd(econ.slice_usd)} is a fraction of gas ${fmtShortUsd(econ.gas_total)} on a $${ticket} ticket for ${econ.hold_days} days, net ${fmtShortUsd(econ.net_usd)}`;
  const breakevenText =
    econ.breakeven_ticket === null
      ? 'no ticket breaks even'
      : `break-even ticket ${fmtShortUsd(econ.breakeven_ticket)}`;
  return [
    {
      text: `Move $${ticket} of USDC into a fresh wallet that holds only farm funds, and keep its seed phrase offline.`,
      cost: `$${ticket} of capital, returned when you unwind`,
      time: '15 minutes',
    },
    {
      text: `Open defillama.com/protocol/${p.slug} from the address bar, not a search ad, and check the TVL, category and chains match this board.`,
      cost: '$0, no transaction',
      time: '10 minutes',
    },
    {
      text: actionFor(p, ticket, chain),
      cost: `$${ticket} of capital, returned when you unwind, and about ${gasText(gas1)} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: `After a week, ${weeklyFor(p, ticket, chain).charAt(0).toLowerCase()}${weeklyFor(p, ticket, chain).slice(1)}`,
      cost: `about ${gasText(gas1)} of gas on ${chain}`,
      time: '10 minutes',
    },
    {
      text: `Repeat the qualifying action once a week for ${econ.hold_days} days so the activity is counted in more than one snapshot.`,
      cost: `about ${gasText(gas1)} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `If TVL falls 30% from entry, or the protocol's points page closes, unwind at once and log the exit; do not add funds to a falling protocol.`,
      cost: '$0 to check',
      time: '5 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: `no fee to check, about ${gasText(gas1)} of gas only if you claim`,
      time: '10 minutes',
    },
    {
      text: `Withdraw the $${ticket}, write the wallet, the dates and every transaction in a farm log. Verdict: ${econ.verdict} — ${verdictWhy}; ${breakevenText}; ${fmtPerHour(econ.per_hour_usd)}. Token odds ${Math.round(odds * 100)}% do not change the slice: the slice is priced on the implied value, and the odds say how likely a token ever pays it.`,
      cost: '$0 to log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------------------
// Board: who ranks, the census, the build
// ---------------------------------------------------------------------------

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

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Score one protocol under a fitted curve: implied, interval, comps, odds. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  curve: CurveModel,
  finalLevel: string,
  intervals: IntervalStats,
  comps: CleanComp[],
  oddsFit: FitResult['token_odds'],
  model: ModelConstants,
): {
  implied: number;
  sector: string;
  curveUsd: number;
  sectorUsd: number;
  baseUsd: number;
  growthMult: number;
  ageMult: number;
  age: number | null;
  low: number;
  high: number;
  comps: string[];
  odds: number;
} {
  const v = impliedValue(p, asOf, curve, finalLevel, model);
  const band = intervalFor(v.implied, v.age, intervals, model);
  return {
    ...v,
    low: band.low,
    high: band.high,
    comps: nearestComps(v.sector, p.tvl_usd, comps),
    odds: tokenOdds(p, asOf, oddsFit),
  };
}

/**
 * Rank ranges over bootstrap refits: resample the cleaned comps with
 * replacement (fixed seed), refit the curve and sector effects, rescore
 * every ranked row, and record each row's rank. Returns the P10-P90 rank
 * range per slug, and the width summary.
 */
export function bootstrapRankRanges(
  rows: { slug: string; tvl_usd: number; category: string | null; change_7d: number | null; age_days: number | null }[],
  comps: CleanComp[],
  finalLevel: string,
  model: ModelConstants,
): { ranges: Map<string, { lo: number; hi: number }>; stats: RefitStats } {
  const rand = mulberry32(model.bootstrap_seed);
  const ranksBySlug = new Map<string, number[]>();
  for (const r of rows) ranksBySlug.set(r.slug, []);
  for (let b = 0; b < model.bootstrap_refits; b++) {
    const sample: CleanComp[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rand() * comps.length)]!);
    const curve = fitCurve(sample, model);
    const scored = rows.map((r) => {
      const sector = sectorOf(r.category);
      let log = curve.intercept + curve.slope * Math.log(r.tvl_usd);
      if (finalLevel === 'L0') {
        return { slug: r.slug, tvl: r.tvl_usd, value: r.tvl_usd * curve.global_median_multiple };
      }
      if (finalLevel === 'L1') return { slug: r.slug, tvl: r.tvl_usd, value: Math.exp(log) };
      log += curve.sector_effects.get(sector) ?? 0;
      if (finalLevel === 'L2') return { slug: r.slug, tvl: r.tvl_usd, value: Math.exp(log) };
      const g = growthAgeMultipliers(r.change_7d, r.age_days, model);
      return { slug: r.slug, tvl: r.tvl_usd, value: Math.exp(log) * g.growth * g.ageMult };
    });
    scored.sort(
      (a, b) =>
        b.value - a.value ||
        b.tvl - a.tvl ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
    scored.forEach((s, i) => ranksBySlug.get(s.slug)!.push(i + 1));
  }
  const ranges = new Map<string, { lo: number; hi: number }>();
  const widths: number[] = [];
  for (const [slug, ranks] of ranksBySlug) {
    const lo = Math.round(quantile(ranks, 0.1));
    const hi = Math.round(quantile(ranks, 0.9));
    ranges.set(slug, { lo, hi });
    widths.push(hi - lo);
  }
  return {
    ranges,
    stats: {
      refits: model.bootstrap_refits,
      median_rank_width: Math.round(median(widths)),
      p90_rank_width: Math.round(quantile(widths, 0.9)),
      rows_with_width_le_10: widths.filter((w) => w <= 10).length,
    },
  };
}

/** Fit everything the dashboard reports, from the snapshot's comps. */
export function fitModel(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): {
  fit: Omit<FitResult, 'refits' | 'best_per_hour'>;
  comps: CleanComp[];
  curve: CurveModel;
  odds: FitResult['token_odds'];
  intervals: IntervalStats;
  finalLevel: string;
} {
  const { comps, traded_n, house_excluded, receipt_excluded, families_merged } = cleanComps(snapshot);
  const curve0 = fitCurve(comps, model);
  const ts = fitTheilSen(comps);
  const { ladder, final_level, loo_residuals, wf_predictions } = fitLadder(comps, model);
  const intervals = fitIntervals(loo_residuals, wf_predictions, model);
  const odds = fitTokenOdds(snapshot);
  // In-sample R^2 of the final (kept) model on the cleaned comps.
  const actuals = comps.map((p) => Math.log(p.mcap_usd));
  const meanY = actuals.reduce((s, v) => s + v, 0) / actuals.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < comps.length; i++) {
    const p = comps[i]!;
    const pred = levelLogPredict(final_level, p.tvl_usd, p.sector, p.change_7d, p.age_days, curve0, model);
    ssRes += (actuals[i]! - pred) ** 2;
    ssTot += (actuals[i]! - meanY) ** 2;
  }
  const fit: Omit<FitResult, 'refits' | 'best_per_hour'> = {
    traded_n,
    house_excluded,
    receipt_excluded,
    families_merged,
    comps_n: comps.length,
    curve: {
      // Full precision, not rounded: the dashboard recomputes implied
      // value from these numbers, so rounding them here would move every
      // row by a fraction of a percent against board.json.
      intercept: ts.intercept,
      slope: ts.slope,
      r2: round4(ts.r2),
      global_median_multiple: curve0.global_median_multiple,
      sector_effects: fitSectorEffects(comps, ts.intercept, ts.slope, model.sector_shrink_pseudo),
      final_r2: round4(1 - ssRes / ssTot),
    },
    ladder,
    final_level,
    intervals,
    token_odds: odds,
  };
  return { fit, comps, curve: curve0, odds, intervals, finalLevel: final_level };
}

/** The protocols the board ranks, strongest first, with ranks 1..n, plus the 200-refit summary. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  prefit?: {
    comps: CleanComp[];
    curve: CurveModel;
    odds: FitResult['token_odds'];
    intervals: IntervalStats;
    finalLevel: string;
  },
): { board: BoardRow[]; refitStats: RefitStats } {
  const f =
    prefit ??
    (() => {
      const { comps, curve, odds, intervals, finalLevel } = fitModel(snapshot, model);
      return { comps, curve, odds, intervals, finalLevel };
    })();
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
    const s = scoreProtocol(p, snapshot.as_of, f.curve, f.finalLevel, f.intervals, f.comps, f.odds, model);
    return { p, ...s };
  });
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  // Rank ranges over 200 bootstrap refits of the comps.
  const { ranges, stats } = bootstrapRankRanges(
    scored.map((s) => ({
      slug: s.p.slug,
      tvl_usd: s.p.tvl_usd,
      category: s.p.category,
      change_7d: s.p.change_7d,
      age_days: s.age,
    })),
    f.comps,
    f.finalLevel,
    model,
  );
  const rows: BoardRow[] = scored.map((s, i) => {
    const range = ranges.get(s.p.slug)!;
    return {
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
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        sector: s.sector,
        play: playOf(s.p.category).play,
        curve_usd: Math.round(s.curveUsd),
        sector_usd: Math.round(s.sectorUsd),
        base_usd: Math.round(s.baseUsd),
        growth_multiplier: round4(s.growthMult),
        age_multiplier: round4(s.ageMult),
        token_odds: round4(s.odds),
        odds_adjusted_usd: Math.round(s.implied * s.odds),
        low_usd: s.low,
        high_usd: s.high,
        rank_lo: range.lo,
        rank_hi: range.hi,
        comps: s.comps,
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age, s.implied, s.odds, model).map(stepText),
    };
  });
  return { board: rows, refitStats: stats };
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

/** The cleaned comps, by market cap, for the dashboard's Comps view. */
export function compRows(
  comps: CleanComp[],
  curve: CurveModel,
  finalLevel: string,
  model: ModelConstants,
): CompRow[] {
  return comps
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      sector: p.sector,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd / p.tvl_usd,
      fitted_usd: Math.round(
        Math.exp(levelLogPredict(finalLevel, p.tvl_usd, p.sector, p.change_7d, p.age_days, curve, model)),
      ),
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || b.tvl_usd - a.tvl_usd);
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    sector: row.model.sector,
    play: row.model.play,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    token_odds: row.model.token_odds,
    low_usd: row.model.low_usd,
    high_usd: row.model.high_usd,
    rank_lo: row.model.rank_lo,
    rank_hi: row.model.rank_hi,
    comps: row.model.comps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { fit, comps, curve, odds, intervals, finalLevel } = fitModel(snapshot, model);
  const { board, refitStats } = buildBoard(snapshot, model, { comps, curve, odds, intervals, finalLevel });
  const live = liveRows(snapshot);
  const compList = compRows(comps, curve, finalLevel, model);
  const census = buildCensus(snapshot, board.length);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const totalImplied = board.reduce((sum, r) => sum + r.implied_value_usd, 0);
  // Best $/hour across the board, on the $1,000 ticket.
  let best: { slug: string; name: string; per_hour_usd: number; verdict: string } | null = null;
  for (const r of board) {
    const p = snapshot.protocols.find((x) => x.slug === r.slug)!;
    const e = farmEcon(p, r.age_days, r.implied_value_usd, model);
    if (best === null || e.per_hour_usd > best.per_hour_usd) {
      best = { slug: r.slug, name: r.name, per_hour_usd: e.per_hour_usd, verdict: e.verdict };
    }
  }
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
    comps: compList,
    fit: { ...fit, refits: refitStats, best_per_hour: best! },
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
