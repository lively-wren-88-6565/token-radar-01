// Token Radar dashboard (radar-7). Reads window.RADAR and renders the
// board, filters, detail views and farm plans. No network. The model
// recomputed here is the one main.ts runs: a Theil-Sen size curve plus
// sector effect, blended with a v4-style ensemble (grid-chosen weight),
// plus compressed growth and age (kept level L4).
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var detailState = { ticket: 1000, share: 0.10 };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtOdds(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return Math.round(n * 100) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }
  function fmtNum(n, digits) { return Number(n).toFixed(digits === undefined ? 3 : digits); }
  function fmtShortUsd(n) {
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 1e6) return sign + '$' + (Math.round((a / 1e6) * 10) / 10).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return sign + '$' + Math.round(a / 1e3) + 'K';
    if (a >= 100) return sign + '$' + Math.round(a);
    return sign + '$' + a.toFixed(2);
  }
  function fmtPerHour(n) { return (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toFixed(2) + '/hour'; }

  // The fitted model, in the same arithmetic main.ts runs. The per-row
  // TS and ensemble values ride in data.js at full precision, so this
  // recomputation matches board.json exactly.
  function sectorEffect(sector) {
    var hit = null;
    DATA.fit.curve.sector_effects.forEach(function (e) { if (e.sector === sector) hit = e.effect_log; });
    return hit === null ? 0 : hit;
  }
  function impliedOf(row) {
    var f = DATA.fit;
    var m = DATA.model;
    var ch = f.chosen;
    var curveUsd = Math.exp(f.curve.intercept + f.curve.slope * Math.log(row.tvl_usd));
    var sectorUsd = curveUsd * Math.exp(sectorEffect(row.sector));
    var tsUsd = sectorUsd;
    var ensUsd = row.ensemble_usd;
    var blendedUsd = Math.exp((1 - ch.blend_weight) * Math.log(tsUsd) + ch.blend_weight * Math.log(ensUsd));
    var baseUsd = sectorUsd;
    var growthMult = 1;
    var ageMult = 1;
    if (f.final_level === 'L0') baseUsd = row.tvl_usd * f.curve.global_median_multiple;
    else if (f.final_level === 'L1') baseUsd = curveUsd;
    else if (f.final_level === 'L3') baseUsd = blendedUsd;
    else if (f.final_level === 'L4') {
      var g = Math.min(ch.growth_clamp, Math.max(-ch.growth_clamp,
        row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d / 100));
      growthMult = Math.pow(1 + g, f.curve.slope);
      if (row.age_days !== null && row.age_days !== undefined) {
        ageMult = Math.min(m.age_mult_hi, Math.max(m.age_mult_lo,
          Math.exp(ch.age_shrink * ch.age_slope_log_per_year * (row.age_days / 365 - ch.mean_age_years))));
      }
      baseUsd = blendedUsd * growthMult * ageMult;
    }
    var implied = Math.max(1, Math.round(baseUsd));
    return { implied: implied, curveUsd: curveUsd, sectorUsd: sectorUsd, tsUsd: tsUsd,
      ensembleUsd: ensUsd, blendedUsd: blendedUsd, baseUsd: baseUsd,
      growthMult: growthMult, ageMult: ageMult };
  }
  function tokenOddsOf(row) {
    var o = DATA.fit.token_odds;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var x1 = Math.log10(Math.max(1, row.tvl_usd));
    var x2 = age / 365;
    return 1 / (1 + Math.exp(-(o.intercept + o.per_log10_tvl * x1 + o.per_age_year * x2)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Farm economics, in the same arithmetic main.ts runs: a fixed ticket
  // at a 10% share, sliced by dollar-days, net of gas and the 4% T-bill.
  var PLAY_HOLD = { vault: 90, lend: 90, dollar: 60, rwa: 90, pool: 60, perps: 60, market: 60, stake: 90, network: 60, pay: 60 };
  var GAS_USD = { Ethereum: 8, Bitcoin: 5, Solana: 0.01, Tron: 1, Bittensor: 1, Binance: 0.3, Polygon: 0.1, Avalanche: 0.5 };
  var L2_CHAINS = ['Base', 'Arbitrum', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mode', 'Ink', 'Mantle', 'Unichain', 'Abstract', 'Berachain', 'Sonic', 'Fraxtal', 'Gravity', 'Sei', 'Starknet', 'Polygon zkEVM', 'opBNB'];
  function gasUsd(chain) {
    if (Object.prototype.hasOwnProperty.call(GAS_USD, chain)) return GAS_USD[chain];
    if (L2_CHAINS.indexOf(chain) >= 0) return 0.5;
    return 2;
  }
  function gasText(gas) { return gas >= 1 ? '$' + gas : '$' + gas.toFixed(2); }
  function cheapestChain(p) {
    var chains = p.chains && p.chains.length > 0 ? p.chains.slice(0, 3) : ['its main chain'];
    var best = chains[0];
    var bestGas = gasUsd(best);
    chains.forEach(function (c) { var g = gasUsd(c); if (g < bestGas) { best = c; bestGas = g; } });
    return { chain: best, gas: bestGas };
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function farmEcon(p, ticket, share) {
    var m = DATA.model;
    ticket = ticket === undefined ? m.ticket_usd : ticket;
    share = share === undefined ? m.airdrop_share : share;
    var hold = PLAY_HOLD[p.play] || 60;
    var age = p.age_days === null || p.age_days === undefined ? m.unknown_age_days : p.age_days;
    var ahead = Math.min(age / 2, 365);
    var weeks = Math.ceil(hold / 7);
    var minutes = 65 + 15 * weeks;
    var cheap = cheapestChain(p);
    var gasTotal = round2((weeks + 2) * cheap.gas);
    var slice = (p.implied_value_usd * share * ticket) / (p.tvl_usd + ticket) * (hold / (ahead + hold));
    var tbill = ticket * m.tbill_rate * (hold / 365);
    var net = slice - gasTotal - tbill;
    var K = p.implied_value_usd * share * (hold / (ahead + hold));
    var r = m.tbill_rate * (hold / 365);
    var breakeven = null;
    var cStar = Math.sqrt((K * p.tvl_usd) / r) - p.tvl_usd;
    if (cStar > 0) {
      var f = function (c) { return (K * c) / (p.tvl_usd + c) - r * c - gasTotal; };
      if (f(cStar) > 0) {
        var lo = 0.01;
        var hi = cStar;
        for (var i = 0; i < 60; i++) {
          var mid = (lo + hi) / 2;
          if (f(mid) > 0) hi = mid;
          else lo = mid;
        }
        breakeven = Math.max(1, Math.round(hi));
      }
    }
    var perHour = net / (minutes / 60);
    var verdict = net > 0 ? 'Farm' : slice > gasTotal ? 'Thin' : 'Skip';
    return { ticket: ticket, share: share, hold_days: hold, ahead_days: Math.round(ahead * 10) / 10, weeks: weeks,
      minutes: minutes, chain: cheap.chain, gas_each: cheap.gas, gas_total: gasTotal,
      slice_usd: round2(slice), tbill_usd: round2(tbill), net_usd: round2(net),
      breakeven_ticket: breakeven, per_hour_usd: round2(perHour), verdict: verdict };
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0)
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the borrow side open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0)
      return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0)
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0)
      return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trading') >= 0)
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('onchain capital') >= 0)
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0 || c.indexOf('rwa') >= 0)
      return 'Mint $' + capital + " of the protocol's yield asset through " + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('aggregator') >= 0)
      return 'Deposit $' + capital + " of USDC into " + name + "'s highest-yield vault on " + chain + ' and keep the shares.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0)
      return 'Spend $' + capital + " through " + name + "'s card or payment flow on " + chain + ' and keep the receipts.';
    if (c.indexOf('governance') >= 0 || c.indexOf('index') >= 0)
      return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and vote once with the position.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + " of activity on " + name + "'s chain through its own bridge or app.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0)
      return 'Swap $' + small + ' back and forth in ' + name + "'s main pool on " + chain + ' to build volume.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0)
      return 'Borrow $' + small + ' against the deposit on ' + name + ' and repay it the same week.';
    if (c.indexOf('bridge') >= 0)
      return 'Bridge $' + small + ' through ' + name + ' again so the bridge counts a second week.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0)
      return 'Close and reopen one small position on ' + name + ' to keep weekly trading activity.';
    if (c.indexOf('prediction') >= 0) return 'Place one more market position on ' + name + ' each week.';
    if (c.indexOf('governance') >= 0 || c.indexOf('index') >= 0) return 'Vote once a week on ' + name + ' with the position.';
    return 'Make one more qualifying action on ' + name + ' each week, such as a deposit, a swap or a vote.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p, ticket, share) {
    var econ = farmEcon(p, ticket, share);
    ticket = econ.ticket;
    var chain = econ.chain;
    var gas1 = econ.gas_each;
    var odds = tokenOddsOf(p);
    var weekly = weeklyFor(p, ticket, chain);
    var why = econ.verdict === 'Farm'
      ? 'slice ' + fmtShortUsd(econ.slice_usd) + ' - gas ' + fmtShortUsd(econ.gas_total) + ' - T-bill ' + fmtShortUsd(econ.tbill_usd) + ' = net ' + fmtShortUsd(econ.net_usd) + ' on a $' + ticket + ' ticket for ' + econ.hold_days + ' days'
      : econ.verdict === 'Thin'
        ? 'slice ' + fmtShortUsd(econ.slice_usd) + ' covers gas ' + fmtShortUsd(econ.gas_total) + ' but not the T-bill cost ' + fmtShortUsd(econ.tbill_usd) + ', net ' + fmtShortUsd(econ.net_usd) + ' on a $' + ticket + ' ticket for ' + econ.hold_days + ' days'
        : 'slice ' + fmtShortUsd(econ.slice_usd) + ' does not cover gas ' + fmtShortUsd(econ.gas_total) + ' on a $' + ticket + ' ticket for ' + econ.hold_days + ' days, net ' + fmtShortUsd(econ.net_usd);
    var breakevenText = econ.breakeven_ticket === null ? 'no ticket breaks even' : 'break-even ticket ' + fmtShortUsd(econ.breakeven_ticket);
    return [
      { text: 'Move $' + ticket + ' of USDC into a fresh wallet that holds only farm funds, and keep its seed phrase offline.', cost: '$' + ticket + ' of capital, returned when you unwind', time: '15 minutes' },
      { text: 'Open defillama.com/protocol/' + p.slug + ' from the address bar, not a search ad, and check the TVL, category and chains match this board.', cost: '$0, no transaction', time: '10 minutes' },
      { text: actionFor(p, ticket, chain), cost: '$' + ticket + ' of capital, returned when you unwind, and about ' + gasText(gas1) + ' of gas on ' + chain, time: '15 minutes to set up' },
      { text: 'After a week, ' + weekly.charAt(0).toLowerCase() + weekly.slice(1), cost: 'about ' + gasText(gas1) + ' of gas on ' + chain, time: '10 minutes' },
      { text: 'Repeat the qualifying action once a week for ' + econ.hold_days + ' days so the activity is counted in more than one snapshot.', cost: 'about ' + gasText(gas1) + ' of gas a week on ' + chain, time: '10 minutes a week' },
      { text: 'If TVL falls 30% from entry, or the protocol\'s points page closes, unwind at once and log the exit; do not add funds to a falling protocol.', cost: '$0 to check', time: '5 minutes a week' },
      { text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, about ' + gasText(gas1) + ' of gas only if you claim', time: '10 minutes' },
      { text: 'Withdraw the $' + ticket + ', write the wallet, the dates and every transaction in a farm log. Verdict: ' + econ.verdict + ' — ' + why + '; ' + breakevenText + '; ' + fmtPerHour(econ.per_hour_usd) + '. Token odds ' + Math.round(odds * 100) + '% do not change the slice: the slice is priced on the implied value, and the odds say how likely a token ever pays it.', cost: '$0 to log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function compRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.comps.filter(function (r) {
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.token_odds === null || a.token_odds === undefined ? -Infinity : a.token_odds; bv = b.token_odds === null || b.token_odds === undefined ? -Infinity : b.token_odds; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function verdictCounts() {
    var c = { Farm: 0, Thin: 0, Skip: 0 };
    DATA.rows.forEach(function (r) { c[farmEcon(r).verdict]++; });
    return c;
  }

  function lede() {
    var c = DATA.census;
    var f = DATA.fit;
    var finalLadder = null;
    f.ladder.forEach(function (l) { if (l.level === f.final_level) finalLadder = l; });
    var vc = verdictCounts();
    var censusLine = c.total + ' protocols accounted for: ' + c.ranked + ' ranked pre-token, ' +
      c.traded_mcap + ' traded with a market cap, ' + c.token_recorded_no_mcap +
      ' with a token recorded but no market cap, ' + c.pretoken_excluded + ' pre-token excluded (' +
      c.excluded_by.map(function (e) { return e.reason + ' ' + e.n; }).join(', ') + ').';
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more clean pre-token protocols below that floor, ranked by a value model fitted on the traded tokens. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: c.watchlist_covered + ' / ' + c.watchlist })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Cleaned comps fitted' }), el('b', { text: String(f.comps_n) + ' of ' + f.traded_n })),
        el('div', { class: 'fact' }, el('span', { text: 'Size curve (Theil-Sen) R²' }), el('b', { text: fmtNum(f.curve.r2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Blind miss, leave-one-out' }), el('b', { text: finalLadder ? 'x' + fmtNum(finalLadder.loo_miss_x) : 'n/a' })),
        el('div', { class: 'fact' }, el('span', { text: 'Blind miss, walk-forward' }), el('b', { text: finalLadder ? 'x' + fmtNum(finalLadder.wf_miss_x) : 'n/a' })),
        el('div', { class: 'fact' }, el('span', { text: 'Range holds, leave-one-out' }), el('b', { text: f.intervals.loo_hit_all + '/' + f.intervals.loo_n_all })),
        el('div', { class: 'fact' }, el('span', { text: 'Worth farming ($1,000 ticket)' }), el('b', { text: vc.Farm + ' Farm, ' + vc.Thin + ' Thin, ' + vc.Skip + ' Skip' })),
        el('div', { class: 'fact' }, el('span', { text: 'Best per hour' }), el('b', { text: f.best_per_hour.name + ' ' + fmtPerHour(f.best_per_hour.per_hour_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) }))
      ),
      funnel(),
      ledger(),
      el('p', { class: 'census', text: censusLine })
    );
  }

  function ledger() {
    var c = DATA.census;
    var segs = [
      { label: 'Ranked pre-token', n: c.ranked },
      { label: 'Traded, has a market cap', n: c.traded_mcap },
      { label: 'Token recorded, no market cap', n: c.token_recorded_no_mcap },
      { label: 'Pre-token set aside', n: c.pretoken_excluded }
    ];
    return el('div', { class: 'ledger' },
      el('h2', { text: 'Ledger: all ' + c.total + ' protocols accounted for' }),
      el('div', { class: 'lbar' }, segs.map(function (s) {
        return el('i', { style: 'width:' + (s.n / c.total * 100).toFixed(1) + '%', title: s.label + ' ' + s.n });
      })),
      el('p', { class: 'sub', text: segs.map(function (s) { return s.label + ' ' + s.n; }).join(' · ') + '. Each set-aside row carries a demoted value (TVL x the median multiple of the 5 nearest live tokens, never ranked) in the Set aside view.' })
    );
  }

  function funnel() {
    var c = DATA.census;
    var pre = c.ranked + c.pretoken_excluded;
    var steps = [
      { label: 'All protocols in the snapshot', n: c.total },
      { label: 'Record no token', n: pre },
      { label: 'Clean pre-token, ranked', n: c.ranked },
      { label: 'On the watchlist', n: c.watchlist }
    ];
    return el('div', { class: 'funnel' },
      el('h2', { text: 'Why these ' + c.ranked + ' protocols' }),
      el('div', { class: 'fsteps' }, steps.map(function (b) {
        return el('div', { class: 'fstep' },
          el('b', { class: 'num', text: String(b.n) }),
          el('div', { class: 'ftrack' }, el('i', { style: 'width:' + Math.max(4, Math.round((b.n / c.total) * 100)) + '%' })),
          el('span', { text: b.label }));
      })),
      el('p', { class: 'sub', text: 'From no-token to ranked, ' + c.pretoken_excluded + ' are left out: ' +
        c.excluded_by.map(function (e) { return e.reason + ' (' + e.n + ')'; }).join(', ') +
        '. ' + DATA.early_size + ' ranked rows sit below the $50M floor.' })
    );
  }

  function selectField(label, id, options, value, onChange) {
    var select = el('select', { id: id, 'aria-label': label },
      options.map(function (o) { return el('option', { value: o.value, text: o.label, selected: o.value === value ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { onChange(select.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
  }

  function downloadCsv() {
    var head = 'rank,slug,name,category,sector,tvl_usd,implied_value_usd,low_usd,high_usd,rank_lo,rank_hi,token_odds,farm_verdict,net_usd,per_hour_usd';
    var lines = DATA.rows.map(function (r) {
      var e = farmEcon(r);
      var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
      return [r.rank, r.slug, q(r.name), q(r.category || ''), r.sector, r.tvl_usd, r.implied_value_usd,
        r.low_usd, r.high_usd, r.rank_lo, r.rank_hi, r.token_odds, e.verdict, e.net_usd, e.per_hour_usd].join(',');
    });
    var blob = new Blob([head + '\n' + lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var tabBtn = function (tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; render(); } });
    };
    var count = state.tab === 'pre-token' ? rows().length + ' rows shown'
      : state.tab === 'live' ? DATA.live.length + ' live-token protocols'
      : state.tab === 'set-aside' ? DATA.set_aside.length + ' set-aside protocols'
      : compRows().length + ' traded comps shown';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('Category', 'category', [{ value: 'all', label: 'All categories' }].concat(categories.map(function (c) { return { value: c, label: c }; })), state.category, function (v) { state.category = v; }),
      selectField('Chain', 'chain', [{ value: 'all', label: 'All chains' }].concat(chains.map(function (c) { return { value: c, label: c }; })), state.chain, function (v) { state.chain = v; }),
      selectField('Min TVL', 'minTvl', [
        { value: '0', label: 'Any TVL' },
        { value: '100000000', label: '$100M and up' },
        { value: '500000000', label: '$500M and up' },
        { value: '1000000000', label: '$1B and up' }
      ], String(state.minTvl), function (v) { state.minTvl = Number(v); }),
      selectField('Sort by', 'sort', [
        { value: 'implied', label: 'Implied value' },
        { value: 'tvl', label: 'TVL' },
        { value: 'growth', label: '7-day growth' },
        { value: 'age', label: 'Age' },
        { value: 'odds', label: 'Token odds' },
        { value: 'name', label: 'Name' }
      ], state.sort, function (v) { state.sort = v; state.dir = -1; }),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'), tabBtn('set-aside', 'Set aside'), tabBtn('comps', 'Comps'))),
      el('button', { class: 'button', type: 'button', text: 'Download CSV', onclick: downloadCsv }),
      el('span', { class: 'count', text: count })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var econ = farmEcon(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtOdds(r.token_odds) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.low_usd) + '–' + fmtUsd(r.high_usd) }),
        el('td', null, el('span', { class: 'verdict v-' + econ.verdict, text: econ.verdict + ' ' + fmtShortUsd(econ.net_usd) }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest first. Range is the P25–P75 band. Farm is the verdict on a $1,000 ticket, with its net.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Token odds'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Range (P25–P75)' }),
            el('th', { scope: 'col', text: 'Farm ($1,000)' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these already trade; market cap is a fact, not a model.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function setAsideRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.set_aside.filter(function (r) {
      if (!q) return true;
      var hay = [r.name, r.slug, r.category].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function setAsideTable() {
    var tbody = el('tbody');
    setAsideRows().forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + r.reason }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.demoted_usd) }),
        el('td', null, el('span', { class: 'status', text: 'set aside' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols the clean rule leaves out, each with a demoted value: TVL x the median multiple of the 5 nearest live tokens.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Demoted value' }), el('th', { scope: 'col', text: 'Status' }))),
          tbody
        )
      )
    );
  }

  function compTable() {
    var list = compRows();
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No comp matches that search' }),
        el('p', { text: 'Clear the search to see all traded comps again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear search', onclick: function () { state.q = ''; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: r.sector }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.ratio) }),
        el('td', { class: 'num', text: fmtUsd(r.fitted_usd) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Cleaned traded comps, by market cap. Fitted value is the kept model.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Sector' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Actual mcap' }), el('th', { scope: 'col', text: 'mcap / TVL' }), el('th', { scope: 'col', text: 'Fitted value' }))),
          tbody
        )
      )
    );
  }

  function scatter(points, line, band, title, sub) {
    var W = 320, H = 190, P = 26;
    var all = points.map(function (p) { return p.x; }).concat(points.map(function (p) { return p.y; }));
    if (line) all = all.concat([line[0][0], line[1][0]]);
    var x0 = Math.min.apply(null, all) - 0.3, x1 = Math.max.apply(null, all) + 0.3;
    var X = function (v) { return P + (v - x0) / (x1 - x0) * (W - 2 * P); };
    var Y = function (v) { return H - P - (v - x0) / (x1 - x0) * (H - 2 * P); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + title + '">';
    if (line) s += '<line x1="' + X(line[0][0]) + '" y1="' + Y(line[0][1]) + '" x2="' + X(line[1][0]) + '" y2="' + Y(line[1][1]) + '" class="diag"/>';
    if (band) { var b = Math.log10(3); s += '<line x1="' + X(x0) + '" y1="' + Y(x0 + b) + '" x2="' + X(x1) + '" y2="' + Y(x1 + b) + '" class="band"/><line x1="' + X(x0) + '" y1="' + Y(x0 - b) + '" x2="' + X(x1) + '" y2="' + Y(x1 - b) + '" class="band"/>'; }
    points.forEach(function (p) { s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="2"/>'; });
    return el('div', { class: 'scatter' }, el('h3', { text: title }), el('div', { html: s + '</svg>' }), el('p', { class: 'sub', text: sub }));
  }

  function modelPanel() {
    var m = DATA.model;
    var f = DATA.fit;
    var o = f.token_odds;
    var iv = f.intervals;
    var ch = f.chosen;
    var slices = DATA.rows.map(function (r) { return farmEcon(r).slice_usd; }).sort(function (a, b) { return a - b; });
    var gases = DATA.rows.map(function (r) { return farmEcon(r).gas_total; }).sort(function (a, b) { return a - b; });
    var medSlice = slices[Math.floor(slices.length / 2)];
    var medGas = gases[Math.floor(gases.length / 2)];
    var blindPts = f.blind_points.map(function (p) { return { x: Math.log10(p.pred_usd), y: Math.log10(p.actual_usd) }; });
    var bx0 = Math.min.apply(null, blindPts.map(function (p) { return Math.min(p.x, p.y); }));
    var bx1 = Math.max.apply(null, blindPts.map(function (p) { return Math.max(p.x, p.y); }));
    var curvePts = DATA.comps.map(function (c) { return { x: Math.log10(c.tvl_usd), y: Math.log10(c.mcap_usd) }; });
    var cx0 = Math.min.apply(null, curvePts.map(function (p) { return p.x; }));
    var cx1 = Math.max.apply(null, curvePts.map(function (p) { return p.x; }));
    var cy = function (x) { return f.curve.intercept / Math.LN10 + f.curve.slope * x; };
    var ladderRows = f.ladder.map(function (l) {
      return el('tr', null,
        el('td', { text: l.level + ' — ' + l.label }),
        el('td', { class: 'num', text: 'x' + fmtNum(l.loo_miss_x) + ' (' + fmtNum(l.loo_miss_log) + ' log)' }),
        el('td', { class: 'num', text: l.loo_within3 + '/' + l.loo_n }),
        el('td', { class: 'num', text: 'x' + fmtNum(l.wf_miss_x) + ' (' + fmtNum(l.wf_miss_log) + ' log)' }),
        el('td', { class: 'num', text: l.wf_within3 + '/' + l.wf_test_n }),
        el('td', { text: l.kept ? 'kept' : 'dropped' })
      );
    });
    var sectorRows = f.curve.sector_effects.map(function (e) {
      return el('tr', null,
        el('td', { text: e.sector }),
        el('td', { class: 'num', text: String(e.n) }),
        el('td', { class: 'num', text: (e.effect_log >= 0 ? '+' : '') + fmtNum(e.effect_log) }),
        el('td', { class: 'num', text: 'x' + fmtNum(Math.exp(e.effect_log)) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, fitted on the traded tokens here. No name is special-cased.' }),
      el('div', { class: 'formula' },
        'curve = exp(' + fmtNum(f.curve.intercept) + ' + ' + fmtNum(f.curve.slope) + ' x log(TVL))   [Theil-Sen, median pairwise slope]\n' +
        'TS value = curve x exp(sector effect)   [shrunk n/(n+4)]\n' +
        'ensemble = (2/3) category-multiple blend + (1/3) multivariate OLS\n' +
        'blended = exp( (1-' + fmtNum(ch.blend_weight) + ') x log(TS value) + ' + fmtNum(ch.blend_weight) + ' x log(ensemble value) )   [weight by grid search]\n' +
        'growth = (1 + clamp(7d growth, +-' + fmtNum(ch.growth_clamp) + '))^slope; age = clamp(exp(' + fmtNum(ch.age_shrink) + ' x age slope x (age - mean age)), 0.9, 1.15)\n' +
        'implied = round( blended x growth x age )   [kept level ' + f.final_level + ']\n' +
        'range = implied x P25–P75 of the leave-one-out residuals, young x' + fmtNum(iv.young_lo_factor) + '–x' + fmtNum(iv.young_hi_factor) + ', older x' + fmtNum(iv.old_lo_factor) + '–x' + fmtNum(iv.old_hi_factor)
      ),
      el('h3', { text: 'Blind-test ladder' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'fit' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Rung' }), el('th', { scope: 'col', text: 'Leave-one-out miss' }), el('th', { scope: 'col', text: 'Within 3x' }), el('th', { scope: 'col', text: 'Walk-forward miss (' + f.ladder[0].wf_test_n + ' newer comps)' }), el('th', { scope: 'col', text: 'Within 3x' }), el('th', { scope: 'col', text: 'Keep rule' }))),
          el('tbody', null, ladderRows)
        )
      ),
      el('p', { class: 'sub', text: 'Leave-one-out refits on the other ' + (f.ladder[0].loo_n - 1) + ' comps and predicts the held-out one; walk-forward fits on listings 900+ days old and tests on the ' + f.ladder[0].wf_test_n + ' newer ones. The size curve is the big win (x5.07 to x3.53); the sector helps both tests, so it stays. The blend alone (L3) helps neither, so it is dropped. L4 (blend + compressed growth and age) is kept on the combined miss: leave-one-out gets slightly worse (x3.24 to x3.33) while walk-forward gets better (x2.64 to x2.48), the same split the #3 entry reports. L4 stays because the combined miss improves and walk-forward is the time-ordered test.' }),
      el('h3', { text: 'Sector effects (log points, shrunk)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'fit' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Sector' }), el('th', { scope: 'col', text: 'Comps' }), el('th', { scope: 'col', text: 'Effect (log)' }), el('th', { scope: 'col', text: 'Multiplier' }))),
          el('tbody', null, sectorRows)
        )
      ),
      el('p', { class: 'sub', text: 'The curve alone explains R² = ' + fmtNum(f.curve.r2) + ' of log market cap over ' + f.comps_n + ' cleaned comps; the kept model reaches R² = ' + fmtNum(f.curve.final_r2) + '. The fit is weak either way, so implied values are order-of-magnitude reads, not prices. Comps were cleaned from ' + f.traded_n + ' traded tokens: ' + f.house_excluded + ' house-category out, ' + f.receipt_excluded + ' receipt out, ' + f.families_merged + ' family merges.' }),
      scatter(blindPts, [[bx0, bx0], [bx1, bx1]], true, 'Blind test: blind price vs actual cap',
        'Each dot is one traded comp, priced by a model fitted without it (leave-one-out). Dashed lines are 3x; ' + f.ladder.filter(function (l) { return l.level === f.final_level; })[0].loo_within3 + ' of ' + f.ladder[0].loo_n + ' land inside them.'),
      scatter(curvePts, [[cx0, cy(cx0)], [cx1, cy(cx1)]], false, 'Size curve: TVL vs market cap',
        'Each dot is one cleaned comp; the line is the Theil-Sen curve, slope ' + fmtNum(f.curve.slope) + ': a bigger TVL is worth less per dollar.'),
      el('h3', { text: 'Two-way value check' }),
      el('p', { class: 'sub', text: 'The Theil-Sen curve (+ sector) and the v4-style ensemble are fitted independently on the same ' + f.twoway.n + ' comps. They agree within 3x on ' + f.twoway.within3 + ' of them and within 2x on ' + f.twoway.within2 + '. Where they disagree, the blend splits the difference in log space at weight ' + fmtNum(ch.blend_weight) + '.' }),
      el('h3', { text: 'Intervals: do the bands hold?' }),
      el('p', { class: 'sub', text: 'Each row\u2019s range is its implied value times the P25–P75 of the leave-one-out residuals for its age group. Held out, the bands hold ' + iv.loo_hit_young + '/' + iv.loo_n_young + ' young comps and ' + iv.loo_hit_old + '/' + iv.loo_n_old + ' older ones (' + iv.loo_hit_all + '/' + iv.loo_n_all + ' overall), and ' + iv.wf_hit + '/' + iv.wf_n + ' on walk-forward.' }),
      el('h3', { text: 'Rank stability' }),
      el('p', { class: 'sub', text: 'Resampling the ' + f.comps_n + ' comps 200 times (fixed seed) and refitting gives each row a P10–P90 rank range, shown in the detail view. The median range is ' + f.refits.median_rank_width + ' ranks wide (90th percentile ' + f.refits.p90_rank_width + '); only ' + f.refits.rows_with_width_le_10 + ' of ' + DATA.board_size + ' rows stay within 10 ranks. The ordering is fragile, and the ranges say so on every row.' }),
      el('h3', { text: 'Token odds (separate column)' }),
      el('p', { class: 'sub', text: 'Logistic regression on all ' + DATA.census.total + ' protocols: outcome "records a token". logit = ' + fmtNum(o.intercept) + ' + ' + fmtNum(o.per_log10_tvl) + ' x log10(TVL) + ' + fmtNum(o.per_age_year) + ' x age in years. AUC ' + fmtNum(o.auc) + ' (base rate ' + Math.round(o.base_rate * 100) + '%). ' + Math.round(o.young_rate * 100) + '% of protocols under 6 months old record a token, against ' + Math.round(o.old_rate * 100) + '% of those over 2 years old.' }),
      el('div', { class: 'model-grid' },
        el('div', { class: 'model-cell' }, el('b', { text: 'Fitted, not guessed' }), 'The size curve, the sector effects and the ensemble come from the ' + f.comps_n + ' cleaned traded tokens in this snapshot; the ladder scores every term on comps the fit never saw, two ways.'),
        el('div', { class: 'model-cell' }, el('b', { text: 'Why growth and age stay' }), 'Seven-day growth and the time a protocol has run with no token are in the model, compressed: the fitted age slope is ' + fmtNum(ch.age_slope_log_per_year) + ' log points a year (older comps price lower), shrunk by ' + fmtNum(ch.age_shrink) + ' and clamped to [0.9, 1.15]; growth is clamped to +-' + fmtNum(ch.growth_clamp) + ' and raised to the curve slope. The grid picked the shrink; the clamp was tied, so it takes the #3 entry\u2019s +-40%. They stay because walk-forward improves though leave-one-out gets slightly worse.'),
        el('div', { class: 'model-cell' }, el('b', { text: 'Farm verdicts' }), 'Every farm plan is costed on a $1,000 ticket at a 10% airdrop share: slice by dollar-days, less gas, less the 4% T-bill the ticket gives up. Farm when the net is positive, Thin when the slice covers gas, Skip below that. ' + verdictCounts().Farm + ' Farm, ' + verdictCounts().Thin + ' Thin, ' + verdictCounts().Skip + ' Skip. Skip stays high because the verdict is gas-dominated: the median slice is ' + fmtShortUsd(medSlice) + ' against median gas of ' + fmtShortUsd(medGas) + ', and a 90-day plan on Ethereum burns $120 of gas. No threshold was moved to chase another board\u2019s distribution.')
      ),
      el('p', { class: 'sub', text: 'The board says a protocol records no token, never that it has none. Gas allowances in the farm plans are the plan\u2019s own stated allowances, not a live quote.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function compName(slug) {
    var hit = null;
    DATA.comps.forEach(function (c) { if (c.slug === slug) hit = c.name; });
    return hit === null ? slug : hit;
  }

  function farmSection(row) {
    var econ = farmEcon(row, detailState.ticket, detailState.share);
    var steps = farmSteps(row, detailState.ticket, detailState.share);
    var section = el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — $' + econ.ticket + ' ticket, ' + Math.round(econ.share * 100) + '% share' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Slice (dollar-days)' }), el('b', { class: 'num', text: fmtShortUsd(econ.slice_usd) })),
        el('div', null, el('span', { text: 'Gas (' + econ.weeks + ' weeks + entry + claim on ' + econ.chain + ')' }), el('b', { class: 'num', text: fmtShortUsd(econ.gas_total) })),
        el('div', null, el('span', { text: 'T-bill given up (4% over ' + econ.hold_days + ' days)' }), el('b', { class: 'num', text: fmtShortUsd(econ.tbill_usd) })),
        el('div', null, el('span', { text: 'Net' }), el('b', { class: 'num', text: fmtShortUsd(econ.net_usd) })),
        el('div', null, el('span', { text: 'Break-even ticket' }), el('b', { class: 'num', text: econ.breakeven_ticket === null ? 'none' : fmtShortUsd(econ.breakeven_ticket) })),
        el('div', null, el('span', { text: 'Per hour (' + econ.minutes + ' minutes)' }), el('b', { class: 'num', text: fmtPerHour(econ.per_hour_usd) })),
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: econ.verdict }))
      ),
      el('div', { class: 'knobs' },
        el('label', null, 'Ticket ',
          (function () {
            var s = el('select', { 'aria-label': 'Ticket size' },
              [100, 500, 1000, 5000].map(function (t) { return el('option', { value: String(t), text: '$' + t, selected: t === detailState.ticket ? 'selected' : null }); }));
            s.addEventListener('change', function () { detailState.ticket = Number(s.value); openDetail(row.slug); });
            return s;
          })()),
        el('label', null, 'Share ',
          (function () {
            var s = el('select', { 'aria-label': 'Airdrop share' },
              [0.05, 0.10, 0.20].map(function (v) { return el('option', { value: String(v), text: Math.round(v * 100) + '%', selected: v === detailState.share ? 'selected' : null }); }));
            s.addEventListener('change', function () { detailState.share = Number(s.value); openDetail(row.slug); });
            return s;
          })()),
        el('span', { class: 'sub', text: 'Changing ticket or share recomputes the slice, net, break-even and verdict.' })
      ),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    );
    return section;
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var calc = impliedOf(row);
    var odds = tokenOddsOf(row);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' (rank ' + row.rank_lo + '–' + row.rank_hi + ' over 200 refits)' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + row.sector + ' sector · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — how it is built, term by term' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Size curve (Theil-Sen)' }), el('b', { class: 'num', text: fmtUsd(calc.curveUsd) })),
        el('div', null, el('span', { text: 'Sector effect (' + row.sector + ')' }), el('b', { class: 'num', text: 'x' + fmtNum(Math.exp(sectorEffect(row.sector))) })),
        el('div', null, el('span', { text: 'TS value (curve x sector)' }), el('b', { class: 'num', text: fmtUsd(calc.tsUsd) })),
        el('div', null, el('span', { text: 'Ensemble value' }), el('b', { class: 'num', text: fmtUsd(calc.ensembleUsd) })),
        el('div', null, el('span', { text: 'Blended value (weight ' + fmtNum(DATA.fit.chosen.blend_weight) + ' on the ensemble)' }), el('b', { class: 'num', text: fmtUsd(calc.blendedUsd) })),
        el('div', null, el('span', { text: 'Growth multiplier (compressed)' }), el('b', { class: 'num', text: fmtMult(calc.growthMult) })),
        el('div', null, el('span', { text: 'Age multiplier (compressed)' }), el('b', { class: 'num', text: fmtMult(calc.ageMult) })),
        el('div', null, el('span', { text: 'Two-way check' }), el('b', { class: 'num', text: (function () { var r = Math.max(calc.tsUsd / calc.ensembleUsd, calc.ensembleUsd / calc.tsUsd); return (r <= 3 ? 'within 3x (x' : 'differ by x') + r.toFixed(2) + ')'; })() })),
        el('div', null, el('span', { text: 'Token odds' }), el('b', { class: 'num', text: fmtOdds(odds) })),
        el('div', null, el('span', { text: 'Odds-adjusted value' }), el('b', { class: 'num', text: fmtUsd(Math.round(row.implied_value_usd * odds)) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Range (P25–P75)' }), el('b', { class: 'num', text: fmtUsd(row.low_usd) + ' – ' + fmtUsd(row.high_usd) })),
        el('div', null, el('span', { text: 'Rank range (200 refits)' }), el('b', { class: 'num', text: row.rank_lo + '–' + row.rank_hi }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + '. The page recomputes this row as ' + fmtUsd(calc.implied) + (calc.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Priced against these comps' }),
      el('p', { class: 'sub', text: 'The three nearest traded comps in the ' + row.sector + ' sector, by TVL: ' +
        row.comps.map(function (s) { return compName(s); }).join(', ') + '.' })
    ));
    dialog.appendChild(farmSection(row));
    dialog.appendChild(el('p', { class: 'note', text: 'This protocol records no token in the snapshot — DefiLlama\u2019s record, not proof.' }));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    var old = app.querySelector('.shell');
    if (old) old.remove();
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else if (state.tab === 'set-aside') shell.appendChild(setAsideTable());
    else shell.appendChild(compTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Source: DefiLlama protocol index, snapshot ' + DATA.as_of + '. Implied values are this radar\u2019s own model, not prices and not predictions of a launch.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
  // Build-time consistency check: the checker recomputes every row through these.
  window.__radarCheck = { impliedOf: impliedOf, tokenOddsOf: tokenOddsOf, farmEcon: farmEcon, farmSteps: farmSteps };
})();
