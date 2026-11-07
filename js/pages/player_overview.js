// Profile overview widgets built from a player's recent games: form deltas, activity pattern,
// calendar, recently played with, rating gained by civ and map, and session grouping.
import { el, fmt, hrefTo, groupBy, winRate, mean, sum, divergingColor, clamp } from '../util.js';
import { playerLink, civChip, card, bindTooltip, ttRows, emptyState, flattenTeams, dataTable, wrCell } from '../components.js';
import { civName, kindName } from '../constants.js';
import { gamesFilterFor } from './_shared.js';

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
    el('p', { class: 'muted small', style: { margin: '10px 0 0' } }, `Overview computed in your browser from the ${fmt.int(games.length)} most recent games on record (of ${fmt.int(total)}). Times are shown in your local time zone.`));
}

export { kindName, civName };
