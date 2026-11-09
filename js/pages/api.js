// API console: build, send and inspect requests against every data source Forge uses.
// Everything runs in your browser; the official API and the companion endpoints go through server.py.
import { el, clear, append, fmt, qs, setTitle } from '../util.js';
import { API_BASE, RELIC_PROXY, CIVS } from '../constants.js';
import { card, notice, segmented, searchBox, select, dataTable } from '../components.js';
import { pageHead, isLocalHost, companionHint } from './_shared.js';

/* ------------------------------------------------------------------ sources & catalogue */
const UPSTREAM_OFFICIAL = 'https://aoe-api.worldsedgelink.com/community/';
export const SOURCES = {
  aoe4world: { label: 'AoE4 World', base: API_BASE, note: 'Community API with CORS: the browser calls aoe4world.com directly. No key. Be gentle: cache, no crawling.' },
  data:      { label: 'Game data', base: 'https://data.aoe4world.com', note: 'Static JSON from the aoe4world/data repository: civilizations, units, buildings, technologies, with icon URLs.' },
  official:  { label: 'Official API', base: `${RELIC_PROXY}/`, upstream: UPSTREAM_OFFICIAL, companion: true, note: 'World’s Edge community API, the backend the game itself uses. It sends no CORS headers, so the request goes through the companion proxy (server.py), which allows a short list of read endpoints and adds title=age4.' },
  local:     { label: 'Companion', base: 'local/', companion: true, note: 'Endpoints served by server.py: your games, replay analysis, playstyle profiles, the replay store and harvester, and the Forge Cup.' },
};

const LBS = ['rm_solo', 'rm_team', 'qm_1v1', 'qm_2v2', 'qm_3v3', 'qm_4v4'];
const STAT_LBS = ['rm_solo', 'rm_2v2', 'qm_1v1', 'qm_2v2', 'qm_3v3', 'qm_4v4'];
const RANKS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'conqueror', '≤silver', '≥gold', '≥platinum', '≥diamond', '≥conqueror', '≥conqueror_4'];
const P = (name, hint, { ex = '', path = false, req = false, options = null, id = false } = {}) => ({ name, hint, ex, in: path ? 'path' : 'query', required: req || path, options, id });
const ID = (name, hint, extra = {}) => P(name, hint, { ...extra, id: true });

export const ENDPOINTS = [
  // ----- AoE4 World -----
  { id: 'search', src: 'aoe4world', label: 'Search players', path: '/players/search', params: [P('query', 'name, at least 3 characters', { ex: 'beasty', req: true }), P('page', 'page number', { ex: '1' })] },
  { id: 'autocomplete', src: 'aoe4world', label: 'Autocomplete players', path: '/players/autocomplete', params: [P('leaderboard', 'ladder', { ex: 'rm_solo', req: true, options: LBS }), P('query', 'name, at least 3 characters', { ex: 'bea', req: true }), P('limit', 'max results', { ex: '8' })] },
  { id: 'player', src: 'aoe4world', label: 'Player profile', path: '/players/{id}', params: [ID('id', 'profile id', { path: true, ex: '6520235' })], note: 'All modes with rating history, civilization pool and previous seasons.' },
  { id: 'player_games', src: 'aoe4world', label: 'Player games', path: '/players/{id}/games', params: [ID('id', 'profile id', { path: true, ex: '6520235' }), P('leaderboard', 'filter by ladder', { options: LBS }), ID('opponent_profile_id', 'only games against this player'), P('since', 'ISO date or unix time'), P('page', 'page number', { ex: '1' }), P('limit', 'games per page, up to 50', { ex: '50' })] },
  { id: 'last_game', src: 'aoe4world', label: 'Last game', path: '/players/{id}/games/last', params: [ID('id', 'profile id', { path: true, ex: '6520235' }), P('include_stats', 'per-player in-game stats', { options: ['true'] }), P('include_alts', 'include alternate accounts', { options: ['true'] })] },
  { id: 'game', src: 'aoe4world', label: 'One game', path: '/players/{id}/games/{game_id}', params: [ID('id', 'profile id', { path: true, ex: '6520235' }), P('game_id', 'game id', { path: true })] },
  { id: 'leaderboard', src: 'aoe4world', label: 'Leaderboard', path: '/leaderboards/{key}', params: [P('key', 'ladder', { path: true, ex: 'rm_solo', options: LBS }), P('page', 'page number (50 per page)', { ex: '1' }), P('query', 'name filter'), P('country', 'two-letter country code', { ex: 'us' }), ID('profile_id', 'one or more profile ids, comma-separated'), P('time', 'unix time for a historic snapshot')] },
  { id: 'games', src: 'aoe4world', label: 'Games feed', path: '/games', params: [P('leaderboard', 'rm_1v1, rm_2v2, rm_3v3, rm_4v4, qm_1v1 … qm_4v4', { options: ['rm_1v1', 'rm_2v2', 'rm_3v3', 'rm_4v4', 'qm_1v1', 'qm_2v2', 'qm_3v3', 'qm_4v4'] }), P('order', 'started_at or updated_at', { options: ['started_at', 'updated_at'] }), P('since', 'ISO date or unix time'), P('updated_since', 'ISO date or unix time'), P('per_page', 'games per page', { ex: '50' }), P('page', 'page number, up to 20', { ex: '1' })], note: 'Live feed. Ongoing games carry ongoing: true and null ratings.' },
  { id: 'stats_civs', src: 'aoe4world', label: 'Civilization stats', path: '/stats/{lb}/civilizations', params: [P('lb', 'ladder', { path: true, ex: 'rm_solo', options: STAT_LBS }), P('patch', 'patch number(s), comma-separated'), P('rank_level', 'rank bracket (ranked only)', { options: RANKS }), P('rating', 'rating filter, e.g. >1200')] },
  { id: 'stats_matchups', src: 'aoe4world', label: 'Matchup stats', path: '/stats/{lb}/matchups', params: [P('lb', 'rm_solo or qm_1v1', { path: true, ex: 'rm_solo', options: ['rm_solo', 'qm_1v1'] }), P('patch', 'patch number(s)'), P('rank_level', 'rank bracket', { options: RANKS }), P('rating', 'rating filter, e.g. >1200')] },
  { id: 'stats_maps', src: 'aoe4world', label: 'Map stats', path: '/stats/{lb}/maps', params: [P('lb', 'rm_solo, qm_1v1 or rm_2v2', { path: true, ex: 'rm_solo', options: ['rm_solo', 'qm_1v1', 'rm_2v2'] }), P('patch', 'patch number(s)'), P('rank_level', 'rank bracket', { options: RANKS }), P('rating', 'rating filter'), P('include_civs', 'per-map civ stats (slow)', { options: ['true'] })] },
  { id: 'stats_map', src: 'aoe4world', label: 'One map', path: '/stats/{lb}/maps/{map_id}', params: [P('lb', 'ladder', { path: true, ex: 'rm_solo', options: ['rm_solo', 'qm_1v1', 'rm_2v2'] }), P('map_id', 'map id from the map stats', { path: true }), P('patch', 'patch number(s)'), P('rank_level', 'rank bracket', { options: RANKS }), P('rating', 'rating filter')] },
  { id: 'stats_teams', src: 'aoe4world', label: 'Team compositions', path: '/stats/{lb}/teams', params: [P('lb', 'qm_2v2 or qm_3v3', { path: true, ex: 'qm_2v2', options: ['qm_2v2', 'qm_3v3'] }), P('patch', 'patch number(s)'), P('rating', 'rating filter')] },
  { id: 'esports', src: 'aoe4world', label: 'Esports Elo', path: '/esports/leaderboards/1', params: [P('page', 'page number', { ex: '1' }), P('query', 'name filter'), P('country', 'country code'), P('show_inactive', 'include inactive players', { options: ['true'] })] },
  { id: 'aoe4world_custom', src: 'aoe4world', label: 'Custom path…', custom: true, ex: '/players/6520235/games?limit=5' },
  // ----- static game data -----
  { id: 'civ_data', src: 'data', label: 'Civilization', path: '/civilizations/{slug}.json', params: [P('slug', 'civilization slug', { path: true, ex: 'english', options: Object.keys(CIVS) })], note: 'Description, bonuses and overview of one civilization. Units, buildings and technologies live in the all.json files below (filter by civs).' },
  { id: 'units_all', src: 'data', label: 'All units', path: '/units/all.json', params: [] },
  { id: 'buildings_all', src: 'data', label: 'All buildings', path: '/buildings/all.json', params: [] },
  { id: 'techs_all', src: 'data', label: 'All technologies', path: '/technologies/all.json', params: [] },
  { id: 'data_custom', src: 'data', label: 'Custom path…', custom: true, ex: '/units/english/longbowman-2.json' },
  // ----- official API (through the proxy) -----
  { id: 'wl_lbs', src: 'official', label: 'Available leaderboards', path: 'leaderboard/getAvailableLeaderboards', params: [], note: '127 ladders: ids 1–4 are ranked 1v1–4v4, 17–20 Quick Match 1v1–4v4, 206+ console, 479+ Empire Wars.' },
  { id: 'wl_lb', src: 'official', label: 'Leaderboard (raw)', path: 'leaderboard/getLeaderBoard2', params: [P('leaderboard_id', 'ladder id (1 = ranked 1v1, 17 = QM 1v1)', { ex: '1', req: true }), P('start', 'first rank', { ex: '1' }), P('count', 'rows, up to 200', { ex: '50' }), P('sortBy', '1 = rating, 0 = rank', { ex: '1', options: ['1', '0'] }), P('platform', 'platform', { ex: 'PC_STEAM', options: ['PC_STEAM', 'PC_XBOX', 'XBOX', 'PSN'] })] },
  { id: 'wl_personal', src: 'official', label: 'Personal stats', path: 'leaderboard/getPersonalStat', params: [ID('profile_ids', 'JSON array of profile ids', { ex: '[6520235]', req: true })], note: 'Every official ladder the player appears on, plus account level and XP.' },
  { id: 'wl_history', src: 'official', label: 'Recent match history', path: 'leaderboard/getRecentMatchHistory', params: [ID('profile_ids', 'JSON array of profile ids', { ex: '[6520235]', req: true })], note: 'Per-match counters (units produced/killed/lost, buildings, upgrades, commands) as a JSON string in counters.' },
  { id: 'wl_replays', src: 'official', label: 'Replay files', path: 'leaderboard/getReplayFiles', params: [P('matchIDs', 'JSON array of match ids', { ex: '[123456789]', req: true })], note: 'One signed download URL per player perspective, valid for a few minutes. size −1 means missing.' },
  { id: 'official_custom', src: 'official', label: 'Custom path…', custom: true, ex: 'leaderboard/getAvailableLeaderboards', note: 'The proxy only forwards the allowed endpoints; anything else answers 403 with the list.' },
  // ----- companion -----
  { id: 'cfg', src: 'local', label: 'Config', path: 'config', params: [] },
  { id: 'my_games', src: 'local', label: 'My games', path: 'games', params: [P('refresh', 'refetch from AoE4 World', { options: ['1'] })] },
  { id: 'my_game', src: 'local', label: 'My game (detail)', path: 'games/{id}', params: [P('id', 'game id', { path: true }), P('fetch', 'download the replay if missing', { options: ['1'] })] },
  { id: 'game_detail', src: 'local', label: 'Game summary (any player)', path: 'game/{id}', params: [P('id', 'game id', { path: true }), ID('profile', 'profile id of the viewed player', { ex: '6520235' }), P('fetch', 'download the replay if missing', { ex: '1', options: ['1'] })] },
  { id: 'profile', src: 'local', label: 'Playstyle profile', path: 'profile/{pid}', params: [ID('pid', 'profile id', { path: true, ex: '6520235' }), P('n', 'replays wanted, up to 40', { ex: '10' }), P('budget', 'seconds to spend fetching, 2–45', { ex: '20' }), P('civ', 'only games as this civilization', { options: Object.keys(CIVS) }), P('vs', 'only games against this civilization', { options: Object.keys(CIVS) }), P('kind', 'only these game kinds, comma-separated', { ex: 'rm_1v1' }), P('refresh', 'rebuild from scratch', { options: ['1'] })] },
  { id: 'harvest', src: 'local', label: 'Replay harvest (background)', path: 'harvest/{pid}', params: [ID('pid', 'profile id', { path: true, ex: '6520235' }), P('start', 'queue a harvest of this player’s whole history', { options: ['1'] }), P('pages', 'pages of history to list (50 games each), up to 40', { ex: '20' }), P('stop', 'stop after the current replay', { options: ['1'] })] },
  { id: 'store', src: 'local', label: 'Store overview', path: 'store', params: [] },
  { id: 'scan', src: 'local', label: 'Scan local replays', path: 'scan', params: [] },
  { id: 'cup_state', src: 'local', label: 'Cup state', path: 'tournament/state', params: [ID('as', 'view as this profile id')] },
  { id: 'cup_action', src: 'local', label: 'Cup action (POST)', method: 'POST', path: 'tournament/{action}', params: [P('action', 'action name', { path: true, ex: 'signup', options: ['signup', 'withdraw', 'lockin', 'draft', 'report', 'verify', 'seed_demo', 'form_brackets', 'clock', 'reset'] }), ID('as', 'perspective for the returned state'), P('key', 'admin key (seed_demo, form_brackets, clock, reset)')], body: '{\n  "profile_id": __ME__,\n  "slot": "sat_18",\n  "civs": ["english", "french", "rus"]\n}', note: 'Body fields by action: signup {profile_id, slot, civs, ladder} · withdraw / lockin {profile_id} · seed_demo {profile_id, n} · form_brackets {slot, force} · draft {match, profile_id, value, side} · report {match, game, winner} · verify {match} · clock {target, slot} · reset {}. The response is the Cup state plus result.' },
  { id: 'local_custom', src: 'local', label: 'Custom path…', custom: true, ex: 'profile/6520235?n=4&budget=6' },
];

const PRESETS = [
  { label: 'Top of Solo RM', ep: 'leaderboard', params: { key: 'rm_solo', page: '1' } },
  { label: 'Beasty’s profile', ep: 'player', params: { id: '8139502' } },
  { label: 'Live ranked 1v1s', ep: 'games', params: { leaderboard: 'rm_1v1', order: 'updated_at', per_page: '20' } },
  { label: 'English civ data', ep: 'civ_data', params: { slug: 'english' } },
  { label: 'Official ladders', ep: 'wl_lbs', params: {} },
];

/* ------------------------------------------------------------------ persistence */
const HIST_KEY = 'forge-api-history', SAVED_KEY = 'forge-api-saved';
const readList = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const writeList = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/* ------------------------------------------------------------------ helpers */
const joinUrl = (base, path) => `${base.replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
const endpointOf = st => ENDPOINTS.find(e => e.id === st.ep) || ENDPOINTS.find(e => e.src === st.src);
const sameSource = (st, id) => ENDPOINTS.find(e => e.id === id)?.src === st.src;

/** Browser-side request URL for the current state. */
export function buildUrl(st) {
  const S = SOURCES[st.src]; const ep = endpointOf(st);
  if (ep.custom) return joinUrl(S.base, st.custom || '');
  const path = ep.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(st.params[k] ?? '').trim()));
  const query = {};
  for (const prm of ep.params) if (prm.in === 'query' && String(st.params[prm.name] ?? '').trim() !== '') query[prm.name] = String(st.params[prm.name]).trim();
  return joinUrl(S.base, path) + qs(query);
}
/** The URL a terminal would call: absolute, and for the official API the upstream host with title=age4. */
export function terminalUrl(st, url) {
  const S = SOURCES[st.src];
  if (S.upstream) {
    const rel = url.slice(S.base.length);
    const u = new URL(joinUrl(S.upstream, rel), 'https://x/');
    u.searchParams.set('title', 'age4');
    return u.href;
  }
  return new URL(url, location.href).href;
}
const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const isPlainObj = v => v && typeof v === 'object' && !Array.isArray(v);
/** Walk `a.b[0].c`; `*` maps over an array (or an object's values): `players[*].name`. */
export function getPath(obj, path) {
  const parts = String(path || '').trim().match(/[^.[\]]+/g) || [];
  const walk = (cur, i) => {
    for (; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      const p = parts[i];
      if (p === '*') return Array.isArray(cur) ? cur.map(x => walk(x, i + 1)) : isPlainObj(cur) ? Object.values(cur).map(x => walk(x, i + 1)) : undefined;
      cur = cur[p];
    }
    return cur;
  };
  return walk(obj, 0);
}
const summary = v => Array.isArray(v) ? `array · ${fmt.int(v.length)} items` : isPlainObj(v) ? `object · ${fmt.int(Object.keys(v).length)} keys` : typeOf(v);
const bytesFmt = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { return flash(btn, 'Copy failed'); }
  flash(btn, 'Copied');
}
function flash(btn, msg) { if (!btn) return; const old = btn.textContent; btn.textContent = msg; setTimeout(() => { btn.textContent = old; }, 1200); }

/* ------------------------------------------------------------------ JSON tree */
const MAX_CHILDREN = 200;
function leafNode(v) {
  const t = typeOf(v);
  if (t === 'string') return el('span', { class: 's' }, JSON.stringify(v.length > 300 ? v.slice(0, 300) + '…' : v));
  if (t === 'number') return el('span', { class: 'n' }, String(v));
  if (t === 'boolean') return el('span', { class: 'b' }, String(v));
  return el('span', { class: 'z' }, 'null');
}
function treeNode(key, v, path, depth, onDrill) {
  const keyEl = key === null ? null : el('span', { class: 'k' }, Array.isArray(key) ? `[${key[0]}]` : key, el('span', { class: 'meta' }, ':'));
  const drill = path ? el('button', { type: 'button', class: 'drill', title: 'Drill into this node', onClick: e => { e.preventDefault(); e.stopPropagation(); onDrill(path); } }, 'drill ›') : null;
  if (!v || typeof v !== 'object') return el('div', { class: 'leaf' }, keyEl, leafNode(v), drill);
  const entries = Array.isArray(v) ? v.map((x, i) => [[i], x]) : Object.entries(v);
  const det = el('details', { open: depth < 1 ? true : null });
  const brief = entries.length ? (Array.isArray(v) ? `${fmt.int(entries.length)} items` : `${fmt.int(entries.length)} keys`) : (Array.isArray(v) ? 'empty array' : 'empty object');
  det.append(el('summary', {}, keyEl, el('span', { class: 'meta' }, Array.isArray(v) ? `[ ${brief} ]` : `{ ${brief} }`), drill));
  let built = false;
  const build = () => {
    if (built) return; built = true;
    const box = el('div', { class: 'children' });
    entries.slice(0, MAX_CHILDREN).forEach(([k, x]) => {
      const childPath = Array.isArray(k) ? `${path}[${k[0]}]` : (path ? `${path}.${k}` : k);
      box.append(treeNode(k, x, childPath, depth + 1, onDrill));
    });
    if (entries.length > MAX_CHILDREN) box.append(el('div', { class: 'leaf meta' }, `… ${fmt.int(entries.length - MAX_CHILDREN)} more. Use a path like ${path}[${MAX_CHILDREN}] or the table view.`));
    det.append(box);
  };
  if (det.open) build();
  det.addEventListener('toggle', () => { if (det.open) build(); });
  return det;
}
export function jsonTree(value, onDrill, rootPath = '') {
  return el('div', { class: 'json-tree' }, treeNode(null, value, rootPath, 0, onDrill));
}

/* ------------------------------------------------------------------ table view */
function arrayCandidates(v, prefix = '') {
  const out = [];
  const isRowArray = a => Array.isArray(a) && a.length && a.every(x => isPlainObj(x));
  if (isRowArray(v)) out.push({ path: prefix, rows: v });
  if (isPlainObj(v)) for (const [k, x] of Object.entries(v)) { if (isRowArray(x)) out.push({ path: prefix ? `${prefix}.${k}` : k, rows: x }); }
  if (Array.isArray(v) && v.length && v.every(x => !isPlainObj(x) && typeof x !== 'object')) out.push({ path: prefix, rows: v.map((x, i) => ({ index: i, value: x })) });
  return out;
}
function tableFor(rows) {
  const keys = []; const seen = new Set();
  for (const r of rows.slice(0, 500)) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  const cols = keys.slice(0, 40).map(k => ({
    key: k, label: k, num: rows.some(r => typeof r[k] === 'number'),
    sortValue: r => { const v = r[k]; return v && typeof v === 'object' ? null : v; },
    render: r => { const v = r[k]; if (v === undefined) return '—'; if (v === null) return el('span', { class: 'muted' }, 'null'); if (Array.isArray(v)) return el('span', { class: 'muted', title: JSON.stringify(v).slice(0, 400) }, `[${v.length}]`); if (typeof v === 'object') return el('span', { class: 'muted', title: JSON.stringify(v).slice(0, 400) }, `{${Object.keys(v).length}}`); const s = String(v); return s.length > 80 ? el('span', { title: s }, s.slice(0, 80) + '…') : s; },
  }));
  return el('div', { class: 'api-table-wrap' }, dataTable({ columns: cols, rows, compact: true }), keys.length > 40 ? el('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '6px' } }, `Showing 40 of ${keys.length} columns; drill into a node to see the rest.`) : null);
}

/* ------------------------------------------------------------------ page */
export async function render(app, route) {
  setTitle('API console');
  const q = route.query || {};
  const st = {
    src: SOURCES[q.src] ? q.src : 'aoe4world', ep: q.ep || 'leaderboard', params: {}, custom: q.custom || '', body: '',
    view: ['tree', 'raw', 'table'].includes(q.view) ? q.view : 'tree', path: q.path || '', expr: '',
  };
  if (!sameSource(st, st.ep)) st.ep = ENDPOINTS.find(e => e.src === st.src).id;
  for (const [k, v] of Object.entries(q)) if (k.startsWith('p_')) st.params[k.slice(2)] = v;
  if (!Object.keys(st.params).length && !q.ep) st.params = { key: 'rm_solo', page: '1' };
  let resp = null; let cfg = null; let busy = false;

  // companion config, for "me" and friends quick-inserts (only when the companion is reachable)
  try { const r = await fetch('local/config', { headers: { Accept: 'application/json' } }); if (r.ok && (r.headers.get('content-type') || '').includes('json')) cfg = await r.json(); } catch { cfg = null; }

  app.append(pageHead('API console', 'Query every data source behind Forge from your browser: pick an endpoint, fill the parameters, send, then drill into the response or lay it out as a table. Requests stay on this machine; history is kept in this browser only.'));
  const layout = el('div', { class: 'api-layout' });
  const builderCol = el('div', { class: 'api-col' }); const respCol = el('div', { class: 'api-col' });
  layout.append(builderCol, respCol); app.append(layout);

  const syncUrl = () => {
    const ep = endpointOf(st);
    const query = { src: st.src, ep: st.ep, view: st.view !== 'tree' ? st.view : undefined, path: st.path || undefined, custom: ep.custom ? st.custom : undefined };
    if (!ep.custom) for (const [k, v] of Object.entries(st.params)) if (String(v ?? '').trim() !== '') query[`p_${k}`] = v;
    history.replaceState(null, '', `#/api${qs(query)}`);
  };

  /* ---------- builder ---------- */
  const bodyFor = ep => (ep.body || '').replace('__ME__', String(cfg?.me || 6520235));
  const builder = el('div', { class: 'api-builder' });
  function drawBuilder() {
    clear(builder);
    const S = SOURCES[st.src]; const ep = endpointOf(st);
    builder.append(segmented(Object.entries(SOURCES).map(([k, s]) => ({ value: k, label: s.label })), st.src, v => {
      st.src = v; st.ep = ENDPOINTS.find(e => e.src === v).id; st.params = {}; st.custom = ''; st.body = ''; drawBuilder(); syncUrl();
    }, { ariaLabel: 'Data source' }));
    builder.append(el('p', { class: 'muted api-note' }, S.note));
    if (S.companion && !cfg) builder.append(notice(el('strong', {}, isLocalHost() ? 'Companion not running. ' : 'Not available on this static deployment. '), ...companionHint()));

    const epSel = select(ENDPOINTS.filter(e => e.src === st.src).map(e => ({ value: e.id, label: e.label })), ep.id, v => {
      st.ep = v; const next = endpointOf(st); st.params = {}; st.custom = ''; st.body = bodyFor(next);
      for (const prm of next.params || []) if (prm.ex && (prm.required || prm.in === 'path')) st.params[prm.name] = prm.ex;
      drawBuilder(); syncUrl();
    }, { ariaLabel: 'Endpoint' });
    builder.append(el('div', { class: 'field' }, el('label', { class: 'small' }, 'Endpoint'), epSel));
    if (ep.note) builder.append(el('p', { class: 'muted api-note' }, ep.note));

    if (ep.custom) {
      const inp = el('input', { type: 'text', value: st.custom, placeholder: ep.ex, spellcheck: 'false', 'aria-label': 'Path and query', onInput: e => { st.custom = e.target.value; urlBox.textContent = buildUrl(st); syncUrl(); }, onKeydown: e => { if (e.key === 'Enter') send(); } });
      builder.append(el('div', { class: 'field' }, el('label', { class: 'small' }, 'Path and query, appended to ', el('code', {}, S.upstream || S.base)), inp));
    } else if (ep.params.length) {
      const grid = el('div', { class: 'param-grid' });
      for (const prm of ep.params) {
        const listId = prm.options ? `dl-${ep.id}-${prm.name}` : null;
        const inp = el('input', { type: 'text', value: st.params[prm.name] ?? '', placeholder: prm.ex || (prm.required ? 'required' : 'optional'), list: listId, spellcheck: 'false', 'aria-label': prm.name, autocomplete: 'off',
          onInput: e => { st.params[prm.name] = e.target.value; urlBox.textContent = buildUrl(st); syncUrl(); }, onKeydown: e => { if (e.key === 'Enter') send(); } });
        const dl = listId ? el('datalist', { id: listId }, prm.options.map(o => el('option', { value: o }))) : null;
        grid.append(el('div', { class: 'param-row' },
          el('div', { class: 'pname' }, el('span', {}, prm.name, prm.required ? el('span', { class: 'req', title: 'required' }, '*') : null), el('small', {}, prm.in === 'path' ? 'in path · ' : '', prm.hint)),
          el('div', {}, inp, dl)));
      }
      builder.append(grid);
      // quick inserts for id-like params
      const idParams = ep.params.filter(p => p.id);
      if (idParams.length) {
        const target = idParams[0];
        const setId = id => { st.params[target.name] = target.name === 'profile_ids' ? `[${id}]` : String(id); drawBuilder(); syncUrl(); };
        const chips = el('div', { class: 'api-chips' });
        if (cfg?.me) chips.append(el('button', { type: 'button', class: 'chip', onClick: () => setId(cfg.me) }, `Me · ${cfg.me}`));
        for (const f of (cfg?.friends || []).slice(0, 6)) chips.append(el('button', { type: 'button', class: 'chip', title: String(f.profile_id), onClick: () => setId(f.profile_id) }, f.name || f.profile_id));
        builder.append(el('div', { class: 'field' }, el('label', { class: 'small' }, `Insert a player id into ${target.name}`),
          searchBox({ placeholder: 'Find a player by name…', onPick: p => setId(p.profile_id) }), chips.childElementCount ? chips : null));
      }
    }
    if (ep.method === 'POST') {
      builder.append(el('div', { class: 'field' }, el('label', { class: 'small' }, 'JSON body'),
        el('textarea', { spellcheck: 'false', 'aria-label': 'Request body', onInput: e => { st.body = e.target.value; } }, st.body || bodyFor(ep))));
      if (!st.body) st.body = bodyFor(ep);
    }

    const urlBox = el('div', { class: 'api-url', title: 'Request URL as the browser sends it' }, buildUrl(st));
    builder.append(el('div', { class: 'field' }, el('label', { class: 'small' }, 'Request'), urlBox));
    const sendBtn = el('button', { type: 'button', class: 'btn primary', onClick: () => send(), disabled: busy ? true : null }, busy ? 'Sending…' : `Send ${ep.method || 'GET'}`);
    builder.append(el('div', { class: 'api-toolbar' }, sendBtn,
      el('button', { type: 'button', class: 'btn sm ghost', onClick: e => copy(buildUrl(st).startsWith('http') ? buildUrl(st) : terminalUrl(st, buildUrl(st)), e.currentTarget) }, 'Copy URL'),
      el('button', { type: 'button', class: 'btn sm ghost', onClick: e => copy(asCurl(), e.currentTarget) }, 'Copy as curl'),
      el('button', { type: 'button', class: 'btn sm ghost', onClick: e => copy(asPython(), e.currentTarget) }, 'Copy as Python'),
      el('button', { type: 'button', class: 'btn sm ghost', onClick: e => copy(asCli(), e.currentTarget) }, 'Copy as CLI')));
  }
  const asCurl = () => { const u = terminalUrl(st, buildUrl(st)); const ep = endpointOf(st); return ep.method === 'POST' ? `curl -sS -X POST -H 'Content-Type: application/json' -d '${(st.body || '{}').replace(/\n\s*/g, ' ')}' '${u}'` : `curl -sS -H 'Accept: application/json' '${u}'`; };
  const asPython = () => { const u = terminalUrl(st, buildUrl(st)); return `import json, urllib.request\n\nurl = ${JSON.stringify(u)}\nreq = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "Forge API console (personal use)"})\nwith urllib.request.urlopen(req, timeout=30) as r:\n    data = json.load(r)\nprint(json.dumps(data, indent=2)[:2000])`; };
  const asCli = () => {
    const ep = endpointOf(st); const u = buildUrl(st); const S = SOURCES[st.src];
    const rel = u.slice(S.base.length).replace(/^\/+/, '');
    return `py -3 tools/api.py ${st.src} ${rel.includes(' ') ? JSON.stringify('/' + rel) : '/' + rel}${ep.method === 'POST' ? ` --post '${(st.body || '{}').replace(/\n\s*/g, ' ')}'` : ''}`;
  };

  /* ---------- response ---------- */
  const respBox = el('div');
  const historyBox = el('div');
  function drawResponse() {
    clear(respBox);
    if (!resp) { respBox.append(el('div', { class: 'empty' }, 'No request sent yet. Pick an endpoint, fill the parameters and press Send, or try a preset below.'),
      el('div', { class: 'api-chips', style: { justifyContent: 'center' } }, PRESETS.map(p => el('button', { type: 'button', class: 'chip', onClick: () => { const ep = ENDPOINTS.find(e => e.id === p.ep); st.src = ep.src; st.ep = ep.id; st.params = { ...p.params }; st.custom = ''; drawBuilder(); syncUrl(); send(); } }, p.label)))); return; }
    const ok = resp.status >= 200 && resp.status < 300;
    const status = el('div', { class: 'api-status' },
      el('span', { class: `pill ${resp.status === 0 ? 'neutral' : ok ? 'win' : 'loss'}` }, resp.status ? `${resp.status} ${resp.statusText || ''}`.trim() : 'network error'),
      el('span', {}, `${fmt.int(resp.ms)} ms`), el('span', {}, bytesFmt(resp.bytes)),
      resp.type ? el('span', { class: 'muted', title: resp.type }, resp.type.split(';')[0]) : null,
      resp.cache ? el('span', { class: 'muted', title: 'Companion cache (the proxy keeps official responses for 60 s)' }, `cache ${resp.cache}`) : null,
      el('span', { class: 'muted' }, fmt.rel ? fmt.rel(resp.at) : ''),
      el('span', { class: 'spacer' }),
      el('a', { class: 'btn sm ghost', href: resp.url, target: '_blank', rel: 'noopener' }, 'Open raw ↗'),
      el('button', { type: 'button', class: 'btn sm ghost', onClick: e => copy(resp.text, e.currentTarget) }, 'Copy JSON'),
      el('button', { type: 'button', class: 'btn sm ghost', onClick: () => download() }, 'Download'));
    respBox.append(status);
    if (resp.upstream && resp.upstream !== resp.url) respBox.append(el('div', { class: 'api-url muted', style: { marginBottom: '10px' } }, 'upstream ', resp.upstream));
    if (resp.error) respBox.append(notice(el('strong', {}, 'Request failed. '), resp.error, ' ', SOURCES[st.src].companion && !cfg ? el('span', {}, ...companionHint()) : null));
    if (resp.companionMissing) { respBox.append(notice(el('strong', {}, 'This source needs the companion. '), ...companionHint())); return; }
    if (resp.data === undefined) { if (resp.text) respBox.append(el('pre', { class: 'json-raw' }, resp.text.slice(0, 20000))); return; }

    // query row
    let view = resp.data; let viewErr = null;
    try { view = getPath(resp.data, st.path); } catch (e) { viewErr = e.message; }
    if (st.expr.trim()) { try { view = Function('data', 'root', `"use strict"; return (${st.expr});`)(view, resp.data); } catch (e) { viewErr = e.message; } }
    // `change` fires on Enter and on blur for text inputs; a keydown handler as well would redraw twice.
    const pathInp = el('input', { type: 'text', value: st.path, placeholder: 'path, e.g. games[0].teams or players[*].name', spellcheck: 'false', 'aria-label': 'Path into the response', onChange: e => { if (e.target.value === st.path) return; st.path = e.target.value; syncUrl(); drawResponse(); } });
    const exprInp = el('input', { type: 'text', value: st.expr, placeholder: 'JS over data, e.g. data.filter(g => g.duration > 1800).length', spellcheck: 'false', 'aria-label': 'JavaScript expression', onChange: e => { if (e.target.value === st.expr) return; st.expr = e.target.value; drawResponse(); } });
    respBox.append(el('div', { class: 'api-query' },
      el('label', {}, el('span', { class: 'small muted' }, 'Path'), pathInp),
      el('label', {}, el('span', { class: 'small muted' }, 'Expression'), exprInp),
      (st.path || st.expr) ? el('button', { type: 'button', class: 'btn sm ghost', onClick: () => { st.path = ''; st.expr = ''; syncUrl(); drawResponse(); } }, 'Clear') : null));
    if (viewErr) { respBox.append(notice(el('strong', {}, 'Query error: '), viewErr)); return; }

    respBox.append(el('div', { class: 'api-toolbar' },
      segmented([{ value: 'tree', label: 'Tree' }, { value: 'raw', label: 'Raw' }, { value: 'table', label: 'Table' }], st.view, v => { st.view = v; syncUrl(); drawResponse(); }, { ariaLabel: 'View' }),
      el('span', { class: 'muted', style: { fontSize: '13px' } }, (st.path || st.expr) ? `${summary(view)} at ${st.path || 'expression'}` : summary(view))));
    const onDrill = p => { st.path = p; st.expr = ''; syncUrl(); drawResponse(); };
    if (st.view === 'tree') respBox.append(view === undefined ? el('div', { class: 'empty' }, 'Nothing at that path.') : jsonTree(view, onDrill, st.path.trim()));
    else if (st.view === 'raw') {
      const text = JSON.stringify(view ?? null, null, 2); const LIMIT = 200000;
      const pre = el('pre', { class: 'json-raw' }, text.length > LIMIT ? text.slice(0, LIMIT) : text);
      respBox.append(pre);
      if (text.length > LIMIT) respBox.append(el('button', { type: 'button', class: 'btn sm', style: { marginTop: '8px' }, onClick: e => { pre.textContent = text; e.currentTarget.remove(); } }, `Show all ${bytesFmt(text.length)}`));
    } else {
      const cands = arrayCandidates(view, st.path.trim());
      if (!cands.length) respBox.append(el('div', { class: 'empty' }, 'No array of records here. Drill into one in the tree view, or set a path such as games or leaderboardStats.'));
      else {
        let cur = cands[0];
        const holder = el('div');
        if (cands.length > 1) respBox.append(el('div', { class: 'api-toolbar' }, el('label', { class: 'small muted' }, 'Array '), select(cands.map(c => ({ value: c.path, label: `${c.path || '(root)'} · ${c.rows.length}` })), cur.path, v => { cur = cands.find(c => c.path === v); clear(holder); holder.append(tableFor(cur.rows)); })));
        holder.append(tableFor(cur.rows)); respBox.append(holder);
      }
    }
  }
  function download() {
    const blob = new Blob([resp.text], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${resp.url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_').slice(0, 80)}.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- history & saved ---------- */
  function drawHistory() {
    clear(historyBox);
    const saved = readList(SAVED_KEY); const hist = readList(HIST_KEY);
    const row = (h, { saved: isSaved } = {}) => el('div', { class: 'row', role: 'button', tabindex: '0', title: h.url, onClick: () => restore(h), onKeydown: e => { if (e.key === 'Enter') restore(h); } },
      el('span', { class: `pill ${h.status >= 200 && h.status < 300 ? 'win' : h.status ? 'loss' : 'neutral'}`, style: { fontSize: '11px' } }, h.status || 'ERR'),
      el('span', { class: 'src' }, SOURCES[h.src]?.label || h.src),
      el('span', { class: 'url' }, h.method === 'POST' ? 'POST ' : '', h.display),
      el('span', { class: 'muted when' }, `${fmt.int(h.ms)} ms`),
      isSaved
        ? el('button', { type: 'button', class: 'btn sm ghost', title: 'Remove from saved', onClick: e => { e.stopPropagation(); writeList(SAVED_KEY, saved.filter(x => x.key !== h.key)); drawHistory(); } }, '×')
        : el('button', { type: 'button', class: 'btn sm ghost', title: 'Save this request', onClick: e => { e.stopPropagation(); if (!saved.some(x => x.key === h.key)) writeList(SAVED_KEY, [h, ...saved].slice(0, 50)); drawHistory(); } }, '☆'));
    if (saved.length) historyBox.append(card('Saved requests', el('div', { class: 'api-history' }, saved.map(h => row(h, { saved: true }))), { level: 3 }));
    historyBox.append(card('History', hist.length ? el('div', { class: 'api-history' }, hist.map(h => row(h))) : el('div', { class: 'empty' }, 'Requests you send appear here.'),
      { level: 3, meta: `${hist.length} in this browser`, actions: hist.length ? el('button', { type: 'button', class: 'btn sm ghost', onClick: () => { writeList(HIST_KEY, []); drawHistory(); } }, 'Clear') : null }));
  }
  function restore(h) {
    st.src = h.src; st.ep = h.ep; st.params = { ...(h.params || {}) }; st.custom = h.custom || ''; st.body = h.body || ''; st.path = ''; st.expr = '';
    drawBuilder(); syncUrl(); send();
  }

  /* ---------- send ---------- */
  async function send() {
    if (busy) return;
    const ep = endpointOf(st); const S = SOURCES[st.src];
    const missing = (ep.params || []).filter(p => p.required && String(st.params[p.name] ?? '').trim() === '');
    if (missing.length) { respBox.replaceChildren(notice(el('strong', {}, 'Missing: '), missing.map(p => p.name).join(', '))); return; }
    const url = buildUrl(st); const method = ep.method || 'GET';
    busy = true; drawBuilder();
    const t0 = performance.now();
    const init = { method, headers: { Accept: 'application/json' } };
    if (method === 'POST') { init.headers['Content-Type'] = 'application/json'; init.body = st.body || '{}'; }
    const r = { url, upstream: S.upstream ? terminalUrl(st, url) : null, status: 0, statusText: '', ms: 0, bytes: 0, type: '', cache: null, text: '', data: undefined, at: Date.now(), error: null, companionMissing: false };
    try {
      const res = await fetch(url, init);
      r.status = res.status; r.statusText = res.statusText; r.type = res.headers.get('content-type') || ''; r.cache = res.headers.get('x-forge-cache');
      r.text = await res.text();
    } catch (e) { r.error = e.message || String(e); }
    r.ms = Math.round(performance.now() - t0); r.bytes = new Blob([r.text]).size;
    if (r.text) { try { r.data = JSON.parse(r.text); } catch { r.data = undefined; } }
    if (S.companion && (r.error || (r.data === undefined && r.status === 404))) r.companionMissing = true;
    resp = r; busy = false;
    const display = url.startsWith(S.base) ? url.slice(S.base.length) : url;
    const entry = { key: `${method} ${url}`, src: st.src, ep: st.ep, params: { ...st.params }, custom: st.custom, body: method === 'POST' ? st.body : '', method, url, display: display || '/', status: r.status, ms: r.ms, at: r.at };
    const hist = readList(HIST_KEY).filter(h => h.key !== entry.key);
    writeList(HIST_KEY, [entry, ...hist].slice(0, 40));
    drawBuilder(); drawResponse(); drawHistory();
  }

  drawBuilder(); drawResponse(); drawHistory();
  builderCol.append(card('Request', builder, { level: 2 }), historyBox);
  respCol.append(card('Response', respBox, { level: 2 }));
  if (q.run === '1') send();
}
