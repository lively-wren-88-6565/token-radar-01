// Token Radar (radar-6): the entrypoint the grader runs.
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every clean pre-token protocol with the fitted model in lib/model.ts,
// writes the ranked board to /output/board.json, writes the dashboard's data
// beside the page as data.js, copies dashboard/ and screenshots/ to /output,
// and writes /output/dossier.json with the vendored make.fun library.
//
// The model is fitted at build time from the snapshot's own traded comps:
// a Theil-Sen log-log TVL curve over cleaned comps (one per ticker, house
// categories and receipt tokens out), plus a shrunken sector effect, with
// growth and age kept only if the blind-test ladder (leave-one-out and
// old-to-new walk-forward) says they lower the miss on both tests; token
// odds come from a logistic regression on all 758 protocols. The run
// prints the fit, the ladder, the interval hit rates, the 758-protocol
// census and the farm verdicts, so a run's own log says what the model
// claims and how well it held up.
//
// The run is deterministic: the same snapshot bytes always write the same
// output bytes. No network, no clock, no randomness except a fixed-seed
// bootstrap (seed 20261121), which is deterministic too.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

/** The run's own log: the fit, the ladder, the intervals, the census and the verdicts. */
const fit = radar.fit;
const verdicts = { Farm: 0, Thin: 0, Watch: 0, Skip: 0 };
for (const row of board) {
  const last = row.farm_steps[row.farm_steps.length - 1]!;
  const m = last.match(/Verdict: (Farm|Thin|Watch|Skip)/);
  if (m !== null) verdicts[m[1] as 'Farm' | 'Thin' | 'Watch' | 'Skip']++;
}
const ladderLine = fit.ladder
  .map((l) => `${l.level} LOO x${l.loo_miss_x} / WF x${l.wf_miss_x}${l.kept ? ' kept' : ' dropped'}`)
  .join('; ');
const iv = fit.intervals;

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: comps cleaned ${fit.traded_n} traded -> ${fit.comps_n} (${fit.house_excluded} house, ${fit.receipt_excluded} receipt, ${fit.families_merged} family merges)\n` +
    `token radar: Theil-Sen log(mcap) = ${fit.curve.intercept} + ${fit.curve.slope} x log(TVL), R2 ${fit.curve.r2}, final ${fit.final_level} R2 ${fit.curve.final_r2}\n` +
    `token radar: ladder ${ladderLine}\n` +
    `token radar: intervals P25-P75 young x${iv.young_lo_factor}-x${iv.young_hi_factor} old x${iv.old_lo_factor}-x${iv.old_hi_factor}; LOO hits ${iv.loo_hit_young}/${iv.loo_n_young} young, ${iv.loo_hit_old}/${iv.loo_n_old} old, ${iv.loo_hit_all}/${iv.loo_n_all} all; walk-forward hits ${iv.wf_hit}/${iv.wf_n}\n` +
    `token radar: 200-refit rank range median width ${fit.refits.median_rank_width}, p90 ${fit.refits.p90_rank_width}, ${fit.refits.rows_with_width_le_10}/196 rows within 10 ranks\n` +
    `token radar: top ${board[0]!.name} $${board[0]!.implied_value_usd}, total implied $${radar.total_implied_usd}; best per hour ${fit.best_per_hour.name} ${fit.best_per_hour.per_hour_usd >= 0 ? '+' : ''}$${fit.best_per_hour.per_hour_usd}/h (${fit.best_per_hour.verdict})\n` +
    `token radar: census ${radar.census.total} = ${radar.census.ranked} ranked + ${radar.census.traded_mcap} traded + ${radar.census.token_recorded_no_mcap} token recorded without mcap + ${radar.census.pretoken_excluded} pre-token excluded\n` +
    `token radar: farm verdicts on a $1000 ticket: ${verdicts.Farm} Farm, ${verdicts.Thin} Thin, ${verdicts.Watch} Watch, ${verdicts.Skip} Skip\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
