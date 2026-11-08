// Profile overview widgets built from a player's recent games: form deltas, activity pattern,
// calendar, recently played with, rating gained by civ and map, and session grouping.
import { el, fmt, hrefTo, groupBy, winRate, mean, sum, divergingColor, clamp, clear } from '../util.js';
import { playerLink, civChip, card, bindTooltip, ttRows, emptyState, flattenTeams, dataTable, wrCell, resultPill } from '../components.js';
import { getJSON, ApiError } from '../api.js';
import { civName, kindName } from '../constants.js';
import { gamesFilterFor, companionHint } from './_shared.js';

/* ---------- game helpers ---------- */
export function perspective(game, id) {
  const teams = flattenTeams(game);
  const myTeam = teams.find(t => t.some(p => p.profile_id === id)) || [];
  const me = myTeam.find(p => p.profile_id === id) || null;
  return { me, mates: myTeam.filter(p => p.profile_id !== id), opps: teams.filter(t => t !== myTeam).flat() };
}
const finished = (g, id) => !g.ongoing && !!perspective(g, id).me?.result;
const rec = (arr, id) => { const w = arr.filter(g => perspective(g, id).me?.result === 'win').length; return { w, l: arr.length - w, n: arr.length, wr: winRate(w, arr.length - w) }; };
const netRating = (arr, id) => sum(arr.map(g => perspective(g, id).me?.rating_diff || 0));

export function dayLabel(d) {
  const date = new Date(d), today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(date); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400e3);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** Group games (newest first) into play sessions separated by more than `gapMs` of inactivity. */
export function sessionize(games, gapMs = 2 * 3600e3) {
  const sessions = [];
  let cur = null, prevStart = null;
  for (const g of games) {
    const t = new Date(g.started_at).getTime();
    if (!cur || prevStart - t > gapMs) { cur = { games: [], end: t }; sessions.push(cur); }
    cur.games.push(g); cur.start = t; prevStart = t;
  }
  return sessions;
}
export function sessionHeader(session, id) {
  const done = session.games.filter(g => finished(g, id));
  const r = rec(done, id), net = netRating(done, id);
  const dur = sum(session.games.map(g => g.duration || 0));
  return el('div', { class: 'session-row' },
    el('span', { class: 'when' }, dayLabel(session.end), el('span', { class: 'muted' }, ` · ${new Date(session.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}–${new Date(session.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`)),
    el('span', { class: 'muted' }, `${session.games.length} game${session.games.length === 1 ? '' : 's'} · ${fmt.duration(dur)} played`),
    done.length ? el('span', { class: 'num' }, `${r.w}W – ${r.l}L`) : null,
    done.length && net ? el('span', { class: `num ${net > 0 ? 'good' : 'bad'}` }, fmt.signed(net)) : null);
}

/* ---------- widgets ---------- */
function deltaTable(recent, previous, id) {
  const stat = (arr, f) => arr.length ? f(arr) : null;
  const rows = [
    { label: 'Win rate', f: a => rec(a, id).wr, fmt: v => fmt.pct(v, 0), good: 1 },
    { label: 'Avg game length', f: a => mean(a.map(g => g.duration).filter(Number.isFinite)), fmt: v => fmt.duration(v), good: 0 },
    { label: 'Avg rating change', f: a => mean(a.map(g => perspective(g, id).me?.rating_diff).filter(Number.isFinite)), fmt: v => fmt.signed(Math.round(v)), good: 1 },
    { label: 'Avg opponent rating', f: a => mean(a.flatMap(g => perspective(g, id).opps.map(o => o.rating)).filter(Number.isFinite)), fmt: v => fmt.int(v), good: 1 },
    { label: 'Games per session', f: a => { const s = sessionize(a); return s.length ? a.length / s.length : null; }, fmt: v => fmt.dec(v, 1), good: 0 },
  ];
  const table = el('table', { class: 'data compact' }, el('thead', {}, el('tr', {}, el('th', {}, 'Metric'), el('th', { class: 'num' }, `Last ${recent.length}`), el('th', { class: 'num' }, `Previous ${previous.length}`), el('th', { class: 'num' }, 'Δ'))));
  const tb = el('tbody');
  for (const r of rows) {
    const a = stat(recent, r.f), b = stat(previous, r.f);
    const d = a !== null && b !== null ? a - b : null;
    let cls = 'muted';
    if (d !== null && r.good && Math.abs(d) > 1e-9) cls = d > 0 ? 'good' : 'bad';
    tb.append(el('tr', {}, el('td', {}, r.label), el('td', { class: 'num' }, el('strong', {}, a === null ? '—' : r.fmt(a))), el('td', { class: 'num muted' }, b === null ? '—' : r.fmt(b)),
      el('td', { class: `num ${cls}` }, d === null ? '—' : r.label === 'Win rate' ? `${d > 0 ? '+' : ''}${d.toFixed(0)} pts` : r.label === 'Avg game length' ? `${d > 0 ? '+' : '−'}${fmt.duration(Math.abs(d))}` : (d > 0 ? '+' : '') + (Number.isInteger(d) ? d : d.toFixed(1)))));
  }
  table.append(tb);
  return el('div', { class: 'table-wrap' }, table);
}

function activity(games, id) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const byDay = Array.from({ length: 7 }, () => []);
  const byHour = Array.from({ length: 24 }, () => []);
  for (const g of games) { const d = new Date(g.started_at); byDay[(d.getDay() + 6) % 7].push(g); byHour[d.getHours()].push(g); }
  const bars = (buckets, labels, every = 1) => {
    const max = Math.max(1, ...buckets.map(b => b.length));
    return el('div', { class: 'colbars', style: { gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` } }, buckets.map((b, i) => {
      const r = rec(b, id);
      const col = el('div', { class: 'colbar', tabindex: 0 },
        el('div', { class: 'bar-wrap' }, el('div', { class: 'bar', style: { height: `${(100 * b.length / max).toFixed(0)}%`, background: b.length ? divergingColor(r.wr ?? 50, 50, 25) : 'var(--surface-3)' } })),
        el('div', { class: 'lbl' }, i % every === 0 ? labels[i] : ''));
      return bindTooltip(col, () => ttRows(labels[i], [{ label: 'games', value: String(b.length) }, { label: 'win rate', value: b.length ? fmt.pct(r.wr, 0) : '—' }, { label: 'record', value: b.length ? `${r.w}W – ${r.l}L` : '—' }]));
    }));
  };
  return el('div', { class: 'stack' },
    el('div', {}, el('div', { class: 'muted small', style: { marginBottom: '4px' } }, 'By weekday'), bars(byDay, days)),
    el('div', {}, el('div', { class: 'muted small', style: { marginBottom: '4px' } }, 'By hour of day (your local time)'), bars(byHour, byHour.map((_, h) => `${h}:00`), 3)),
    el('p', { class: 'muted small', style: { margin: 0 } }, 'Bar height = games played; colour = win rate (blue above 50 %, red below).'));
}

function calendar(games, id, days = 126) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - (days - 1));
  const startDow = (start.getDay() + 6) % 7;        // Monday-first
  start.setDate(start.getDate() - startDow);        // align to a Monday
  const perDay = new Map();
  for (const g of games) { const d = new Date(g.started_at); d.setHours(0, 0, 0, 0); const k = d.getTime(); if (!perDay.has(k)) perDay.set(k, []); perDay.get(k).push(g); }
  const total = Math.ceil((today - start) / 86400e3) + 1, weeks = Math.ceil(total / 7);
  const grid = el('div', { class: 'cal', style: { gridTemplateColumns: `auto repeat(${weeks}, 1fr)` } });
  const months = el('div', { class: 'cal-months', style: { gridTemplateColumns: `auto repeat(${weeks}, 1fr)` } }, el('span'));
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) { const d = new Date(start); d.setDate(d.getDate() + w * 7); const m = d.getMonth(); months.append(el('span', { class: 'muted' }, m !== lastMonth ? d.toLocaleDateString(undefined, { month: 'short' }) : '')); lastMonth = m; }
  const dayNames = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
  for (let dow = 0; dow < 7; dow++) {
    grid.append(el('span', { class: 'cal-day muted' }, dayNames[dow]));
    for (let w = 0; w < weeks; w++) {
      const d = new Date(start); d.setDate(d.getDate() + w * 7 + dow);
      const gs = perDay.get(d.getTime()) || [];
      const cell = el('span', { class: 'cal-cell', tabindex: gs.length ? 0 : null });
      if (d > today) cell.style.visibility = 'hidden';
      else if (gs.length) {
        const done = gs.filter(g => finished(g, id)); const net = netRating(done, id); const r = rec(done, id);
        cell.style.background = divergingColor(50 + clamp(net, -60, 60) * (25 / 60), 50, 25);
        cell.style.opacity = String(0.55 + 0.45 * Math.min(1, gs.length / 6));
        bindTooltip(cell, () => ttRows(d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }), [{ label: 'games', value: String(gs.length) }, { label: 'record', value: `${r.w}W – ${r.l}L` }, { label: 'net rating', value: fmt.signed(net) }]));
      }
      grid.append(cell);
    }
  }
  const active = [...perDay.keys()].filter(k => k >= start.getTime()).length;
  return el('div', {}, months, grid, el('p', { class: 'muted small', style: { margin: '8px 0 0' } }, `${active} active days in the last ${days} · colour = net rating that day (blue up, red down), opacity = games played.`));
}

function peers(games, id, kind) {
  const rows = [];
  const m = new Map();
  for (const g of games) {
    const { me, mates, opps } = perspective(g, id);
    if (!me?.result) continue;
    for (const p of (kind === 'mates' ? mates : opps)) {
      if (!m.has(p.profile_id)) m.set(p.profile_id, { p, games: [] });
      m.get(p.profile_id).games.push(g);
    }
  }
  for (const { p, games: gs } of m.values()) rows.push({ p, ...rec(gs, id) });
  rows.sort((a, b) => b.n - a.n);
  const top = rows.filter(r => r.n >= (kind === 'mates' ? 2 : 2)).slice(0, 8);
  if (!top.length) return emptyState(kind === 'mates' ? 'No repeat teammates in the loaded games.' : 'No repeat opponents in the loaded games.');
  return dataTable({ columns: [
    { key: 'name', label: kind === 'mates' ? 'Teammate' : 'Opponent', sortable: false, render: r => el('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, playerLink(r.p, { showAvatar: false }), el('a', { class: 'small', href: hrefTo(`/compare/${id}/${r.p.profile_id}`) }, 'compare')) },
    { key: 'n', label: 'Games', num: true, render: r => fmt.int(r.n) },
    { key: 'wr', label: kind === 'mates' ? 'Win rate together' : 'Win rate vs', num: true, render: r => wrCell(r.wr, { w: r.w, l: r.l }) },
  ], rows: top, sort: { key: 'n', dir: 'desc' }, compact: true });
}

function gains(games, id, keyFn, labelRender, label) {
  const rows = [...groupBy(games, keyFn)].map(([k, gs]) => ({ k, ...rec(gs, id), net: netRating(gs, id) })).filter(r => r.k && r.k !== 'null').sort((a, b) => b.net - a.net);
  if (!rows.length) return emptyState('No rated games loaded for this mode.');
  const max = Math.max(1, ...rows.map(r => Math.abs(r.net)));
  return dataTable({ columns: [
    { key: 'k', label, render: r => labelRender(r.k), sortValue: r => String(r.k) },
    { key: 'net', label: 'Rating', num: true, render: r => el('span', { class: 'wr-cell' }, el('span', { class: 'divbar', style: { minWidth: '70px' } }, el('span', { class: 'mid' }), el('span', { class: `arm ${r.net >= 0 ? 'pos' : 'neg'}`, style: { width: `${(50 * Math.abs(r.net) / max).toFixed(1)}%` } })), el('strong', { class: `num ${r.net > 0 ? 'good' : r.net < 0 ? 'bad' : ''}` }, fmt.signed(r.net))) },
    { key: 'n', label: 'Games', num: true, render: r => fmt.int(r.n) },
    { key: 'wr', label: 'Win rate', num: true, render: r => fmt.pct(r.wr, 0) },
  ], rows, sort: { key: 'net', dir: 'desc' }, compact: true });
}

/** Fill `box` with the overview grid. `games` = recent games across all modes, newest first. */
export function renderOverview(box, { player, games, modeKey, total }) {
  const id = player.profile_id;
  const lbKey = gamesFilterFor(modeKey);
  const all = games.filter(g => finished(g, id));
  const modeGames = all.filter(g => g.leaderboard === lbKey);
  const recent = modeGames.slice(0, 20), previous = modeGames.slice(20);
  const span = all.length ? `${fmt.date(all[all.length - 1].started_at)} – ${fmt.date(all[0].started_at)}` : '';
  box.replaceChildren(
    el('div', { class: 'grid cols-3' },
      card('Recent form', modeGames.length >= 5 ? deltaTable(recent, previous, id) : emptyState('Not enough finished games in this mode yet.'), { level: 3, flush: true, meta: `${lbKey.replace('_', ' ')} · last ${recent.length} vs previous ${previous.length}` }),
      card('Recently played with', el('div', { class: 'stack' }, el('div', {}, el('h4', { class: 'muted small', style: { margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '.05em' } }, 'Teammates'), peers(all, id, 'mates')), el('div', {}, el('h4', { class: 'muted small', style: { margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '.05em' } }, 'Opponents'), peers(all, id, 'opps'))), { level: 3, meta: `last ${all.length} games` }),
      card('When they play', activity(all, id), { level: 3, meta: `${all.length} games` })),
    el('div', { class: 'grid main-side', style: { marginTop: '16px' } },
      card('Activity calendar', calendar(games, id), { level: 3, meta: span }),
      card('Rating gained', el('div', { class: 'stack' },
        el('div', {}, el('h4', { class: 'muted small', style: { margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '.05em' } }, 'By civilization'), gains(modeGames, id, g => perspective(g, id).me?.civilization, k => civChip(k, { name: 'short' }), 'Civ')),
        el('div', {}, el('h4', { class: 'muted small', style: { margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '.05em' } }, 'By map'), gains(modeGames, id, g => g.map, k => el('strong', {}, k), 'Map'))), { level: 3, meta: `${lbKey.replace('_', ' ')} · ${modeGames.length} games` })),
    el('div', { class: 'grid cols-2', style: { marginTop: '16px' } }, playstyleCard(player), recordsCard(player)),
    el('p', { class: 'muted small', style: { margin: '10px 0 0' } }, `Overview computed in your browser from the ${fmt.int(games.length)} most recent games on record (of ${fmt.int(total)}). Times are shown in your local time zone.`));
}

/* ---------- playstyle + records (replay-derived, via the local companion) ---------- */
const ROLE_COLORS = { infantry: 'var(--s1)', ranged: 'var(--s2)', cavalry: 'var(--s3)', siege: 'var(--s4)', naval: 'var(--s7)' };
const profileCache = new Map();
function loadProfile(id, want, { force = false } = {}) {
  const key = `${id}:${want}`;
  if (!force && profileCache.has(key)) return profileCache.get(key);
  const p = getJSON(`local/profile/${id}?n=${want}&budget=20`, { ttl: 10 * 60e3, force });
  profileCache.set(key, p);
  p.catch(() => profileCache.delete(key));
  return p;
}
const companionMissing = e => !(e instanceof ApiError) || [404, 501, 405].includes(e.status);

function playstyleCard(player) {
  const id = player.profile_id;
  const body = el('div', {}, el('p', { class: 'muted small', style: { margin: 0 } }, 'Analysing recent replays…'));
  const meta = el('span', { class: 'meta' });
  let want = 10;
  const run = (force = false) => loadProfile(id, want, { force }).then(d => draw(d)).catch(e => {
    clear(body);
    body.append(companionMissing(e) ? el('p', { class: 'muted small', style: { margin: 0 } }, 'Playstyle tags are computed from replays by the companion server. ', ...companionHint()) : el('p', { class: 'bad small', style: { margin: 0 } }, String(e.message || e)));
  });
  function draw(d) {
    clear(body);
    meta.textContent = `${d.analysed} of the last ${d.candidates} games analysed`;
    if (!d.analysed) {
      body.append(el('p', { class: 'muted small', style: { margin: 0 } }, d.rate_limited ? 'The official replay store is rate-limiting downloads right now. ' : 'No replays could be fetched for this player yet. ', d.pending ? el('button', { class: 'linkish', type: 'button', onClick: () => { want = Math.max(want, 10); clear(body); body.append(el('p', { class: 'muted small' }, 'Fetching…')); run(true); } }, 'Try again') : null));
      return;
    }
    const identity = d.tags.filter(t => t.pct >= 30 && !['most_villagers', 'biggest_army', 'fastest_feudal'].includes(t.tag)).slice(0, 6);
    const rest = d.tags.filter(t => !identity.includes(t)).slice(0, 8);
    body.append(el('div', { class: 'tags', style: { gap: '6px', marginBottom: '10px' } }, identity.length ? identity.map(t => bindTooltip(el('span', { class: 'tag me', tabindex: 0 }, el('strong', {}, t.label), ` ${t.pct}%`), () => ttRows(t.label, [{ label: 'tagged in', value: `${t.count} of ${d.analysed} games` }]))) : el('span', { class: 'muted small' }, 'No dominant pattern yet (tags below 30%).')));
    if (rest.length) body.append(el('div', { class: 'tags', style: { gap: '4px', marginBottom: '10px' } }, rest.map(t => bindTooltip(el('span', { class: 'tag', tabindex: 0 }, `${t.label} ${t.pct}%`), () => ttRows(t.label, [{ label: 'tagged in', value: `${t.count} of ${d.analysed} games` }])))));
    const m = d.medians;
    const kv = el('dl', { class: 'kv' },
      el('dt', {}, 'Villagers by 10:00'), el('dd', {}, m.villagers_by_10 === null ? '—' : fmt.int(m.villagers_by_10)),
      el('dt', {}, 'Feudal · Castle'), el('dd', {}, `${fmt.duration(m.feudal)} · ${fmt.duration(m.castle)}`),
      el('dt', {}, 'Military by 8:00 · 12:00'), el('dd', {}, `${fmt.int(m.military_by_8)} · ${fmt.int(m.military_by_12)}`),
      el('dt', {}, 'Town Centers'), el('dd', {}, fmt.dec(m.tcs, 1)),
      el('dt', {}, 'Military share of spend'), el('dd', {}, fmt.pct(m.mil_share, 0)),
      el('dt', {}, 'APM (replay)'), el('dd', {}, fmt.int(m.apm)));
    const comp = Object.entries(d.composition || {});
    const compBar = comp.length ? el('div', {}, el('div', { class: 'stack', style: { display: 'flex', gap: '2px', height: '12px', marginTop: '4px' } }, comp.map(([r, pct]) => bindTooltip(el('span', { class: 'seg', style: { display: 'block', width: `${pct}%`, background: ROLE_COLORS[r] || 'var(--de-emphasis)', borderRadius: '3px' }, tabindex: 0 }), () => ttRows('Army composition', [{ label: r, value: `${pct}%`, color: ROLE_COLORS[r] }])))),
      el('div', { class: 'legend', style: { marginTop: '6px' } }, comp.map(([r, pct]) => el('span', { class: 'key' }, el('i', { class: 'rect', style: { '--c': ROLE_COLORS[r] || 'var(--de-emphasis)' } }), `${r} ${pct}%`)))) : null;
    body.append(el('div', { class: 'grid cols-2', style: { gap: '12px' } }, el('div', {}, el('div', { class: 'muted small', style: { marginBottom: '4px' } }, 'Medians over analysed games'), kv), el('div', {}, el('div', { class: 'muted small' }, 'Army composition (all military queued)'), compBar || emptyState('—'))));
    const actions = el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } });
    if (d.pending || d.rate_limited) actions.append(el('button', { class: 'btn sm', type: 'button', onClick: e => { e.target.disabled = true; e.target.textContent = 'Fetching…'; want = d.analysed + 10; run(true); } }, d.rate_limited ? 'Store rate-limited — retry' : `Analyse ${Math.min(10, d.pending)} more`));
    actions.append(el('span', { class: 'muted small' }, `${d.analysed} replays · ${d.missing} unavailable · percentages = share of analysed games with that tag`));
    body.append(actions);
  }
  run();
  const c = card('Playstyle', body, { level: 3 });
  c.querySelector('.card-head').append(meta);
  return c;
}

function recordsCard(player) {
  const id = player.profile_id;
  const body = el('div', {}, el('p', { class: 'muted small', style: { margin: 0 } }, 'Looking for records…'));
  loadProfile(id, 10).then(d => {
    clear(body);
    const R = d.records || {}, A = d.api_records || {};
    const link = (r, txt) => r?.game_id ? el('a', { href: hrefTo(`/game/${r.game_id}`, { p: id }) }, txt) : txt;
    const when = r => r?.started_at ? el('span', { class: 'muted small' }, ` · ${fmt.date(r.started_at)}${r.map ? ` · ${r.map}` : ''}`) : null;
    const rows = [
      ['Fastest Feudal', R.fastest_feudal, r => fmt.duration(r.value)], ['Fastest Castle', R.fastest_castle, r => fmt.duration(r.value)], ['Fastest Imperial', R.fastest_imperial, r => fmt.duration(r.value)],
      ['Earliest 2nd Town Center', R.earliest_2nd_tc, r => fmt.duration(r.value)], ['Most villagers by 10:00', R.most_villagers_by_10, r => fmt.int(r.value)],
      ['Most villagers in a game', R.most_villagers, r => fmt.int(r.value)], ['Biggest army queued', R.biggest_army, r => `${fmt.int(r.value)} units`], ['Highest APM (replay)', R.highest_apm, r => fmt.int(r.value)],
      ['Longest game', A.longest_game, r => fmt.duration(r.value)], ['Longest win streak', A.longest_win_streak, r => `${r.value} wins`], ['Biggest upset', A.biggest_upset, r => `beat a +${fmt.int(r.value)} opponent`],
    ].filter(([, r]) => r);
    if (!rows.length) { body.append(el('p', { class: 'muted small', style: { margin: 0 } }, 'No records yet — records need analysed replays.')); return; }
    body.append(el('table', { class: 'data compact' }, el('tbody', {}, rows.map(([label, r, f]) => el('tr', {}, el('td', {}, label), el('td', { class: 'num' }, el('strong', {}, link(r, f(r)))), el('td', {}, r.civ ? civChip(r.civ, { name: 'short' }) : null, r.result ? el('span', { style: { marginLeft: '6px' } }, resultPill(r.result)) : null, when(r)))))));
    body.append(el('p', { class: 'muted small', style: { margin: '8px 0 0' } }, `Replay records over ${d.analysed} analysed games; streak, longest game and upset over the last ${fmt.int(100)} games on record.`));
  }).catch(e => { clear(body); body.append(el('p', { class: 'muted small', style: { margin: 0 } }, companionMissing(e) ? ['Records are computed from replays by the companion server. ', ...companionHint()] : String(e.message || e))); });
  return card('Records', body, { level: 3 });
}

export { kindName, civName };
