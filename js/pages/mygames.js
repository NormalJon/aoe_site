// My games: local companion view — your games merged with official counters and replay analysis.
import { el, fmt, setTitle, hrefTo, navigate, clear, append, sum } from '../util.js';
import { getJSON, ApiError } from '../api.js';
import { civChip, resultPill, dataTable, select, notice, skeleton, errorBox, statTile } from '../components.js';
import { civName, kindName } from '../constants.js';
import { pageHead } from './_shared.js';
import * as gamePage from './game.js';
import { tagChip } from './game.js';

const CIV_ALIAS = { abbasid: 'abbasid_dynasty', ayyubid: 'ayyubids', byzantine: 'byzantines', chinese: 'chinese', sultanate: 'delhi_sultanate', english: 'english', french: 'french', hre: 'holy_roman_empire', japanese: 'japanese', malian: 'malians', mongol: 'mongols', ottoman: 'ottomans', rus: 'rus', scots: 'scots', vikings: 'vikings', jeanne: 'jeanne_darc', lancaster: 'house_of_lancaster', templar: 'knights_templar', macedonian: 'macedonian_dynasty', tughlaq: 'tughlaq_dynasty', zhuxi: 'zhu_xis_legacy', jin: 'jin_dynasty', dragon: 'order_of_the_dragon', sengoku: 'sengoku_daimyo', golden_horde: 'golden_horde' };

const local = (path, opts = {}) => getJSON(`local/${path}`, { ttl: 30e3, ...opts });

export async function render(app, route) {
  setTitle('My games');
  let cfg;
  try { cfg = await local('config'); } catch (e) {
    app.append(pageHead('My games'), notice(el('strong', {}, 'This page needs the local companion. '), 'Start the site with ', el('code', {}, 'py -3 server.py'), ' and open ', el('code', {}, 'http://127.0.0.1:8000/'), '. The companion reads replays from your Age of Empires IV folder, so it only runs on your own machine.'));
    return;
  }
  if (!cfg.configured) {
    app.append(pageHead('My games'), notice('Create ', el('code', {}, 'forge.local.json'), ' next to server.py with your profile id and friends (see forge.local.example.json), then reload.'));
    return;
  }
  if (route.parts[1]) return renderDetail(app, cfg, route.parts[1], route);
  return renderList(app, cfg, route);
}

/* ============================== list ============================== */
async function renderList(app, cfg, route) {
  const q = route.query;
  const head = pageHead('My games', el('span', {}, 'Every game on your record, with official counters and replay analysis where available. Friends: ', cfg.friends.map((f, i) => [i ? ', ' : '', el('a', { href: hrefTo(`/player/${f.profile_id}`) }, f.name)])));
  const actions = el('div', { style: { display: 'flex', gap: '8px' } },
    el('button', { class: 'btn sm', type: 'button', onClick: async e => { e.target.disabled = true; e.target.textContent = 'Analysing…'; try { const r = await local('scan', { force: true, ttl: 0 }); e.target.textContent = `Analysed ${r.analysed}/${r.replays}`; } catch { e.target.textContent = 'Failed'; } setTimeout(() => navigate('/mygames', { ...q, r: Date.now() }), 600); } }, 'Analyse local replays'),
    el('button', { class: 'btn sm', type: 'button', onClick: () => navigate('/mygames', { ...q, refresh: 1, r: Date.now() }) }, 'Refresh from API'));
  head.append(actions);
  app.append(head);
  const tiles = el('div', { class: 'tiles', style: { marginBottom: '14px' } });
  const filters = el('div', { class: 'filters' });
  const body = el('div', { class: 'card flush' }, skeleton(12));
  app.append(tiles, filters, body);

  let data;
  try { data = await local(q.refresh ? 'games?refresh=1' : 'games', { force: !!q.refresh || !!q.r, ttl: 60e3 }); }
  catch (e) { clear(body); body.append(errorBox(e)); return; }
  const games = data.games;
  const friendOpts = [{ value: '', label: 'Anyone' }, ...cfg.friends.map(f => ({ value: String(f.profile_id), label: f.name }))];
  const allTags = [...new Set(games.flatMap(g => g.tags.map(t => t.tag)))].filter(t => !t.startsWith('with:'));
  const tagLabel = t => games.flatMap(g => g.tags).find(x => x.tag === t)?.label || t;
  const state = { size: q.size || '', friend: q.friend || '', tag: q.tag || '', result: q.result || '', data: q.data || '' };
  const go = patch => navigate('/mygames', { ...state, ...patch });
  append(filters, [
    el('label', {}, 'Mode ', select([{ value: '', label: 'All modes' }, { value: '2', label: '1v1' }, { value: '4', label: '2v2' }, { value: '6', label: '3v3' }, { value: '8', label: '4v4' }], state.size, v => go({ size: v }))),
    el('label', {}, 'With friend ', select(friendOpts, state.friend, v => go({ friend: v }))),
    el('label', {}, 'Tag ', select([{ value: '', label: 'Any tag' }, ...allTags.map(t => ({ value: t, label: tagLabel(t) }))], state.tag, v => go({ tag: v }))),
    el('label', {}, 'Result ', select([{ value: '', label: 'All' }, { value: 'win', label: 'Wins' }, { value: 'loss', label: 'Losses' }], state.result, v => go({ result: v }))),
    el('label', {}, 'Data ', select([{ value: '', label: 'Any' }, { value: 'replay', label: 'Has replay' }, { value: 'counters', label: 'Has official counters' }], state.data, v => go({ data: v }))),
    el('span', { class: 'spacer' }),
    (state.size || state.friend || state.tag || state.result || state.data) ? el('a', { class: 'btn sm ghost', href: '#/mygames' }, 'Clear') : null]);

  const rows = games.filter(g =>
    (!state.size || String(g.players) === state.size) &&
    (!state.friend || g.teammates.some(t => String(t.profile_id) === state.friend)) &&
    (!state.tag || g.tags.some(t => t.tag === state.tag)) &&
    (!state.result || g.result === state.result) &&
    (!state.data || (state.data === 'replay' ? g.has_replay : g.has_counters)));
  const wins = rows.filter(g => g.result === 'win').length;
  tiles.replaceChildren(
    statTile({ label: 'Games shown', value: fmt.int(rows.length), sub: `${fmt.int(data.count)} on record` }),
    statTile({ label: 'Win rate (shown)', value: rows.length ? fmt.pct(100 * wins / rows.length, 0) : '—', sub: `${wins} W – ${rows.length - wins} L` }),
    statTile({ label: 'With a replay', value: fmt.int(rows.filter(g => g.has_replay).length), sub: `${fmt.int(data.replays_available)} overall · ${cfg.local_replays} files found locally` }),
    statTile({ label: 'With official counters', value: fmt.int(rows.filter(g => g.has_counters).length), sub: 'recent matches only (rolling window)' }),
    statTile({ label: 'Net rating', value: fmt.signed(sum(rows.map(g => g.rating_diff || 0))), sub: 'over shown games' }));

  const columns = [
    { key: 'started_at', label: 'When', sortValue: r => new Date(r.started_at).getTime(), defaultDir: 'desc', render: r => el('span', { class: 'small', title: fmt.dateTime(r.started_at) }, fmt.rel(r.started_at)) },
    { key: 'kind', label: 'Mode', render: r => kindName(r.kind) },
    { key: 'map', label: 'Map', render: r => el('strong', {}, r.map || '—') },
    { key: 'result', label: 'Result', sortValue: r => r.result === 'win' ? 1 : 0, render: r => resultPill(r.result) },
    { key: 'duration', label: 'Length', num: true, render: r => fmt.duration(r.duration) },
    { key: 'my_civ', label: 'My civ', sortValue: r => civName(r.my_civ), render: r => r.my_civ ? civChip(r.my_civ, { name: 'short' }) : '—' },
    { key: 'rating_diff', label: 'Δ', num: true, render: r => el('span', { class: `num ${r.rating_diff > 0 ? 'good' : r.rating_diff < 0 ? 'bad' : 'muted'}` }, fmt.signed(r.rating_diff)) },
    { key: 'teammates', label: 'Teammates', sortable: false, render: r => el('span', { class: 'small' }, r.teammates.length ? r.teammates.map((t, i) => [i ? ', ' : '', el('a', { href: hrefTo(`/player/${t.profile_id}`), class: t.friend ? 'friend-name' : '' }, t.name)]) : el('span', { class: 'muted' }, 'solo')) },
    { key: 'data', label: 'Data', sortable: false, render: r => el('span', { class: 'data-badges' }, r.has_replay ? el('span', { class: 'badge ok', title: 'replay available' }, 'replay') : null, r.has_counters ? el('span', { class: 'badge ok', title: 'official counters available' }, 'counters') : null, (!r.has_replay && !r.has_counters) ? el('span', { class: 'badge', title: 'API data only' }, 'api') : null) },
    { key: 'tags', label: 'Tags', sortable: false, render: r => el('span', { class: 'tags' }, r.tags.map(t => tagChip(t))) },
  ];
  clear(body);
  body.append(dataTable({ columns, rows, sort: { key: 'started_at', dir: 'desc' }, rowHref: r => hrefTo(`/mygames/${r.game_id}`), emptyText: 'No games match these filters.' }));
}

/* ============================== detail ============================== */
// The per-game view is the shared Game summary page (js/pages/game.js), opened from "me"'s perspective.
function renderDetail(app, cfg, gameId, route) {
  return gamePage.render(app, { parts: ['game', gameId], query: { ...route.query, p: String(cfg.me), back: 'mygames' } });
}
