// Token Radar dashboard (radar-5). Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, filters, a per-protocol
// detail view with the model's own inputs, the fitted comps, and the
// protocol's costed farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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

  // The fitted model, in the same arithmetic main.ts runs: category multiple
  // (fitted median mcap/TVL, n >= 5, else the global median, clamped) and
  // the log-log curve, blended in log space, ensembled 2/3 + 1/3 with the
  // multivariate leg (log TVL, age, chains, per-category intercepts), then
  // growth, age and chains. No name is special-cased. The page recomputes
  // a row and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic.
  function categoryMultiple(category) {
    var m = DATA.model;
    var found = null;
    DATA.fit.category_multiples.forEach(function (c) { if (c.category === (category || 'Other')) found = c.median; });
    var raw = found === null ? DATA.fit.global_median_multiple : found;
    return Math.min(m.multiple_cap, Math.max(m.multiple_floor, raw));
  }
  function multiPredict(row) {
    var o = DATA.fit.multivariate;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var pred = o.intercept + o.per_log_tvl * Math.log(row.tvl_usd) + o.per_age_year * (age / 365) +
      o.per_log_chains * Math.log1p(row.chains ? row.chains.length : 0);
    var hit = null;
    o.category_intercepts.forEach(function (c) { if (c.category === (row.category || 'Other')) hit = c.intercept; });
    if (hit !== null) pred += hit;
    return Math.exp(pred);
  }
  function impliedOf(row) {
    var m = DATA.model;
    var multiple = categoryMultiple(row.category);
    var categoryUsd = row.tvl_usd * multiple;
    var curveUsd = Math.exp(DATA.fit.loglog_intercept + DATA.fit.loglog_slope * Math.log(row.tvl_usd));
    var w = m.blend_weight;
    var blendUsd = Math.exp(w * Math.log(categoryUsd) + (1 - w) * Math.log(curveUsd));
    var olsUsd = multiPredict(row);
    var ew = m.ensemble_weight;
    var baseUsd = Math.exp((1 - ew) * Math.log(blendUsd) + ew * Math.log(olsUsd));
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor,
      row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var ageMult = m.age_floor + (Math.min(Math.max(age, 0), m.age_days) / m.age_days) * m.age_range;
    var chains = row.chains ? row.chains.length : 0;
    var chainMult = 1 + m.chain_step * Math.min(Math.max(chains - 1, 0), m.chain_max_extra);
    var implied = Math.max(1, Math.round(baseUsd * growthMult * ageMult * chainMult));
    return { implied: implied, multiple: multiple, categoryUsd: categoryUsd, curveUsd: curveUsd, blendUsd: blendUsd,
      olsUsd: olsUsd, baseUsd: baseUsd,
      growthPct: growth, growthMult: growthMult, ageMult: ageMult, chainMult: chainMult, age: age };
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

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold,
  // the gas and the verdict. No name is special-cased.
  var GAS_USD = { Ethereum: 8, Bitcoin: 5, Solana: 0.01, Tron: 1, Bittensor: 1, Binance: 0.3, Polygon: 0.1, Avalanche: 0.5 };
  var L2_CHAINS = ['Base', 'Arbitrum', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mode', 'Ink', 'Mantle', 'Unichain', 'Abstract', 'Berachain', 'Sonic', 'Fraxtal', 'Gravity', 'Sei', 'Starknet', 'Polygon zkEVM', 'opBNB'];
  function gasUsd(chain) {
    if (Object.prototype.hasOwnProperty.call(GAS_USD, chain)) return GAS_USD[chain];
    if (L2_CHAINS.indexOf(chain) >= 0) return 0.5;
    return 2;
  }
  function gasText(gas) { return gas >= 1 ? '$' + gas : '$' + gas.toFixed(2); }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
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
  function fmtShortUsd(n) {
    if (n >= 1e6) return '$' + (Math.round((n / 1e6) * 10) / 10).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function farmVerdict(oddsAdjusted, gasTotal) {
    var m = DATA.model;
    var v = oddsAdjusted >= m.verdict_farm_odds_usd ? 'Farm'
      : oddsAdjusted >= m.verdict_thin_odds_usd ? 'Thin'
      : oddsAdjusted >= m.verdict_watch_odds_usd ? 'Watch' : 'Skip';
    if (gasTotal > m.gas_downgrade_usd && oddsAdjusted < m.verdict_gas_cap_usd) v = v === 'Farm' ? 'Thin' : v === 'Thin' ? 'Watch' : 'Skip';
    return v;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas1 = gasUsd(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var secondChain = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var gas2 = secondChain !== null ? gasUsd(secondChain) : gas1;
    var gasTotal = Math.round((gas1 + gas1 * 4 + gas2 + gas1) * 100) / 100;
    var capitalTotal = secondChain !== null ? capital * 2 : capital;
    var odds = tokenOddsOf(p);
    var oddsAdjusted = Math.round(p.implied_value_usd * odds);
    var verdict = farmVerdict(oddsAdjusted, gasTotal);
    var why = verdict === 'Farm'
      ? 'the ' + fmtShortUsd(p.implied_value_usd) + ' implied value, ' + fmtShortUsd(oddsAdjusted) + ' after ' + Math.round(odds * 100) + '% token odds, is worth about ' + gasText(gasTotal) + ' of gas and $' + capitalTotal + ' locked for ' + hold + ' days'
      : verdict === 'Thin'
        ? 'the ' + fmtShortUsd(p.implied_value_usd) + ' implied value, ' + fmtShortUsd(oddsAdjusted) + ' after ' + Math.round(odds * 100) + '% token odds, only just covers about ' + gasText(gasTotal) + ' of gas and $' + capitalTotal + ' locked for ' + hold + ' days, so farm small and only on cheap gas'
        : verdict === 'Watch'
          ? 'the ' + fmtShortUsd(p.implied_value_usd) + ' implied value is only ' + fmtShortUsd(oddsAdjusted) + ' after ' + Math.round(odds * 100) + '% token odds, so watch it and farm only the cheapest chain with the smallest size'
          : 'the ' + fmtShortUsd(p.implied_value_usd) + ' implied value is only ' + fmtShortUsd(oddsAdjusted) + ' after ' + Math.round(odds * 100) + '% token odds and does not cover about ' + gasText(gasTotal) + ' of gas and $' + capitalTotal + ' locked for ' + hold + ' days';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: '$0, no transaction, only setup', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital, returned when you unwind, and about ' + gasText(gas1) + ' of gas on ' + chain, time: '15 minutes to set up' },
      { text: weeklyFor(p, capital, chain), cost: 'about ' + gasText(gas1) + ' of gas a week on ' + chain, time: '10 minutes a week' },
      { text: secondChain !== null ? 'Repeat the same position on ' + secondChain + ' so the activity is counted on two chains, not one.' : 'After two weeks, add a second position of the same size so the activity is counted twice.', cost: 'another $' + capital + ' of capital, returned when you unwind, and about ' + gasText(gas2) + ' of gas', time: '15 minutes' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: '$' + capitalTotal + ' stays locked in the position, $0 out of pocket', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, about ' + gasText(gas1) + ' of gas only if you claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log. Verdict: ' + verdict + ' — ' + why + '.', cost: '$0 to log', time: '5 minutes' }
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

  function lede() {
    var c = DATA.census;
    var f = DATA.fit;
    var blend = null;
    f.oos.forEach(function (m) { if (m.method === 'ensemble') blend = m; });
    var censusLine = c.total + ' protocols accounted for: ' + c.ranked + ' ranked pre-token, ' +
      c.traded_mcap + ' traded with a market cap, ' + c.token_recorded_no_mcap +
      ' with a token recorded but no market cap, ' + c.pretoken_excluded + ' pre-token excluded (' +
      c.excluded_by.map(function (e) { return e.reason + ' ' + e.n; }).join(', ') + ').';
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by fitted implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more clean pre-token protocols below that floor, every one the snapshot records, ranked by a value model fitted on the traded tokens. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: c.watchlist_covered + ' / ' + c.watchlist })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Traded comps fitted' }), el('b', { text: String(f.comps_n) })),
        el('div', { class: 'fact' }, el('span', { text: 'Log-log fit R² (in-sample)' }), el('b', { text: fmtNum(f.loglog_r2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Held-out median |log error| (ensemble)' }), el('b', { text: blend ? fmtNum(blend.median_abs_log_error) : 'n/a' })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) }))
      ),
      funnel(),
      el('p', { class: 'census', text: censusLine })
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
      el('p', { class: 'sub', text: 'From no-token to ranked, ' + c.pretoken_excluded + ' protocols are left out: ' +
        c.excluded_by.map(function (e) { return e.reason + ' (' + e.n + ')'; }).join(', ') +
        '. The watchlist is the floor, never the ceiling: ' + DATA.early_size + ' ranked rows sit below its $50M floor.' })
    );
  }

  function selectField(label, id, options, value, onChange) {
    var select = el('select', { id: id, 'aria-label': label },
      options.map(function (o) { return el('option', { value: o.value, text: o.label, selected: o.value === value ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { onChange(select.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
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
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'), tabBtn('comps', 'Comps'))),
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
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Token odds'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
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
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
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
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.ratio) }),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', { class: 'num', text: fmtUsd(r.fitted_usd) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Traded comps the model is fitted on, by market cap. Actual mcap is the market talking; fitted value is the blend of the category multiple and the log-log curve, before any growth, age or chain adjustment.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Actual mcap' }), el('th', { scope: 'col', text: 'mcap / TVL' }), el('th', { scope: 'col', text: 'Fitted multiple' }), el('th', { scope: 'col', text: 'Fitted value' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var f = DATA.fit;
    var o = f.token_odds;
    var multRows = f.category_multiples.map(function (c) {
      var hit = null;
      f.multivariate.category_intercepts.forEach(function (d) { if (d.category === c.category) hit = d.intercept; });
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.n) }),
        el('td', { class: 'num', text: fmtMult(c.median) }),
        el('td', { class: 'num', text: hit === null ? 'baseline' : (hit >= 0 ? '+' : '') + hit.toFixed(2) })
      );
    });
    multRows.push(el('tr', null,
      el('td', { text: 'All other categories (global median)' }),
      el('td', { class: 'num', text: String(f.comps_n) }),
      el('td', { class: 'num', text: fmtMult(f.global_median_multiple) }),
      el('td', { class: 'num', text: 'baseline' })
    ));
    var curveRows = f.category_curves.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.n) }),
        el('td', { class: 'num', text: fmtNum(c.slope) })
      );
    });
    var levels = f.multivariate.category_intercepts.slice().sort(function (a, b) { return b.intercept - a.intercept; });
    var topLevel = levels[0];
    var bottomLevel = levels[levels.length - 1];
    var cvRows = f.cv.map(function (r) {
      return el('tr', null,
        el('td', { text: r.method }),
        el('td', { class: 'num', text: fmtNum(r.mean_median_abs_log_error) }),
        el('td', { class: 'num', text: r.fold_medians.map(function (x) { return fmtNum(x); }).join(', ') })
      );
    });
    var oosRows = f.oos.map(function (r) {
      return el('tr', null,
        el('td', { text: r.method }),
        el('td', { class: 'num', text: fmtNum(r.median_abs_log_error) }),
        el('td', { class: 'num', text: fmtNum(r.mean_abs_log_error) }),
        el('td', { class: 'num', text: fmtNum(r.oos_r2) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — and how well it fits' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function fitted on the traded tokens in this same snapshot. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'blend = exp( 0.5 x log(TVL x category multiple) + 0.5 x log(exp(' + fmtNum(f.loglog_intercept) + ' + ' + fmtNum(f.loglog_slope) + ' x log(TVL))) )\n' +
        'multi = exp(' + fmtNum(f.multivariate.intercept) + ' + ' + fmtNum(f.multivariate.per_log_tvl) + ' x log(TVL) + ' + fmtNum(f.multivariate.per_age_year) + ' x age_years + ' + fmtNum(f.multivariate.per_log_chains) + ' x log1p(chains) + category level)\n' +
        'base = exp( (2/3) x log(blend) + (1/3) x log(multi) )\n' +
        'implied = round( base x growth x age x chains )\n' +
        'growth = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + '\n' +
        'age = ' + m.age_floor + ' + min(age_days, ' + m.age_days + ') / ' + m.age_days + ' x ' + m.age_range + '   (age with no token; unknown counts as 365 days)\n' +
        'chains = 1 + 0.02 x min(chains - 1, 5)'
      ),
      el('h3', { text: 'Fitted category multiples (median mcap / TVL, traded comps)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'fit' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Comps' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'OLS level' }))),
          el('tbody', null, multRows)
        )
      ),
      el('p', { class: 'sub', text: 'OLS level is the multivariate leg\u2019s per-category intercept in log space (a category with fewer than 5 comps shares the baseline, 0). ' + (topLevel ? topLevel.category + ' prices about e^' + topLevel.intercept.toFixed(1) + ' above the baseline at the same size, age and chains; ' + bottomLevel.category + ' about e^' + bottomLevel.intercept.toFixed(1) + ' below it.' : '') }),
      el('h3', { text: 'One curve does not fit all (per-category log-log slopes, n >= 8)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'fit' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Comps' }), el('th', { scope: 'col', text: 'Slope' }))),
          el('tbody', null, curveRows)
        )
      ),
      el('p', { class: 'sub', text: 'Log-log fit over ' + f.comps_n + ' comps: log(mcap) = ' + fmtNum(f.loglog_intercept) + ' + ' + fmtNum(f.loglog_slope) + ' x log(TVL), R² = ' + fmtNum(f.loglog_r2) + '. The multivariate leg (log TVL, age, chains, per-category levels) reaches R² = ' + fmtNum(f.multivariate.r2) + '. The fit is weak either way — TVL and friends explain about a quarter of market cap at best — so implied values are order-of-magnitude reads, not prices.' }),
      el('h3', { text: 'Held-out test (fit on ' + f.oos_train_n + ' comps, scored on ' + f.oos_test_n + ' unseen comps)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'fit' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Predictor' }), el('th', { scope: 'col', text: 'Median |log error|' }), el('th', { scope: 'col', text: 'Mean |log error|' }), el('th', { scope: 'col', text: 'Out-of-sample R²' }))),
          el('tbody', null, oosRows)
        )
      ),
      el('p', { class: 'sub', text: 'A median |log error| of 1.0 means the typical prediction is off by a factor of e (about 2.7x). On this one split the blend still wins on median error while the ensemble wins on mean error and out-of-sample R²; the ensemble\u2019s claim rests on the 5-fold average below, not on this split alone. Nothing here is claimed to be precise.' }),
      el('h3', { text: '5-fold cross-validation (each fold 25-26 unseen comps)' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'fit' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Predictor' }), el('th', { scope: 'col', text: 'Mean of fold medians' }), el('th', { scope: 'col', text: 'Fold medians' }))),
          el('tbody', null, cvRows)
        )
      ),
      el('p', { class: 'sub', text: 'One held-out split of 26 comps is noisy — fold medians swing by half a log point — so the ensemble is judged on this average across all five folds, where it beats the blend and every single estimator. A reader who trusts only the single split can read the table above it instead.' }),
      el('h3', { text: 'Token odds (separate column, not multiplied into implied value)' }),
      el('p', { class: 'sub', text: 'Logistic regression on all ' + DATA.census.total + ' protocols: outcome "records a token" (a gecko id, symbol or market cap on record). logit = ' + fmtNum(o.intercept) + ' + ' + fmtNum(o.per_log10_tvl) + ' x log10(TVL) + ' + fmtNum(o.per_age_year) + ' x age in years. AUC ' + fmtNum(o.auc) + ' (base rate ' + Math.round(o.base_rate * 100) + '%). In the snapshot, ' + Math.round(o.young_rate * 100) + '% of protocols under 6 months old record a token, against ' + Math.round(o.old_rate * 100) + '% of those over 2 years old: older protocols are more likely to have one, so a pre-token protocol that has run a long time without one is the interesting case. The detail view shows implied value x odds as the odds-adjusted value.' }),
      el('div', { class: 'model-grid' },
        el('div', { class: 'model-cell' }, el('b', { text: 'Fitted, not guessed' }), 'Category multiples and the TVL curve come from the 128 traded tokens in this snapshot; the held-out test scores them on comps the fit never saw.'),
        el('div', { class: 'model-cell' }, el('b', { text: 'Growth and age' }), 'Seven-day TVL growth and the time a protocol has run with no token on record both lift its value; an unlisted age counts as 365 days.'),
        el('div', { class: 'model-cell' }, el('b', { text: 'Farm verdicts' }), 'Every farm plan ends Farm, Thin, Watch or Skip, judged on the odds-adjusted value (implied x token odds): $10M or more farms, $2M-$10M is thin, $0.5M-$2M is watch, under $0.5M skips, downgraded a step when the plan burns over $50 of gas. Capital is locked, not spent.')
      ),
      el('p', { class: 'sub', text: 'The board says a protocol records no token, never that it has none: DefiLlama may not carry a token a protocol already has. Gas allowances in the farm plans (Ethereum about $8 a transaction, big L2s about $0.50, Solana about $0.01) are the plan\u2019s own stated allowances, not a live quote.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var calc = impliedOf(row);
    var odds = tokenOddsOf(row);
    var steps = farmSteps(row);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Category multiple (fitted)' }), el('b', { class: 'num', text: fmtMult(calc.multiple) })),
        el('div', null, el('span', { text: 'Category estimate (TVL x multiple)' }), el('b', { class: 'num', text: fmtUsd(calc.categoryUsd) })),
        el('div', null, el('span', { text: 'Log-log curve estimate' }), el('b', { class: 'num', text: fmtUsd(calc.curveUsd) })),
        el('div', null, el('span', { text: 'Blend (category + curve)' }), el('b', { class: 'num', text: fmtUsd(calc.blendUsd) })),
        el('div', null, el('span', { text: 'Multivariate leg (size, age, chains, category)' }), el('b', { class: 'num', text: fmtUsd(calc.olsUsd) })),
        el('div', null, el('span', { text: 'Ensemble base (2/3 blend + 1/3 multivariate)' }), el('b', { class: 'num', text: fmtUsd(calc.baseUsd) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(calc.growthMult) })),
        el('div', null, el('span', { text: 'Age multiplier' }), el('b', { class: 'num', text: fmtMult(calc.ageMult) })),
        el('div', null, el('span', { text: 'Chains multiplier' }), el('b', { class: 'num', text: fmtMult(calc.chainMult) })),
        el('div', null, el('span', { text: 'Token odds' }), el('b', { class: 'num', text: fmtOdds(odds) })),
        el('div', null, el('span', { text: 'Odds-adjusted value' }), el('b', { class: 'num', text: fmtUsd(Math.round(row.implied_value_usd * odds)) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(calc.implied) + (calc.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(el('p', { class: 'note', text: 'This protocol records no token in the snapshot. That is DefiLlama\u2019s record, not proof it has none.' }));
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
})();
