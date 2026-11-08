import { el, fmt, setTitle, hrefTo, navigate, clear, append, groupBy, mean, winRate, countryName, median } from '../util.js';
import { api, fetchPlayerGames, relic, relicAvailable, cachedAt, invalidate, urls } from '../api.js';
import { renderOverview, sessionize, sessionHeader, perspective } from './player_overview.js';
import { avatarImg, countryFlag, socialLinks, rankBadge, statTile, modeTabs, civChip, dataTable, gameRow, subTabs, select, skeleton, errorBox, emptyState, notice, card, wrCell, divBar, streakEl, segmented, flattenTeams, playerLink, resultPill } from '../components.js';
import { lineChart, sparkline } from '../charts.js';
import { PROFILE_MODES, MODE, LB, modeName, civName, kindName, parseRankLevel, RELIC_LEADERBOARD_NAMES, RELIC_MATCHTYPE_NAMES } from '../constants.js';
import { fillAsync, ratingHistoryPoints, modesWithData, defaultMode, gamesFilterFor, companionHint } from './_shared.js';

export async function render(app, route) {
  const id = route.parts[1];
  const holder = el('div');
  app.append(holder);
  holder.append(skeleton(6, { height: 22 }));
  let player;
  try { player = await api.player(id); }
  catch (e) { clear(holder); holder.append(errorBox(e, () => render(app, route))); return; }
  clear(holder);
  setTitle(player.name);

  const modes = modesWithData(player);
  const modeKey = MODE[route.query.mode] && player.modes?.[route.query.mode] ? route.query.mode : defaultMode(player);
  const mode = player.modes?.[modeKey] || {};
  const tab = route.query.tab || 'matches';
  const link = (patch) => hrefTo(`/player/${id}`, { mode: modeKey, tab, ...patch });

  /* ---------- side data: ladder size (percentile), the player's ladder entry (Twitch live), recent games (overview) ---------- */
  const isPublicLb = !!LB[modeKey];
  const lbTotalP = isPublicLb ? api.leaderboard(modeKey).catch(() => null) : Promise.resolve(null);
  const lbEntryP = isPublicLb ? api.leaderboard(modeKey, { profile_id: id }).catch(() => null) : Promise.resolve(null);
  const gamesP = fetchPlayerGames(id, {}, 4).catch(() => ({ games: [], total: 0 }));
  const liveBanner = el('div');
  const twitchPill = el('span');
  const pctEl = el('span', { class: 'muted small' });
  holder.append(liveBanner);

  /* ---------- header ---------- */
  const lastGame = Object.values(player.modes || {}).map(m => m.last_game_at).filter(Boolean).sort().at(-1);
  const fetchedAt = cachedAt(urls.player(id));
  const refresh = () => { invalidate(`/players/${id}`); clear(app); render(app, route); };
  holder.append(el('section', { class: 'card profile-head' },
    avatarImg(player, 'avatar-lg', 'medium'),
    el('div', { style: { minWidth: 0 } },
      el('div', { class: 'title' }, el('h1', {}, player.name), countryFlag(player.country), el('span', { class: 'muted' }, countryName(player.country)), twitchPill),
      el('div', { class: 'subline' },
        lastGame ? el('span', {}, 'Last game ', el('strong', { title: fmt.dateTime(lastGame) }, fmt.rel(lastGame))) : null,
        el('span', { class: 'muted' }, `Profile #${player.profile_id}`),
        socialLinks(player.social, player.steam_id),
        el('span', { class: 'muted small freshness' }, fetchedAt ? `Updated ${fmt.rel(fetchedAt)}` : 'Updated just now', ' · ', el('button', { class: 'linkish', type: 'button', onClick: refresh }, 'Refresh')))),
    el('div', { class: 'actions' },
      el('a', { class: 'btn primary', href: hrefTo(`/compare/${id}`) }, 'Compare with…'),
      el('a', { class: 'btn', href: player.site_url?.replace('http://', 'https://') || `https://aoe4world.com/players/${id}`, target: '_blank', rel: 'noopener' }, 'AoE4 World ↗'))));

  /* ---------- mode tabs ---------- */
  const publicModes = modes.filter(m => !m.hidden), hiddenModes = modes.filter(m => m.hidden);
  holder.append(el('div', { class: 'mode-tabs' },
    publicModes.length ? modeTabs(publicModes, modeKey, k => hrefTo(`/player/${id}`, { mode: k, tab })) : el('span', { class: 'muted' }, 'No ladder games on record.'),
    hiddenModes.length ? el('span', { class: 'muted' }, '· hidden ELO: ') : null,
    hiddenModes.length ? modeTabs(hiddenModes, modeKey, k => hrefTo(`/player/${id}`, { mode: k, tab })) : null));

  /* ---------- career ribbon (season finishes for ranked modes) ---------- */
  {
    const seasons = [];
    if (mode.season && (mode.games_count || mode.rating)) seasons.push({ ...mode, current: true });
    for (const s of mode.previous_seasons || []) seasons.push(s);
    if (seasons.length > 1) {
      holder.append(el('div', { class: 'ribbon', 'aria-label': 'Season history' },
        el('span', { class: 'muted small' }, 'Seasons'),
        seasons.sort((a, b) => (b.season || 0) - (a.season || 0)).map(s => {
          const r = parseRankLevel(s.rank_level);
          return el('a', { class: `ribbon-chip ${s.current ? 'current' : ''}`, href: hrefTo(`/player/${id}`, { mode: modeKey, tab: 'seasons' }), title: `Season ${s.season}: ${r.label}, ${fmt.int(s.rating)} rating, ${fmt.int(s.wins_count)}W – ${fmt.int(s.losses_count)}L${s.rank ? `, #${fmt.int(s.rank)}` : ''}`, style: { '--tier': `var(--tier-${r.tier})` } },
            el('span', { class: 'gem' }), el('span', {}, `S${s.season}`), el('strong', {}, r.short), el('span', { class: 'muted' }, fmt.int(s.rating)));
        })));
    }
  }

  /* ---------- tiles ---------- */
  const pts = ratingHistoryPoints(mode);
  const rl = parseRankLevel(mode.rank_level);
  const since7d = pts.filter(p => p.x > Date.now() - 7 * 86400e3);
  const delta7 = since7d.length > 1 ? (since7d.at(-1).y - since7d[0].y) : null;
  holder.append(el('div', { class: 'tiles' },
    statTile({ label: `${modeName(modeKey)} rating`, value: fmt.int(mode.rating), delta: delta7, deltaGood: true, sub: delta7 !== null ? 'last 7 days' : (mode.rating ? 'no games in 7 days' : 'unrated'), spark: pts.length > 1 ? sparkline(pts.slice(-30)) : null }),
    statTile({ label: 'Rank', value: mode.rank ? `#${fmt.int(mode.rank)}` : '—', sub: el('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, rl.label !== 'Unranked' ? rankBadge(mode.rank_level, { sm: true }) : (MODE[modeKey]?.ranked ? 'Unranked this season' : 'Quick match has no tiers'), pctEl) }),
    statTile({ label: 'Win rate', value: fmt.pct(mode.win_rate, 1), sub: `${fmt.int(mode.wins_count)} W – ${fmt.int(mode.losses_count)} L` }),
    statTile({ label: 'Streak', value: streakEl(mode.streak), sub: mode.streak > 0 ? 'wins in a row' : mode.streak < 0 ? 'losses in a row' : 'no streak' }),
    statTile({ label: 'Games', value: fmt.int(mode.games_count), unit: mode.season ? `season ${mode.season}` : 'total', sub: mode.drops_count ? `${mode.drops_count} drops` : null }),
    statTile({ label: 'Peak rating', value: fmt.int(mode.max_rating), sub: mode.max_rating_1m ? `30-day peak ${fmt.int(mode.max_rating_1m)}` : null })));

  /* ---------- rating chart ---------- */
  const chartBox = el('div');
  const rangeOpts = [{ value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: '1y', label: '1 year' }, { value: 'all', label: 'All' }];
  let range = route.query.range || 'all';
  const seriesOpts = [];
  seriesOpts.push({ value: modeKey, label: MODE[modeKey]?.hidden ? modeName(modeKey) : 'Season rating' });
  const eloTwin = { rm_solo: 'rm_1v1_elo', rm_team: 'rm_2v2_elo' }[modeKey];
  if (eloTwin && player.modes?.[eloTwin]?.rating_history) seriesOpts.push({ value: eloTwin, label: 'All-time ELO' });
  let seriesKey = modeKey;
  const drawChart = () => {
    const src = ratingHistoryPoints(player.modes?.[seriesKey]);
    const cut = { '30d': 30, '90d': 90, '1y': 365 }[range];
    const filtered = cut ? src.filter(p => p.x > Date.now() - cut * 86400e3) : src;
    clear(chartBox);
    chartBox.append(lineChart({ series: [{ name: seriesKey === modeKey ? modeName(modeKey) : 'All-time ELO', color: '--s1', points: filtered }], height: 260, emptyText: cut ? 'No games in this range.' : 'Rating history is not available for this mode yet.' }));
    if (src.length) chartBox.append(el('p', { class: 'muted small', style: { margin: '8px 0 0' } }, `${fmt.int(src.length)} rating snapshots · one point per game. ${MODE[modeKey]?.ranked && !MODE[modeKey]?.hidden ? 'Seasonal ratings reset each season; switch to All-time ELO for the long view.' : ''}`));
  };
  const rangeSeg = segmented(rangeOpts, range, v => { range = v; rangeSeg.replaceWith(rangeSegFactory()); drawChart(); }, { ariaLabel: 'Time range' });
  let rangeSegEl = rangeSeg;
  function rangeSegFactory() { rangeSegEl = segmented(rangeOpts, range, v => { range = v; const n = rangeSegFactory(); rangeSegEl.replaceWith(n); drawChart(); }, { ariaLabel: 'Time range' }); return rangeSegEl; }
  let seriesSegEl = null;
  function seriesSegFactory() { seriesSegEl = segmented(seriesOpts, seriesKey, v => { seriesKey = v; const n = seriesSegFactory(); seriesSegEl.replaceWith(n); drawChart(); }, { ariaLabel: 'Rating series' }); return seriesSegEl; }
  holder.append(card('Rating history', chartBox, { actions: el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, seriesOpts.length > 1 ? seriesSegFactory() : null, rangeSegFactory()) }));
  drawChart();

  /* ---------- overview widgets (filled when recent games arrive) ---------- */
  const overview = el('div', { style: { marginTop: '16px' } }, skeleton(6));
  holder.append(overview);
  gamesP.then(({ games, total }) => {
    if (!holder.isConnected) return;
    const latest = games[0];
    if (latest?.ongoing) {
      const { opps } = perspective(latest, id);
      const teams = flattenTeams(latest);
      liveBanner.append(el('div', { class: 'live-banner' }, resultPill('live'),
        el('span', {}, el('strong', {}, 'In a game right now'), ` · ${latest.map} · ${kindName(latest.kind)}`, opps.length ? [' vs ', opps.map((o, i) => [i ? ', ' : '', el('a', { href: hrefTo(`/player/${o.profile_id}`) }, o.name)])] : null, ` · started ${fmt.rel(latest.started_at)}`),
        el('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: '8px' } },
          teams.length === 2 ? el('a', { class: 'btn sm primary', href: hrefTo('/scout', { mode: gamesFilterFor(modeKey), a: teams[0].map(p => p.profile_id).join(','), b: teams[1].map(p => p.profile_id).join(',') }) }, 'Scout this lobby') : null,
          el('a', { class: 'btn sm', href: '#/live' }, 'Live feed'))));
    }
    try { renderOverview(overview, { player, games, modeKey, total }); }
    catch (e) { console.error(e); clear(overview); overview.append(errorBox(e)); }
  });
  Promise.all([lbTotalP, lbEntryP]).then(([lbTotal, lbEntry]) => {
    if (!holder.isConnected) return;
    const total = lbTotal?.total_count;
    if (mode.rank && total) pctEl.textContent = `top ${(100 * mode.rank / total) < 1 ? (100 * mode.rank / total).toFixed(2) : (100 * mode.rank / total).toFixed(1)}% of ${fmt.int(total)}`;
    const entry = lbEntry?.players?.find(p => String(p.profile_id) === String(id));
    if (entry?.twitch_is_live) twitchPill.replaceWith(el('a', { class: 'pill live', href: entry.twitch_url || player.social?.twitch || '#', target: '_blank', rel: 'noopener', title: 'Streaming on Twitch now' }, 'Live on Twitch'));
  });

  /* ---------- detail tabs ---------- */
  const tabsDef = [
    { value: 'matches', label: 'Matches' }, { value: 'civs', label: 'Civilizations' }, { value: 'seasons', label: 'Seasons' },
    { value: 'insights', label: 'Insights' }, { value: 'official', label: 'Official data' },
  ];
  const tabBody = el('div');
  const tabsEl = subTabs(tabsDef, tab, v => navigate(`/player/${id}`, { mode: modeKey, tab: v }));
  holder.append(el('section', { class: 'card', style: { marginTop: '16px' } }, tabsEl, tabBody));

  if (tab === 'matches') renderMatches(tabBody, player, modeKey);
  else if (tab === 'civs') renderCivs(tabBody, player, modeKey);
  else if (tab === 'seasons') renderSeasons(tabBody, player, modeKey);
  else if (tab === 'insights') renderInsights(tabBody, player, modeKey);
  else if (tab === 'official') renderOfficial(tabBody, player);
}

/* ======================= Matches ======================= */
function renderMatches(box, player, modeKey) {
  const id = player.profile_id;
  let filterMode = gamesFilterFor(modeKey);
  let result = 'all';
  let page = 1; let games = []; let total = 0; let nextPage = null;
  const list = el('div', { class: 'game-list card flush', style: { border: '1px solid var(--border)' } });
  const summary = el('span', { class: 'muted small' });
  const more = el('button', { class: 'btn', type: 'button', style: { marginTop: '12px' } }, 'Load more');
  const modeOpts = [{ value: '', label: 'All modes' }, ...PROFILE_MODES.filter(m => !m.hidden).map(m => ({ value: m.key, label: m.name }))];
  const filters = el('div', { class: 'filters' },
    el('label', {}, 'Mode ', select(modeOpts, filterMode, v => { filterMode = v; reset(); }, { ariaLabel: 'Mode filter' })),
    el('label', {}, 'Result ', select([{ value: 'all', label: 'All results' }, { value: 'win', label: 'Wins' }, { value: 'loss', label: 'Losses' }], result, v => { result = v; draw(); }, { ariaLabel: 'Result filter' })),
    el('span', { class: 'spacer' }), summary);
  box.append(filters, list, el('div', { class: 'center' }, more));

  function draw() {
    clear(list);
    const shown = games.filter(g => result === 'all' || flattenTeams(g).flat().find(p => p.profile_id === id)?.result === result);
    if (!shown.length) list.append(emptyState(games.length ? 'No games match this filter.' : 'No games found.'));
    for (const s of sessionize(shown)) {
      list.append(sessionHeader(s, id));
      for (const g of s.games) list.append(gameRow(g, { perspectiveId: id }));
    }
    const w = games.filter(g => flattenTeams(g).flat().find(p => p.profile_id === id)?.result === 'win').length;
    summary.textContent = `Showing ${shown.length} of ${fmt.int(total)} games · loaded ${games.length} (${w} W – ${games.length - w} L)`;
    more.style.display = nextPage ? '' : 'none';
  }
  async function load() {
    more.disabled = true; more.textContent = 'Loading…';
    if (!games.length) { clear(list); list.append(skeleton(8)); }
    try {
      const d = await api.playerGames(id, { leaderboard: filterMode || undefined, page, limit: 50 });
      games.push(...(d.games || [])); total = d.total_count ?? games.length; nextPage = d.next_page;
      draw();
    } catch (e) { clear(list); list.append(errorBox(e, load)); }
    more.disabled = false; more.textContent = 'Load more';
  }
  function reset() { page = 1; games = []; total = 0; nextPage = null; load(); }
  more.addEventListener('click', () => { if (nextPage) { page = nextPage; load(); } });
  load();
}

/* ======================= Civilizations ======================= */
function renderCivs(box, player, modeKey) {
  const mode = player.modes?.[modeKey] || {};
  const civs = mode.civilizations || [];
  if (!civs.length) {
    box.append(notice('The API does not publish a per-civilization breakdown for this mode. The Insights tab computes one from loaded matches instead.'));
    return;
  }
  const total = civs.reduce((a, c) => a + c.games_count, 0);
  const columns = [
    { key: 'civilization', label: 'Civilization', render: r => civChip(r.civilization), sortValue: r => civName(r.civilization) },
    { key: 'games_count', label: 'Games', num: true, render: r => fmt.int(r.games_count) },
    { key: 'pick_rate', label: 'Pick rate', num: true, render: r => el('span', { class: 'wr-cell' }, el('span', { class: 'meter', style: { width: '90px' } }, el('span', { style: { width: `${Math.min(100, r.pick_rate).toFixed(1)}%` } })), el('span', { class: 'num' }, fmt.pct(r.pick_rate))) },
    { key: 'win_rate', label: 'Win rate', num: true, render: r => wrCell(r.win_rate, { w: Math.round(r.games_count * r.win_rate / 100), l: r.games_count - Math.round(r.games_count * r.win_rate / 100) }) },
    { key: 'wins', label: 'W – L', num: true, sortValue: r => Math.round(r.games_count * r.win_rate / 100), render: r => { const w = Math.round(r.games_count * r.win_rate / 100); return `${w} – ${r.games_count - w}`; } },
  ];
  const fav = [...civs].sort((a, b) => b.games_count - a.games_count)[0];
  const best = [...civs].filter(c => c.games_count >= Math.max(5, total * 0.03)).sort((a, b) => b.win_rate - a.win_rate)[0];
  box.append(el('div', { class: 'tiles', style: { marginBottom: '14px' } },
    statTile({ label: 'Civ pool', value: String(civs.length), unit: 'civilizations', sub: `${fmt.int(total)} games this season` }),
    statTile({ label: 'Most played', value: el('span', {}, civChip(fav.civilization, { size: 'lg', name: 'short' })), sub: `${fmt.pct(fav.pick_rate, 0)} of games · ${fmt.pct(fav.win_rate, 0)} win rate` }),
    best ? statTile({ label: 'Best win rate (≥3% of games)', value: el('span', {}, civChip(best.civilization, { size: 'lg', name: 'short' })), sub: `${fmt.pct(best.win_rate, 1)} over ${best.games_count} games` }) : null));
  box.append(dataTable({ columns, rows: civs, sort: { key: 'games_count', dir: 'desc' }, caption: 'Civilization breakdown' }));
}

/* ======================= Seasons ======================= */
function renderSeasons(box, player, modeKey) {
  const mode = player.modes?.[modeKey] || {};
  const rows = [];
  if (mode.season) rows.push({ ...mode, current: true });
  for (const s of mode.previous_seasons || []) rows.push(s);
  if (!rows.length) { box.append(notice('No seasonal history for this mode (quick match and hidden ELO modes are not seasonal).')); return; }
  const columns = [
    { key: 'season', label: 'Season', num: true, render: r => el('span', {}, `S${r.season}`, r.current ? el('span', { class: 'pill neutral', style: { marginLeft: '8px' } }, 'current') : null) },
    { key: 'rank_level', label: 'Rank', sortValue: r => r.rank ?? 1e9, render: r => rankBadge(r.rank_level, { sm: true, rank: r.rank }) },
    { key: 'rating', label: 'Rating', num: true, render: r => fmt.int(r.rating) },
    { key: 'max_rating', label: 'Peak', num: true, render: r => fmt.int(r.max_rating) },
    { key: 'games_count', label: 'Games', num: true, render: r => fmt.int(r.games_count) },
    { key: 'win_rate', label: 'Win rate', num: true, render: r => wrCell(r.win_rate, { w: r.wins_count, l: r.losses_count }) },
    { key: 'wins_count', label: 'W – L', num: true, render: r => `${fmt.int(r.wins_count)} – ${fmt.int(r.losses_count)}` },
    { key: 'last_game_at', label: 'Last game', sortValue: r => new Date(r.last_game_at || 0).getTime(), render: r => fmt.date(r.last_game_at) },
  ];
  const peak = rows.reduce((a, r) => (r.rating ?? 0) > (a?.rating ?? 0) ? r : a, null);
  box.append(el('div', { class: 'tiles', style: { marginBottom: '14px' } },
    statTile({ label: 'Seasons played', value: String(rows.length) }),
    peak ? statTile({ label: 'Best season finish', value: fmt.int(peak.rating), sub: `Season ${peak.season} · ${parseRankLevel(peak.rank_level).label}${peak.rank ? ` · #${fmt.int(peak.rank)}` : ''}` }) : null,
    statTile({ label: 'Career ranked games', value: fmt.int(rows.reduce((a, r) => a + (r.games_count || 0), 0)), sub: `${fmt.pct(winRate(rows.reduce((a, r) => a + (r.wins_count || 0), 0), rows.reduce((a, r) => a + (r.losses_count || 0), 0)), 1)} win rate` })));
  box.append(dataTable({ columns, rows, sort: { key: 'season', dir: 'desc' }, caption: 'Season history' }));
}

/* ======================= Insights (derived from matches) ======================= */
function renderInsights(box, player, modeKey) {
  const id = player.profile_id;
  const filter = gamesFilterFor(modeKey);
  const body = el('div');
  box.append(body);
  fillAsync(body, () => fetchPlayerGames(id, { leaderboard: filter, limit: 50 }, 3), ({ games, total }) => {
    const mine = games.map(g => ({ g, me: flattenTeams(g).flat().find(p => p.profile_id === id), teams: flattenTeams(g) })).filter(x => x.me && x.me.result);
    if (!mine.length) return notice('No finished games to analyse for this mode.');
    const frag = document.createDocumentFragment();
    frag.append(notice(`Computed in your browser from the ${fmt.int(mine.length)} most recent finished ${modeName(filter)} games (of ${fmt.int(total)} on record).`));

    const rec = arr => { const w = arr.filter(x => x.me.result === 'win').length; return { w, l: arr.length - w, n: arr.length, wr: winRate(w, arr.length - w) }; };
    const recordCols = (labelKey, labelRender) => [
      { key: 'label', label: labelKey, render: labelRender, sortValue: r => r.label },
      { key: 'n', label: 'Games', num: true, render: r => fmt.int(r.n) },
      { key: 'wr', label: 'Win rate', num: true, render: r => wrCell(r.wr, { w: r.w, l: r.l }) },
      { key: 'w', label: 'W – L', num: true, render: r => `${r.w} – ${r.l}` },
    ];
    // Maps
    const byMap = [...groupBy(mine, x => x.g.map || 'Unknown')].map(([label, arr]) => ({ label, ...rec(arr) }));
    // Opponent civs
    const oppCiv = [];
    for (const x of mine) for (const t of x.teams) if (!t.some(p => p.profile_id === id)) for (const p of t) oppCiv.push({ civ: p.civilization, me: x.me });
    const byOppCiv = [...groupBy(oppCiv, o => o.civ)].map(([label, arr]) => ({ label, ...rec(arr) }));
    // My civs (useful where API gives none)
    const byMyCiv = [...groupBy(mine, x => x.me.civilization)].map(([label, arr]) => ({ label, ...rec(arr) }));
    // Rivals
    const opp = [];
    for (const x of mine) for (const t of x.teams) if (!t.some(p => p.profile_id === id)) for (const p of t) opp.push({ p, me: x.me });
    const rivals = [...groupBy(opp, o => o.p.profile_id)].map(([pid, arr]) => ({ label: arr[0].p.name, player: arr[0].p, ...rec(arr) })).filter(r => r.n >= 2).sort((a, b) => b.n - a.n).slice(0, 12);
    // Duration buckets
    const bucket = s => s < 600 ? '< 10 min' : s < 1200 ? '10–20 min' : s < 1800 ? '20–30 min' : s < 2700 ? '30–45 min' : '45+ min';
    const order = ['< 10 min', '10–20 min', '20–30 min', '30–45 min', '45+ min'];
    const byDur = [...groupBy(mine.filter(x => x.g.duration), x => bucket(x.g.duration))].map(([label, arr]) => ({ label, ...rec(arr) })).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    // Rating of opponents
    const oppRatings = opp.map(o => o.p.rating).filter(Number.isFinite);
    const durs = mine.map(x => x.g.duration).filter(Number.isFinite);
    const diffs = mine.map(x => x.me.rating_diff).filter(Number.isFinite);
    const servers = [...groupBy(mine, x => x.g.server || 'Unknown')].map(([label, arr]) => ({ label, ...rec(arr) })).sort((a, b) => b.n - a.n);

    frag.append(el('div', { class: 'tiles', style: { margin: '14px 0' } },
      statTile({ label: 'Average game length', value: fmt.duration(mean(durs)), sub: `median ${fmt.duration(median(durs))}` }),
      statTile({ label: 'Average opponent rating', value: fmt.int(mean(oppRatings)), sub: `highest ${fmt.int(Math.max(...oppRatings, 0))}` }),
      statTile({ label: 'Net rating change', value: fmt.signed(diffs.reduce((a, b) => a + b, 0)), sub: `over ${diffs.length} rated games` }),
      statTile({ label: 'Most played server', value: servers[0]?.label ?? '—', sub: servers[0] ? `${fmt.pct(servers[0].wr, 0)} win rate · ${servers[0].n} games` : null })));

    frag.append(el('div', { class: 'grid cols-2' },
      card('By map', dataTable({ columns: recordCols('Map', r => r.label), rows: byMap, sort: { key: 'n', dir: 'desc' } }), { level: 3, flush: true }),
      card('Against opponent civilizations', dataTable({ columns: recordCols('Opponent civ', r => civChip(r.label)), rows: byOppCiv, sort: { key: 'n', dir: 'desc' } }), { level: 3, flush: true }),
      card('Playing as', dataTable({ columns: recordCols('My civ', r => civChip(r.label)), rows: byMyCiv, sort: { key: 'n', dir: 'desc' } }), { level: 3, flush: true }),
      card('Frequent opponents', rivals.length ? dataTable({ columns: [
        { key: 'label', label: 'Opponent', render: r => el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, playerLink(r.player, { showAvatar: false }), el('a', { class: 'small', href: hrefTo(`/compare/${id}/${r.player.profile_id}`) }, 'compare')) },
        { key: 'n', label: 'Games', num: true, render: r => fmt.int(r.n) },
        { key: 'wr', label: 'Win rate', num: true, render: r => wrCell(r.wr, { w: r.w, l: r.l }) },
        { key: 'w', label: 'W – L', num: true, render: r => `${r.w} – ${r.l}` }], rows: rivals, sort: { key: 'n', dir: 'desc' } }) : emptyState('No repeat opponents in the loaded games.'), { level: 3, flush: true }),
      card('By game length', dataTable({ columns: recordCols('Length', r => r.label), rows: byDur }), { level: 3, flush: true }),
      card('By server', dataTable({ columns: recordCols('Server', r => r.label), rows: servers, sort: { key: 'n', dir: 'desc' } }), { level: 3, flush: true })));
    return frag;
  }, { lines: 10 });
}

/* ======================= Official (Relic) ======================= */
function renderOfficial(box, player) {
  const id = player.profile_id;
  const body = el('div'); box.append(body);
  if (!relicAvailable()) { body.append(unavailableNotice()); return; }
  fillAsync(body, async () => {
    const [ps, hist] = await Promise.all([relic.personalStat([id]), relic.recentMatchHistory([id])]);
    if (!ps) throw Object.assign(new Error('proxy-missing'), { proxyMissing: true });
    return { ps, hist };
  }, ({ ps, hist }) => {
    const frag = document.createDocumentFragment();
    const member = ps.statGroups?.flatMap(g => g.members || []).find(m => m.profile_id === id) || ps.statGroups?.[0]?.members?.[0];
    frag.append(notice(el('strong', {}, 'Source: '), 'World’s Edge community API (the game’s own backend), read through the local proxy in ', el('code', {}, 'server.py'), '. Undocumented, no auth, no CORS — a production site would read it server-side exactly like this.'));
    if (member) frag.append(el('div', { class: 'tiles', style: { margin: '14px 0' } },
      statTile({ label: 'Account level', value: fmt.int(member.level), sub: `${fmt.compact(member.xp)} XP` }),
      statTile({ label: 'Alias on record', value: member.alias || '—', sub: member.country ? countryName(member.country) : null }),
      statTile({ label: 'Platform id', value: el('span', { style: { fontSize: '15px', fontFamily: 'var(--mono)' } }, member.name || '—') }),
      statTile({ label: 'Stat group', value: fmt.int(member.personal_statgroup_id) })));
    const lbRows = (ps.leaderboardStats || []).map(s => ({ ...s, name: RELIC_LEADERBOARD_NAMES[s.leaderboard_id] ?? `Leaderboard ${s.leaderboard_id}` }));
    frag.append(card('Official ladders', dataTable({ columns: [
      { key: 'name', label: 'Ladder', render: r => el('span', {}, r.name, el('span', { class: 'muted small' }, ` · id ${r.leaderboard_id}`)) },
      { key: 'rating', label: 'Rating', num: true, render: r => fmt.int(r.rating) },
      { key: 'rank', label: 'Rank', num: true, sortValue: r => r.rank > 0 ? r.rank : 1e9, render: r => r.rank > 0 ? `#${fmt.int(r.rank)}${r.ranktotal > 0 ? ` / ${fmt.compact(r.ranktotal)}` : ''}` : el('span', { class: 'muted' }, 'unranked') },
      { key: 'regionrank', label: 'Region rank', num: true, render: r => r.regionrank > 0 ? `#${fmt.int(r.regionrank)}` : '—' },
      { key: 'wins', label: 'W – L', num: true, render: r => `${fmt.int(r.wins)} – ${fmt.int(r.losses)}` },
      { key: 'wr', label: 'Win rate', num: true, sortValue: r => winRate(r.wins, r.losses), render: r => wrCell(winRate(r.wins, r.losses), { w: r.wins, l: r.losses }) },
      { key: 'streak', label: 'Streak', num: true, render: r => streakEl(r.streak) },
      { key: 'highestrating', label: 'Highest', num: true, render: r => r.highestrating > 0 ? fmt.int(r.highestrating) : '—' },
      { key: 'lastmatchdate', label: 'Last match', render: r => el('span', { class: 'muted small' }, fmt.rel(r.lastmatchdate * 1000)) },
    ], rows: lbRows, sort: { key: 'lastmatchdate', dir: 'desc' } }), { level: 3, flush: true }));

    // Telemetry per match
    const matches = (hist?.matchHistoryStats || []).slice().sort((a, b) => b.startgametime - a.startgametime).slice(0, 25);
    const profiles = new Map((hist?.profiles || []).map(p => [p.profile_id, p]));
    const rows = [];
    for (const m of matches) {
      const mine = (m.matchhistoryreportresults || []).find(r => r.profile_id === id);
      if (!mine) continue;
      let c = {}; try { c = JSON.parse(mine.counters || '{}'); } catch { c = {}; }
      const dur = (m.completiontime || 0) - (m.startgametime || 0);
      const member = (m.matchhistorymember || []).find(x => x.profile_id === id);
      const opps = (m.matchhistoryreportresults || []).filter(r => r.teamid !== mine.teamid).map(r => profiles.get(r.profile_id)?.alias || `#${r.profile_id}`);
      rows.push({ id: m.id, when: m.startgametime * 1000, type: RELIC_MATCHTYPE_NAMES[m.matchtype_id] ?? `type ${m.matchtype_id}`, result: mine.resulttype === 1 ? 'win' : mine.resulttype === 0 ? 'loss' : 'other', dur, opps,
        units: c.unitprod ?? c.sqprod, kills: c.sqkill ?? c.ekills, lost: c.sqlost, bprod: c.bprod, blost: c.blost, upg: c.upg, cmds: c.totalcmds, apm: dur > 0 && c.totalcmds ? c.totalcmds / (dur / 60) : null, rating: member ? `${member.oldrating} → ${member.newrating}` : '—', xp: mine.xpgained });
    }
    frag.append(el('div', { style: { height: '16px' } }));
    frag.append(card('Match telemetry (official)', rows.length ? dataTable({ columns: [
      { key: 'when', label: 'When', render: r => el('span', { title: new Date(r.when).toLocaleString() }, fmt.rel(r.when)) },
      { key: 'type', label: 'Type', render: r => r.type },
      { key: 'result', label: 'Result', sortable: false, render: r => resultPill(r.result) },
      { key: 'opps', label: 'Opponents', sortable: false, render: r => el('span', { class: 'small' }, r.opps.join(', ')) },
      { key: 'dur', label: 'Length', num: true, render: r => fmt.duration(r.dur) },
      { key: 'units', label: 'Units', num: true, title: 'Units produced', render: r => fmt.int(r.units) },
      { key: 'kills', label: 'Kills', num: true, title: 'Units killed', render: r => fmt.int(r.kills) },
      { key: 'lost', label: 'Lost', num: true, title: 'Units lost', render: r => fmt.int(r.lost) },
      { key: 'bprod', label: 'Bldgs', num: true, title: 'Buildings built / lost', render: r => `${fmt.int(r.bprod)} / ${fmt.int(r.blost)}` },
      { key: 'upg', label: 'Upgrades', num: true, render: r => fmt.int(r.upg) },
      { key: 'apm', label: 'APM', num: true, title: 'Total commands ÷ minutes', render: r => r.apm ? fmt.int(r.apm) : '—' },
      { key: 'rating', label: 'Rating', sortable: false, render: r => el('span', { class: 'num small' }, r.rating) },
    ], rows, sort: { key: 'when', dir: 'desc' } }) : emptyState('No recent matches in the official history.'), { level: 3, flush: true, meta: 'kills, losses, buildings, upgrades and commands per match come straight from the game servers' }));
    return frag;
  }, { lines: 10 }).then(r => { if (r === null && !relicAvailable()) { clear(body); body.append(unavailableNotice()); } });
}
function unavailableNotice() {
  return notice(el('strong', {}, 'Official account data needs the server-side proxy. '), 'The World’s Edge API does not allow browser requests directly, so this tab reads it through server.py. ', ...companionHint(), ' Everything else on the site works without it.');
}
