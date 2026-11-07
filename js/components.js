// Reusable UI pieces. Every piece of API text goes through textContent (via el()).
import { el, append, clear, fmt, flagUrl, countryName, debounce, hrefTo, navigate, divergingColor } from './util.js';
import { civName, civShort, civFlag, parseRankLevel, kindName, modeShort, LEADERBOARDS } from './constants.js';
import { api } from './api.js';

/* ---------- identity ---------- */
export function avatarUrl(p, size = 'small') {
  let url = p?.avatars?.[size] || p?.avatars?.small || '';
  if (url.startsWith('//')) url = 'https:' + url;
  return url;
}
export function avatarImg(p, cls = 'avatar', size = 'small') {
  const url = avatarUrl(p, size);
  const img = el('img', { class: cls, alt: '', loading: 'lazy', width: 28, height: 28 });
  if (url) img.src = url; else img.style.visibility = 'hidden';
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  return img;
}
export function countryFlag(cc, cls = 'flag') {
  if (!cc) return null;
  const name = countryName(cc);
  return el('img', { class: cls, src: flagUrl(cc, 40), srcset: `${flagUrl(cc, 80)} 2x`, alt: name, title: name, loading: 'lazy', width: 20, height: 15 });
}
export function playerLink(p, { showFlag = true, showAvatar = true, cls = '' } = {}) {
  if (!p) return el('span', { class: 'muted' }, '—');
  return el('a', { class: `player ${cls}`, href: hrefTo(`/player/${p.profile_id}`), title: p.name },
    showAvatar ? avatarImg(p) : null,
    showFlag ? countryFlag(p.country) : null,
    el('span', { class: 'pname' }, p.name || `#${p.profile_id}`));
}
export function civChip(id, { size = '', name = 'full', randomized = false, title } = {}) {
  const label = name === 'short' ? civShort(id) : civName(id);
  return el('span', { class: `civ ${size}`, title: title ?? civName(id) },
    el('img', { src: civFlag(id), alt: '', width: 26, height: 14, loading: 'lazy' }),
    name !== 'none' ? el('span', { class: 'cname' }, label) : null,
    randomized ? el('span', { class: 'rnd', title: 'Random civilization' }, 'RND') : null);
}
export function rankBadge(level, { sm = false, rank = null } = {}) {
  const r = parseRankLevel(level);
  const text = rank ? `${r.label} · #${fmt.int(rank)}` : r.label;
  return el('span', { class: `rank-badge ${sm ? 'sm' : ''}`, style: { '--tier': `var(--tier-${r.tier})` }, title: r.label },
    el('span', { class: 'gem', 'aria-hidden': 'true' }), text);
}
export function resultPill(result) {
  if (result === 'win') return el('span', { class: 'pill win' }, 'W', el('span', { class: 'visually-hidden' }, 'in'));
  if (result === 'loss') return el('span', { class: 'pill loss' }, 'L', el('span', { class: 'visually-hidden' }, 'oss'));
  if (result === 'live') return el('span', { class: 'pill live' }, 'Live');
  return el('span', { class: 'pill neutral' }, result ? String(result) : '—');
}
export function streakEl(n) {
  if (n === null || n === undefined || n === 0) return el('span', { class: 'streak muted' }, '0');
  return el('span', { class: `streak ${n > 0 ? 'up' : 'down'}`, title: `${Math.abs(n)} game ${n > 0 ? 'win' : 'loss'} streak` }, n > 0 ? `+${n}` : String(n));
}
export function signedNum(n, { cls = '' } = {}) {
  if (n === null || n === undefined) return el('span', { class: 'muted' }, '—');
  return el('span', { class: `num ${cls} ${n > 0 ? 'good' : n < 0 ? 'bad' : 'muted'}` }, fmt.signed(n));
}
export function socialLinks(social = {}, steamId) {
  const items = [];
  const names = { twitch: 'Twitch', youtube: 'YouTube', twitter: 'X / Twitter', instagram: 'Instagram', liquipedia: 'Liquipedia', discord: 'Discord' };
  for (const [k, url] of Object.entries(social || {})) if (url) items.push(el('a', { href: url, rel: 'noopener', target: '_blank' }, names[k] ?? k));
  if (steamId) items.push(el('a', { href: `https://steamcommunity.com/profiles/${steamId}`, rel: 'noopener', target: '_blank' }, 'Steam'));
  return el('span', { class: 'social' }, items);
}

/* ---------- stat tile ---------- */
export function statTile({ label, value, unit, delta, deltaGood, sub, spark }) {
  const tile = el('div', { class: 'tile' }, el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value instanceof Node ? value : String(value ?? '—'), unit ? el('span', { class: 'unit' }, unit) : null));
  if (delta !== undefined && delta !== null) {
    const d = typeof delta === 'number' ? delta : null;
    const cls = d === null ? '' : (d > 0) === !!deltaGood || d === 0 ? (d === 0 ? '' : 'good') : 'bad';
    tile.append(el('div', { class: `delta ${cls}` }, typeof delta === 'number' ? fmt.signed(delta) : delta, sub ? el('span', { class: 'muted' }, sub) : null));
  } else if (sub) tile.append(el('div', { class: 'delta' }, el('span', { class: 'muted' }, sub)));
  if (spark) tile.append(el('div', { class: 'spark' }, spark));
  return tile;
}

/* ---------- bars ---------- */
export function barList(rows, { color = 'var(--s1)' } = {}) {
  const max = Math.max(...rows.map(r => r.value || 0), 1e-9);
  return el('div', { class: 'barlist' }, rows.map(r => el('div', { class: 'barrow' },
    el('div', { class: 'lbl' }, r.label),
    el('div', { class: 'track' }, el('div', { class: 'fill', style: { width: `${(100 * (r.value || 0) / max).toFixed(1)}%`, background: r.color || color } })),
    el('div', { class: 'val' }, r.display ?? fmt.int(r.value)))));
}
/** Diverging bar centred on `mid` (default 50%). */
export function divBar(value, { mid = 50, span = 25, title } = {}) {
  const wrap = el('div', { class: 'divbar', title: title ?? fmt.pct(value) }, el('span', { class: 'mid' }));
  if (value !== null && value !== undefined) {
    const t = Math.max(-1, Math.min(1, (value - mid) / span));
    wrap.append(el('span', { class: `arm ${t >= 0 ? 'pos' : 'neg'}`, style: { width: `${(Math.abs(t) * 50).toFixed(1)}%` } }));
  }
  return wrap;
}
export function meter(pct, { width = 90, mid = false, color } = {}) {
  const m = el('span', { class: 'meter', style: { width: `${width}px` }, title: fmt.pct(pct) },
    el('span', { style: { width: `${Math.max(0, Math.min(100, pct || 0)).toFixed(1)}%`, background: color || 'var(--s1)' } }));
  if (mid) m.append(el('i', { class: 'mid' }));
  return m;
}
export function wrCell(pct, { w, l } = {}) {
  return el('span', { class: 'wr-cell' }, divBar(pct, { span: 25, title: w !== undefined ? `${w}W – ${l}L` : undefined }), el('span', { class: 'num' }, fmt.pct(pct)));
}

/* ---------- table ---------- */
/**
 * columns: { key, label, num, shrink, sortable(default true), sortValue(row), render(row) -> Node|string, title }
 */
export function dataTable({ columns, rows, sort = null, rowHref, rowClass, emptyText = 'No data', compact = false, caption }) {
  const state = { key: sort?.key ?? null, dir: sort?.dir ?? 'desc' };
  const table = el('table', { class: `data ${compact ? 'compact' : ''}` });
  if (caption) table.append(el('caption', { class: 'visually-hidden' }, caption));
  const thead = el('thead'); const tbody = el('tbody');
  table.append(thead, tbody);
  const wrap = el('div', { class: 'table-wrap' }, table);

  function sortedRows() {
    if (!state.key) return rows;
    const col = columns.find(c => c.key === state.key);
    if (!col) return rows;
    const val = col.sortValue || (r => r[col.key]);
    const dir = state.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * dir;
    });
  }
  function renderHead() {
    clear(thead);
    const tr = el('tr');
    for (const c of columns) {
      const sortable = c.sortable !== false;
      const th = el('th', { class: `${c.num ? 'num' : ''} ${sortable ? 'sortable' : ''} ${c.shrink ? 'shrink' : ''}`, scope: 'col', title: c.title });
      if (sortable) {
        th.setAttribute('aria-sort', state.key === c.key ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        th.addEventListener('click', () => {
          if (state.key === c.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
          else { state.key = c.key; state.dir = c.defaultDir || (c.num ? 'desc' : 'asc'); }
          renderHead(); renderBody();
        });
      }
      th.append(c.label);
      tr.append(th);
    }
    thead.append(tr);
  }
  function renderBody() {
    clear(tbody);
    const rs = sortedRows();
    if (!rs.length) { tbody.append(el('tr', {}, el('td', { colspan: columns.length, class: 'empty' }, emptyText))); return; }
    for (const r of rs) {
      const href = rowHref?.(r);
      const tr = el('tr', { class: `${href ? 'clickable' : ''} ${rowClass?.(r) ?? ''}` });
      if (href) tr.addEventListener('click', e => { if (e.target.closest('a,button,input,label')) return; location.hash = href; });
      for (const c of columns) {
        const content = c.render ? c.render(r) : r[c.key];
        tr.append(el('td', { class: `${c.num ? 'num' : ''} ${c.shrink ? 'shrink' : ''} ${c.tdClass ?? ''}` }, content instanceof Node ? content : (content ?? '—')));
      }
      tbody.append(tr);
    }
  }
  renderHead(); renderBody();
  wrap.update = newRows => { rows = newRows; renderBody(); };
  return wrap;
}

export function pagination({ page, totalPages, hrefFor, info }) {
  const pages = el('div', { class: 'pages' });
  const add = p => pages.append(p === page ? el('span', { 'aria-current': 'page' }, String(p)) : el('a', { href: hrefFor(p) }, String(p)));
  const gap = () => pages.append(el('span', { class: 'muted' }, '…'));
  if (totalPages <= 9) { for (let p = 1; p <= totalPages; p++) add(p); }
  else {
    add(1);
    if (page > 4) gap();
    for (let p = Math.max(2, page - 2); p <= Math.min(totalPages - 1, page + 2); p++) add(p);
    if (page < totalPages - 3) gap();
    add(totalPages);
  }
  return el('div', { class: 'pagination' },
    el('span', { class: 'muted small' }, info ?? `Page ${page} of ${fmt.int(totalPages)}`),
    el('div', { class: 'pages' },
      page > 1 ? el('a', { href: hrefFor(page - 1), 'aria-label': 'Previous page' }, '‹') : el('span', { class: 'muted' }, '‹'),
      pages,
      page < totalPages ? el('a', { href: hrefFor(page + 1), 'aria-label': 'Next page' }, '›') : el('span', { class: 'muted' }, '›')));
}

/* ---------- controls ---------- */
export function segmented(options, current, onChange, { ariaLabel } = {}) {
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': ariaLabel });
  for (const o of options) {
    if (o.href) seg.append(el('a', { href: o.href, 'aria-current': o.value === current ? 'page' : null, title: o.title }, o.label));
    else seg.append(el('button', { type: 'button', 'aria-pressed': String(o.value === current), title: o.title, onClick: () => onChange?.(o.value) }, o.label));
  }
  return seg;
}
export function subTabs(options, current, onChange) {
  const tabs = el('div', { class: 'sub-tabs', role: 'tablist' });
  for (const o of options) tabs.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(o.value === current), onClick: () => onChange(o.value) }, o.label));
  return tabs;
}
export function select(options, value, onChange, { ariaLabel } = {}) {
  const s = el('select', { 'aria-label': ariaLabel, onChange: e => onChange(e.target.value) });
  for (const o of options) s.append(el('option', { value: o.value, selected: o.value === value ? true : null }, o.label));
  return s;
}

/* ---------- states ---------- */
export function skeleton(lines = 4, { height = 16 } = {}) {
  const b = el('div', { class: 'loading-block', 'aria-busy': 'true' });
  for (let i = 0; i < lines; i++) b.append(el('div', { class: 'skeleton', style: { height: `${height}px`, width: `${70 + ((i * 37) % 30)}%` } }));
  return b;
}
export function errorBox(err, retry) {
  const msg = err?.status === 404 ? 'Not found.' : err?.status === 429 ? 'The data source is rate limiting requests. Please wait a moment.' : (err?.message || String(err));
  return el('div', { class: 'error-box', role: 'alert' }, el('strong', {}, 'Could not load data'), el('span', {}, msg), ' ',
    retry ? el('button', { class: 'btn sm', type: 'button', onClick: retry, style: { marginLeft: '10px' } }, 'Retry') : null);
}
export const emptyState = text => el('div', { class: 'empty' }, text);
export const notice = (...content) => el('div', { class: 'notice' }, ...content);
export function card(title, body, { meta, actions, flush = false, level = 2 } = {}) {
  const c = el('section', { class: `card ${flush ? 'flush' : ''}` });
  if (title || meta || actions) c.append(el('div', { class: 'card-head' }, el(`h${level}`, {}, title), meta ? el('span', { class: 'meta' }, meta) : null, actions ?? null));
  if (body) append(c, [body]);
  return c;
}

/* ---------- tooltip ---------- */
const tip = () => document.getElementById('tooltip');
export function showTooltip(x, y, content) {
  const t = tip(); if (!t) return;
  clear(t); append(t, [content]); t.hidden = false;
  const r = t.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, x + 14);
  const top = y + 16 + r.height > window.innerHeight ? y - r.height - 10 : y + 16;
  t.style.left = `${Math.max(8, left)}px`; t.style.top = `${Math.max(8, top)}px`;
}
export function hideTooltip() { const t = tip(); if (t) t.hidden = true; }
export function bindTooltip(node, contentFn) {
  node.addEventListener('pointermove', e => showTooltip(e.clientX, e.clientY, contentFn()));
  node.addEventListener('pointerleave', hideTooltip);
  node.addEventListener('focus', () => { const r = node.getBoundingClientRect(); showTooltip(r.left + r.width / 2, r.top, contentFn()); });
  node.addEventListener('blur', hideTooltip);
  return node;
}
export function ttRows(title, rows) {
  return el('div', {}, title ? el('div', { class: 'tt-title' }, title) : null,
    rows.map(r => el('div', { class: 'tt-row' }, el('span', { class: 'k' }, r.color ? el('i', { style: { '--c': r.color } }) : null, r.label), el('span', { class: 'v' }, r.value))));
}

/* ---------- game row ---------- */
function teamPlayer(p, perspectiveId, kindTeam) {
  const me = p.profile_id === perspectiveId;
  return el('span', { class: `p ${me ? 'me' : ''}` },
    el('img', { src: civFlag(p.civilization), alt: civName(p.civilization), title: civName(p.civilization), width: 26, height: 14, style: { width: '24px', height: '13px', borderRadius: '2px', boxShadow: '0 0 0 1px var(--border)' } }),
    me ? el('span', { class: 'pname' }, p.name) : el('a', { class: 'pname', href: hrefTo(`/player/${p.profile_id}`) }, p.name || `#${p.profile_id}`),
    p.rating !== null && p.rating !== undefined ? el('span', { class: 'r' }, fmt.int(p.rating)) : null,
    p.civilization_randomized ? el('span', { class: 'rnd', title: 'Random civilization', style: { fontSize: '10px', color: 'var(--muted)' } }, 'RND') : null);
}
export function flattenTeams(game) {
  // The API nests players as teams[][]{player:{...}} in list endpoints but flat objects in /games/last.
  return (game.teams || []).map(t => t.map(x => x.player ?? x));
}
export function gameRow(game, { perspectiveId } = {}) {
  const teams = flattenTeams(game);
  const me = perspectiveId ? teams.flat().find(p => p.profile_id === perspectiveId) : null;
  const result = game.ongoing ? 'live' : me?.result ?? null;
  const oneVone = teams.length === 2 && teams.every(t => t.length === 1);

  const teamsEl = el('div', { class: 'teams' });
  if (oneVone) {
    // Put the perspective player first.
    const order = me && teams[1][0].profile_id === perspectiveId ? [teams[1], teams[0]] : teams;
    teamsEl.append(el('div', { class: 'team' }, teamPlayer(order[0][0], perspectiveId), el('span', { class: 'vs' }, 'vs'), teamPlayer(order[1][0], perspectiveId)));
  } else {
    teams.forEach((t, i) => {
      if (i > 0) teamsEl.append(el('div', { class: 'vs' }, 'vs'));
      teamsEl.append(el('div', { class: 'team' }, t.map(p => teamPlayer(p, perspectiveId))));
    });
  }
  const diff = me?.rating_diff;
  return el('div', { class: 'game-row', dataset: { gameId: game.game_id } },
    el('div', { class: 'lead' }, resultPill(result), el('span', { class: 'when', title: fmt.dateTime(game.started_at) }, fmt.rel(game.started_at))),
    teamsEl,
    el('div', { class: 'meta' },
      el('span', {}, el('strong', {}, game.map || 'Unknown map'), ' · ', kindName(game.kind)),
      el('span', {}, fmt.duration(game.duration), game.server ? ` · ${game.server}` : ''),
      diff !== null && diff !== undefined ? el('span', { class: `diff ${diff > 0 ? 'good' : diff < 0 ? 'bad' : ''}` }, fmt.signed(diff), el('span', { class: 'muted' }, ' rating')) : null));
}

/* ---------- player search box ---------- */
function bestMode(p) {
  const lbs = p.leaderboards || {};
  const order = ['rm_solo', 'rm_team', 'qm_1v1', 'qm_2v2', 'qm_3v3', 'qm_4v4'];
  for (const k of order) if (lbs[k]?.rating) return { key: k, ...lbs[k] };
  return null;
}
export function searchBox({ large = false, placeholder = 'Search players by name…', onPick, autofocus = false, id } = {}) {
  const input = el('input', { type: 'search', placeholder, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search players', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', id });
  const results = el('div', { class: 'search-results', role: 'listbox', hidden: true });
  const wrap = el('div', { class: `search ${large ? 'lg' : ''}` },
    el('span', { class: 'search-icon', html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' }),
    input, results);
  let items = []; let active = -1; let seq = 0;

  const pick = p => { hide(); input.value = ''; (onPick ?? (x => navigate(`/player/${x.profile_id}`)))(p); };
  const hide = () => { results.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const show = () => { results.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const render = () => {
    clear(results);
    if (!items.length) { results.append(el('div', { class: 'search-empty' }, 'No players found')); return; }
    items.forEach((p, i) => {
      const m = bestMode(p);
      const row = el('a', { class: 'search-result', role: 'option', href: hrefTo(`/player/${p.profile_id}`), 'aria-selected': String(i === active), onClick: e => { e.preventDefault(); pick(p); } },
        avatarImg(p),
        el('div', { style: { minWidth: 0 } }, el('div', { class: 'name' }, countryFlag(p.country), el('span', {}, p.name)),
          el('div', { class: 'sub' }, m ? `${modeShort(m.key)} · ${parseRankLevel(m.rank_level).label}` : (p.last_game_at ? `Last game ${fmt.rel(p.last_game_at)}` : 'No ranked games'))),
        el('div', { class: 'rating' }, m ? fmt.int(m.rating) : '', m?.rank ? el('small', {}, `#${fmt.int(m.rank)}`) : null));
      results.append(row);
    });
  };
  const search = debounce(async q => {
    const my = ++seq;
    if (q.length < 3) { clear(results); results.append(el('div', { class: 'search-empty' }, 'Type at least 3 characters')); show(); return; }
    try {
      const d = await api.searchPlayers(q);
      if (my !== seq) return;
      const ql = q.toLowerCase();
      items = (d.players || []).slice().sort((a, b) => {
        const ea = a.name?.toLowerCase() === ql ? 1 : 0, eb = b.name?.toLowerCase() === ql ? 1 : 0;
        if (ea !== eb) return eb - ea;
        const ra = bestMode(a)?.rating ?? 0, rb = bestMode(b)?.rating ?? 0;
        if (ra !== rb) return rb - ra;
        return new Date(b.last_game_at || 0) - new Date(a.last_game_at || 0);
      }).slice(0, 8);
      active = -1; render(); show();
    } catch (e) { if (my !== seq) return; clear(results); results.append(el('div', { class: 'search-empty' }, 'Search failed — try again')); show(); }
  }, 250);

  input.addEventListener('input', () => { const q = input.value.trim(); if (!q) { hide(); return; } search(q); });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 3 && items.length) show(); });
  input.addEventListener('keydown', e => {
    if (results.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter') { if (active >= 0 && items[active]) { e.preventDefault(); pick(items[active]); } else if (items[0]) { e.preventDefault(); pick(items[0]); } }
    else if (e.key === 'Escape') hide();
  });
  document.addEventListener('pointerdown', e => { if (!wrap.contains(e.target)) hide(); });
  if (autofocus) setTimeout(() => input.focus(), 0);
  wrap.input = input;
  return wrap;
}

/* ---------- mode tabs (shared by player + compare) ---------- */
export function modeTabs(modes, current, hrefFor) {
  return segmented(modes.map(m => ({ value: m.key, label: m.short, href: hrefFor(m.key), title: m.name })), current, null, { ariaLabel: 'Game mode' });
}
export { LEADERBOARDS, divergingColor };
