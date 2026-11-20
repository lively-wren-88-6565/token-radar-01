// Verify out/ against the competition's seven gates (RULES.txt) plus determinism.
// Usage: node check.mjs <out-dir> <snapshot.json>
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const [outDir, snapPath] = process.argv.slice(2);
const fails = [];
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails.push(name);
};
const bytes = (p) => statSync(p).size;

function pngSize(p) {
  const b = readFileSync(p);
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), kind: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) break;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), kind: 'jpeg' };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

// 1. Dashboard
const dash = readdirSync(join(outDir, 'dashboard'));
const dashBytes = dash.reduce((s, f) => s + bytes(join(outDir, 'dashboard', f)), 0);
ok('dashboard: index.html + css + js present', existsSync(join(outDir, 'dashboard', 'index.html')) && dash.some((f) => f.endsWith('.css')) && dash.some((f) => f.endsWith('.js')), `${dash.length} files, ${dashBytes} bytes`);
ok('dashboard: <=400 files, <=4 MiB', dash.length <= 400 && dashBytes <= 4_194_304);
const dashText = dash.map((f) => readFileSync(join(outDir, 'dashboard', f), 'utf8')).join('\n');
ok('dashboard: no http/https address', !/https?:\/\//.test(dashText));
ok('dashboard: source <= 65536 bytes (dossier text cap)', dashBytes <= 65536, `${dashBytes} bytes`);

// 2-5. Board
const board = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8'));
const rows = board.rows;
ok('board: 100-4000 rows, <=8 MiB', rows.length >= 100 && rows.length <= 4000 && bytes(join(outDir, 'board.json')) <= 8_388_608, `${rows.length} rows`);
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const missing = snap.watchlist.filter((s) => !rows.some((r) => r.slug === s));
ok('board: covers all 40 watchlist', missing.length === 0, `missing ${missing.length}`);
ok('board: ranks exactly 1..N', rows.every((r, i) => r.rank === i + 1));
ok('board: implied non-increasing, not all equal', rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd) && rows[0].implied_value_usd !== rows[rows.length - 1].implied_value_usd, `rank1 $${rows[0].implied_value_usd}, last $${rows[rows.length - 1].implied_value_usd}`);
ok('board: every row has slug/name/rank/implied/farm_steps, implied a positive int <= 1e14',
  rows.every((r) => typeof r.slug === 'string' && typeof r.name === 'string' && Number.isSafeInteger(r.rank) && Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0 && r.implied_value_usd <= 1e14 && Array.isArray(r.farm_steps)));
const badSteps = rows.filter((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.length < 20 || s.length > 600));
ok('board: farm_steps 3-12 per row, each 20-600 chars', badSteps.length === 0, badSteps.length ? `bad: ${badSteps.slice(0, 3).map((r) => r.slug).join(', ')}` : `${rows.length} rows x ${rows[0].farm_steps.length} steps`);

// 6. Screenshots
const shots = readdirSync(join(outDir, 'screenshots'));
ok('screenshots: 3-4 images', shots.length >= 3 && shots.length <= 4, shots.join(', '));
for (const f of shots) {
  const p = join(outDir, 'screenshots', f);
  const dim = pngSize(p);
  ok(`screenshots/${f}: <=512 KiB, long edge <=1440, short edge >=800`, bytes(p) <= 524288 && dim && Math.max(dim.w, dim.h) <= 1440 && Math.min(dim.w, dim.h) >= 800, `${bytes(p)} bytes, ${dim ? dim.w + 'x' + dim.h : 'unreadable'}`);
}

// 7. Dossier
const dossier = readFileSync(join(outDir, 'dossier.json'));
ok('dossier: <=1.5 MiB', dossier.length <= 1_572_864, `${dossier.length} bytes`);
const rebuilt = buildDossier(outDir, { text_max_bytes: 65536 });
ok('dossier: byte-identical to buildDossier output', dossier.equals(Buffer.from(rebuilt)), '');

// data.js sanity
const dataJs = readFileSync(join(outDir, 'data.js'), 'utf8');
ok('data.js: single window.RADAR assignment, no fetch', dataJs.startsWith('window.RADAR=') && !/fetch\(|XMLHttpRequest/.test(dataJs));

console.log(fails.length === 0 ? 'ALL GATES PASS' : `FAILURES: ${fails.join(', ')}`);
process.exit(fails.length === 0 ? 0 : 1);
