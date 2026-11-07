// My games: local companion view — your games merged with official counters and replay analysis.
import { el, fmt, setTitle, hrefTo, navigate, clear, append, sum } from '../util.js';
import { getJSON, ApiError } from '../api.js';
import { civChip, playerLink, resultPill, dataTable, select, card, notice, skeleton, errorBox, emptyState, statTile, countryFlag, wrCell, bindTooltip, ttRows } from '../components.js';
import { civName, kindName } from '../constants.js';
import { pageHead } from './_shared.js';

const CIV_ALIAS = { abbasid: 'abbasid_dynasty', ayyubid: 'ayyubids', byzantine: 'byzantines', chinese: 'chinese', sultanate: 'delhi_sultanate', english: 'english', french: 'french', hre: 'holy_roman_empire', japanese: 'japanese', malian: 'malians', mongol: 'mongols', ottoman: 'ottomans', rus: 'rus', scots: 'scots', vikings: 'vikings', jeanne: 'jeanne_darc', lancaster: 'house_of_lancaster', templar: 'knights_templar', macedonian: 'macedonian_dynasty', tughlaq: 'tughlaq_dynasty', zhuxi: 'zhu_xis_legacy', jin: 'jin_dynasty', dragon: 'order_of_the_dragon', sengoku: 'sengoku_daimyo', golden_horde: 'golden_horde' };

const local = (path, opts = {}) => getJSON(`local/${path}`, { ttl: 30e3, ...opts });

function tagChip(t, { me = false } = {}) {
  const chip = el('span', { class: `tag ${t.tag.startsWith('with:') ? 'friend' : ''} ${me ? 'me' : ''}`, tabindex: 0 }, t.label);
  return bindTooltip(chip, () => ttRows(t.label, [{ label: 'why', value: t.why }]));
}

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
async function renderDetail(app, cfg, gameId, route) {
  const holder = el('div'); app.append(holder); holder.append(skeleton(8, { height: 22 }));
  let d;
  try { d = await local(`games/${gameId}${route.query.fetch ? '?fetch=1' : ''}`, { force: !!route.query.fetch, ttl: 60e3 }); }
  catch (e) { clear(holder); holder.append(errorBox(e)); return; }
  clear(holder);
  const g = d.game;
  setTitle(`${g.map} · ${kindName(g.kind)}`);
  const me = d.teams.flat().find(p => p.is_me);
  holder.append(pageHead(`${g.map} · ${kindName(g.kind)}`, el('span', {}, `${fmt.dateTime(g.started_at)} · ${fmt.duration(g.duration)} · ${g.server || ''} · patch ${g.patch}`),
    el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, el('a', { class: 'btn', href: '#/mygames' }, '← My games'),
      !d.replay.available ? el('a', { class: 'btn primary', href: hrefTo(`/mygames/${gameId}`, { fetch: 1 }) }, 'Fetch replay from official store') : null)));
  holder.append(el('div', { class: 'tags', style: { marginBottom: '12px' } }, me ? resultPill(me.result) : null, d.tags.map(t => tagChip(t))));
  holder.append(el('div', { class: 'notice', style: { marginBottom: '16px' } },
    d.replay.available ? el('span', {}, el('strong', {}, 'Replay: '), `${d.replay.file} (game build ${d.replay.build}) — unit, building and research orders for every player come from the replay. `) : el('span', {}, el('strong', {}, 'No replay for this game'), d.replay.status ? ` (${d.replay.status}). ` : '. ', 'Unit-level detail needs a replay; try fetching it from the official store. '),
    d.counters_available ? el('span', {}, el('strong', {}, 'Official counters: '), 'kills, losses, buildings, upgrades and APM come from the game servers.') : el('span', {}, el('strong', {}, 'No official counters: '), 'this game has rolled out of the official recent-match window.')));

  /* scoreboard per team */
  const col = (label, get, { num = true, title } = {}) => ({ key: label, label, num, title, sortValue: get, render: r => { const v = get(r); return v === null || v === undefined ? el('span', { class: 'muted' }, '—') : (typeof v === 'number' ? fmt.int(v) : v); } });
  const scoreCols = [
    { key: 'player', label: 'Player', sortable: false, render: r => el('div', { class: 'score-player' }, playerLink(r, { showAvatar: false }), r.is_me ? el('span', { class: 'badge me' }, 'me') : null, r.friend ? el('span', { class: 'badge friend' }, 'friend') : null) },
    { key: 'civ', label: 'Civ', sortable: false, render: r => civChip(r.civilization, { name: 'short' }) },
    { key: 'rating', label: 'Rating', num: true, sortValue: r => r.rating, render: r => el('span', { class: 'num' }, fmt.int(r.rating), ' ', el('span', { class: `small ${r.rating_diff > 0 ? 'good' : r.rating_diff < 0 ? 'bad' : 'muted'}` }, fmt.signed(r.rating_diff))) },
    col('Kills', r => r.counters?.kills), col('Lost', r => r.counters?.units_lost),
    { key: 'K/D', label: 'K/D', num: true, title: 'kills ÷ units lost (official)', sortValue: r => r.counters?.kills != null ? r.counters.kills / Math.max(1, r.counters.units_lost || 0) : null, render: r => r.counters?.kills != null ? fmt.dec(r.counters.kills / Math.max(1, r.counters.units_lost || 0), 2) : el('span', { class: 'muted' }, '—') },
    col('Produced', r => r.counters?.units_produced, { title: 'units produced (official)' }), col('Bldgs', r => r.counters?.buildings_built, { title: 'buildings built (official)' }),
    col('Upg', r => r.counters?.upgrades, { title: 'upgrades researched (official)' }), col('APM', r => r.counters?.apm ?? r.replay?.apm_replay, { title: 'commands per minute' }),
    col('Vills', r => r.replay?.villagers, { title: 'villagers queued (replay)' }), col('Army', r => r.replay?.military, { title: 'military units queued (replay)' }),
    { key: 'first', label: 'First military', sortValue: r => r.replay?.first_military?.time ?? 1e9, render: r => r.replay?.first_military ? el('span', { class: 'small' }, `${fmt.duration(r.replay.first_military.time)} ${r.replay.first_military.name}`) : el('span', { class: 'muted' }, '—') },
    { key: 'ages', label: 'Age-ups', sortable: false, render: r => r.replay ? el('span', { class: 'small' }, r.replay.ages.map(a => `${['', '', 'II', 'III', 'IV'][a.age]} ${fmt.duration(a.time)}`).join(' · ') || '—') : el('span', { class: 'muted' }, '—') },
    col('TCs', r => r.replay ? r.replay.town_centers.length + 1 : null, { title: 'Town Centers incl. capital (replay)' }),
    { key: 'tags', label: 'Tags', sortable: false, render: r => el('span', { class: 'tags' }, r.tags.map(t => tagChip(t, { me: r.is_me }))) },
  ];
  d.teams.forEach((team, i) => {
    const won = team.some(p => p.result === 'win');
    holder.append(card(el('span', {}, `Team ${i + 1} `, resultPill(won ? 'win' : team.some(p => p.result === 'loss') ? 'loss' : null), team.some(p => p.is_me) ? el('span', { class: 'muted small' }, ' · your team') : null), dataTable({ columns: scoreCols, rows: team, sort: { key: 'Kills', dir: 'desc' } }), { flush: true, level: 3 }));
    holder.append(el('div', { style: { height: '12px' } }));
  });

  if (!d.replay.available) {
    holder.append(explainTags(d));
    return;
  }

  /* unit matrix: rows = units, columns = players (grouped by team) */
  const players = d.teams.flat().filter(p => p.replay);
  const unitTotals = {};
  for (const p of players) for (const [u, n] of Object.entries(p.replay.by_unit)) unitTotals[u] = (unitTotals[u] || 0) + n;
  const units = Object.keys(unitTotals).sort((a, b) => unitTotals[b] - unitTotals[a]);
  const max = Math.max(...players.flatMap(p => Object.values(p.replay.by_unit)), 1);
  const matrix = el('table', { class: 'data unit-matrix' });
  matrix.append(el('thead', {}, el('tr', {}, el('th', {}, 'Unit queued'), players.map(p => el('th', { class: `num ${p.is_me ? 'me' : ''}`, title: p.name }, el('span', { class: 'col-head' }, civChip(p.civilization, { name: 'none' }), el('span', {}, p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name)))))));
  const tb = el('tbody');
  for (const u of units) tb.append(el('tr', {}, el('td', {}, u), players.map(p => { const n = p.replay.by_unit[u] || 0; return el('td', { class: 'num', style: n ? { background: `color-mix(in srgb, var(--s1) ${Math.round(12 + 60 * n / max)}%, transparent)` } : {} }, n ? String(n) : el('span', { class: 'muted' }, '·')); })));
  tb.append(el('tr', { class: 'total' }, el('td', {}, el('strong', {}, 'Villagers')), players.map(p => el('td', { class: 'num' }, el('strong', {}, String(p.replay.villagers))))));
  tb.append(el('tr', { class: 'total' }, el('td', {}, el('strong', {}, 'Military total')), players.map(p => el('td', { class: 'num' }, el('strong', {}, String(p.replay.military))))));
  matrix.append(tb);
  holder.append(card('Units queued, by player', el('div', { class: 'table-wrap' }, matrix), { flush: true, meta: 'counts are production orders from the replay; cancelled units are included' }));

  /* army composition by role over 5-minute buckets, per team */
  holder.append(el('div', { style: { height: '16px' } }));
  const roles = ['infantry', 'ranged', 'cavalry', 'siege', 'naval', 'other'];
  const roleColor = { infantry: 'var(--s1)', ranged: 'var(--s2)', cavalry: 'var(--s3)', siege: 'var(--s4)', naval: 'var(--s7)', other: 'var(--de-emphasis)' };
  const compGrid = el('div', { class: 'grid cols-2' });
  d.teams.forEach((team, i) => {
    const tp = team.filter(p => p.replay);
    const buckets = [...new Set(tp.flatMap(p => Object.keys(p.replay.timeline)))].map(Number).sort((a, b) => a - b);
    const maxB = Math.max(1, ...buckets.map(b => sum(tp.flatMap(p => roles.map(r => p.replay.timeline[String(b)]?.[r] || 0)))));
    const bars = el('div', { class: 'stackbars' });
    for (const b of buckets) {
      const segs = roles.map(r => [r, sum(tp.map(p => p.replay.timeline[String(b)]?.[r] || 0))]).filter(([, n]) => n > 0);
      const total = sum(segs.map(([, n]) => n));
      bars.append(el('div', { class: 'stackrow' }, el('span', { class: 'lbl' }, `${b}–${b + 5} min`),
        el('div', { class: 'stack' }, segs.map(([r, n]) => bindTooltip(el('span', { class: 'seg', style: { width: `${(100 * n / maxB).toFixed(1)}%`, background: roleColor[r] }, tabindex: 0 }), () => ttRows(`${b}–${b + 5} min`, [{ label: r, value: String(n), color: roleColor[r] }])))),
        el('span', { class: 'val' }, String(total))));
    }
    compGrid.append(card(`Team ${i + 1} military production`, el('div', {}, bars.children.length ? bars : emptyState('No replay data for this team.'),
      el('div', { class: 'legend' }, roles.map(r => el('span', { class: 'key' }, el('i', { class: 'rect', style: { '--c': roleColor[r] } }), r)))), { level: 3 }));
  });
  holder.append(compGrid);

  /* build orders */
  holder.append(el('div', { style: { height: '16px' } }));
  let who = players.find(p => p.is_me)?.profile_id ?? players[0]?.profile_id;
  const boBody = el('div');
  const drawBO = () => {
    const p = players.find(x => x.profile_id === who);
    clear(boBody);
    if (!p) return;
    const items = [...p.replay.build_order.map(x => ({ ...x, type: 'build' })), ...p.replay.research.map(x => ({ ...x, type: 'research' })), ...(p.replay.first_military ? [{ time: p.replay.first_military.time, name: `${p.replay.first_military.name} (first military unit)`, type: 'train' }] : [])].sort((a, b) => a.time - b.time).slice(0, 90);
    boBody.append(el('div', { class: 'bo-grid' }, items.map(x => el('div', { class: `bo-item ${x.type}` }, el('span', { class: 'num muted' }, fmt.duration(x.time)), el('span', {}, x.name)))));
    boBody.append(el('p', { class: 'muted small', style: { margin: '10px 0 0' } }, `${p.replay.build_order.length} building placements · ${p.replay.research.length} researches · ${p.replay.commands} total commands (${p.replay.apm_replay} per minute)`));
  };
  holder.append(card('Build order', el('div', {}, el('div', { class: 'filters' }, el('label', {}, 'Player ', select(players.map(p => ({ value: String(p.profile_id), label: `${p.name} (${civName(p.civilization)})` })), String(who), v => { who = Number(v); drawBO(); }))), boBody), { meta: 'buildings and technologies in order, from the replay' }));
  drawBO();

  holder.append(el('div', { style: { height: '16px' } }));
  holder.append(explainTags(d));
}

function explainTags(d) {
  const rows = [];
  for (const t of d.tags) rows.push({ who: 'Game', tag: t });
  for (const p of d.teams.flat()) for (const t of p.tags) rows.push({ who: p.name, tag: t });
  return card('How these tags were assigned', rows.length ? el('ul', { class: 'why-list' }, rows.map(r => el('li', {}, el('strong', {}, r.who), ' → ', tagChip(r.tag), ' ', el('span', { class: 'muted' }, r.tag.why)))) : emptyState('No tags for this game yet — fetch the replay to enable replay-based tags.'),
    { meta: 'rules live in tools/replays.py (player_tags, counter_tags, game_tags)' });
}
