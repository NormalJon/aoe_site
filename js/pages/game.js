// Game summary: one page per game, for any player. Build orders side by side (minute-aligned), unit and
// building icon strips, resources spent, timelines, key insights, scoreboards and tags.
// Unit-level detail comes from the replay via the local companion (local file or the official store);
// without the companion the page degrades to the API record.
import { el, fmt, setTitle, hrefTo, clear, append, sum } from '../util.js';
import { getJSON, api, ApiError } from '../api.js';
import { civChip, playerLink, resultPill, dataTable, select, card, notice, skeleton, errorBox, emptyState, bindTooltip, ttRows, segmented, flattenTeams } from '../components.js';
import { civName, kindName, CHART_SERIES } from '../constants.js';
import { lineChart } from '../charts.js';
import { pageHead, companionHint } from './_shared.js';

const RES_COLORS = { food: 'var(--s2)', wood: 'var(--s3)', gold: 'var(--s4)', stone: 'var(--muted)' };
const ROLE_COLORS = { infantry: 'var(--s1)', ranged: 'var(--s2)', cavalry: 'var(--s3)', siege: 'var(--s4)', naval: 'var(--s7)', other: 'var(--de-emphasis)' };
const AGE = { 2: 'Feudal', 3: 'Castle', 4: 'Imperial' };
const AGE_ROMAN = ['', 'I', 'II', 'III', 'IV'];

export function tagChip(t, { me = false } = {}) {
  const chip = el('span', { class: `tag ${t.tag.startsWith('with:') ? 'friend' : ''} ${me ? 'me' : ''}`, tabindex: 0 }, t.label);
  return bindTooltip(chip, () => ttRows(t.label, [{ label: 'why', value: t.why }]));
}

export async function render(app, route) {
  const gameId = route.parts[1];
  const profile = /^\d+$/.test(route.query.p || '') ? route.query.p : null;
  const holder = el('div'); app.append(holder);
  holder.append(skeleton(3, { height: 22 }), el('p', { class: 'muted small' }, 'Loading the game record and fetching the replay from the official store if needed…'));
  let d = null, companion = true;
  try {
    d = await getJSON(`local/game/${gameId}?${new URLSearchParams({ ...(profile ? { profile } : {}), fetch: route.query.nofetch ? '0' : '1' })}`, { ttl: 5 * 60e3, force: !!route.query.r });
  } catch (e) {
    companion = false;
    if (e instanceof ApiError && e.status === 400 && !profile) { clear(holder); holder.append(errorBox(new Error('This link is missing the player it was opened from (add ?p=<profile id>).'))); return; }
    if (!(e instanceof ApiError) || e.status === 404 || e.status === 501 || e.status === 405) {
      d = await apiOnly(gameId, profile, holder);
      if (!d) return;
    } else { clear(holder); holder.append(errorBox(e)); return; }
  }
  clear(holder);
  renderGame(holder, d, { gameId, profile: Number(profile || d.focus), companion, route });
}

/** Static-host fallback: the aoe4world record only. */
async function apiOnly(gameId, profile, holder) {
  if (!profile) { clear(holder); holder.append(errorBox(new Error('Game summaries need either the local companion or a player id in the link.'))); return null; }
  try {
    const g = await api.game(profile, gameId);
    const teams = flattenTeams(g).map(t => t.map(p => ({ ...p, is_focus: String(p.profile_id) === String(profile), is_me: false, friend: false, tags: [], counters: null, replay: null })));
    return { game: { ...g, teams: undefined }, teams, focus: Number(profile), tags: [], insights: [], blueprints: {}, replay: { available: false, status: 'companion not running' }, counters_available: false, apiOnly: true };
  } catch (e) { clear(holder); holder.append(errorBox(e)); return null; }
}

function renderGame(holder, d, { gameId, profile, companion, route }) {
  const g = d.game;
  const players = d.teams.flat();
  const focus = players.find(p => p.is_focus) || players.find(p => p.is_me) || players[0];
  setTitle(`${g.map} · ${kindName(g.kind)}`);
  const colour = new Map(players.map((p, i) => [p.profile_id, `var(${CHART_SERIES[i % CHART_SERIES.length]})`]));
  const back = route.query.back === 'mygames' ? el('a', { class: 'btn', href: '#/mygames' }, '← My games') : el('a', { class: 'btn', href: hrefTo(`/player/${focus.profile_id}`) }, `← ${focus.name}`);
  holder.append(pageHead(`${g.map} · ${kindName(g.kind)}`,
    el('span', {}, `${fmt.dateTime(g.started_at)} · ${fmt.duration(g.duration)}${g.server ? ` · ${g.server}` : ''}${g.patch ? ` · patch ${g.patch}` : ''}`),
    el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, back,
      companion && !d.replay.available && !route.query.r ? el('a', { class: 'btn primary', href: hrefTo(`/game/${gameId}`, { p: profile, r: Date.now() }) }, 'Retry replay fetch') : null,
      el('a', { class: 'btn', href: `https://aoe4world.com/players/${focus.profile_id}/games/${gameId}`, target: '_blank', rel: 'noopener' }, 'AoE4 World ↗'))));

  holder.append(el('div', { class: 'tags', style: { marginBottom: '12px', gap: '8px' } }, resultPill(focus.result),
    el('span', { class: 'muted small' }, 'from the perspective of ', el('a', { href: hrefTo(`/player/${focus.profile_id}`) }, focus.name)),
    d.tags.map(t => tagChip(t))));

  holder.append(el('div', { class: 'notice', style: { marginBottom: '16px' } },
    d.replay.available ? el('span', {}, el('strong', {}, 'Replay: '), `${d.replay.status === 'local' ? 'local game file' : d.replay.status === 'cached' ? 'official store (cached copy)' : 'official store'} (game build ${d.replay.build}) — every unit queued, building placed and technology researched, for every player. `)
      : el('span', {}, el('strong', {}, 'No replay for this game'), d.replay.status ? ` (${String(d.replay.status).replace('_', ' ')}). ` : '. ',
        companion ? 'The official store keeps replays for a limited time; local files are picked up automatically. ' : el('span', {}, 'Build orders, icon strips and timelines need the companion. ', ...companionHint(), ' ')),
    d.counters_available ? el('span', {}, el('strong', {}, 'Official counters: '), 'kills, losses, buildings, upgrades and APM from the game servers.') : el('span', {}, el('strong', {}, 'No official counters: '), 'this game is outside the recent-match window of the official API.')));

  /* key insights */
  if (d.insights?.length) {
    holder.append(card('Key insights', el('ul', { class: 'insights' }, d.insights.map(i => el('li', { class: i.tone }, el('span', { class: 'mark', 'aria-hidden': 'true' }, i.tone === 'good' ? '▲' : i.tone === 'bad' ? '▼' : '•'), el('span', {}, i.text)))),
      { meta: `about ${focus.name} · rule-based, from the replay`, level: 2 }));
    holder.append(el('div', { style: { height: '16px' } }));
  }

  /* scoreboards */
  holder.append(scoreboards(d));

  if (!d.replay.available) { holder.append(explainTags(d)); return; }

  const withReplay = players.filter(p => p.replay);
  /* build order board */
  holder.append(buildOrderBoard(d, withReplay, colour, focus));
  holder.append(el('div', { style: { height: '16px' } }));
  /* timelines */
  holder.append(timelines(d, withReplay, colour, focus));
  holder.append(el('div', { style: { height: '16px' } }));
  /* unit matrix + team production */
  holder.append(unitMatrix(withReplay, d.blueprints));
  holder.append(el('div', { style: { height: '16px' } }));
  holder.append(teamProduction(d));
  holder.append(el('div', { style: { height: '16px' } }));
  holder.append(explainTags(d));
}

/* ============================== scoreboards ============================== */
function scoreboards(d) {
  const col = (label, get, { num = true, title } = {}) => ({ key: label, label, num, title, sortValue: get, render: r => { const v = get(r); return v === null || v === undefined ? el('span', { class: 'muted' }, '—') : (typeof v === 'number' ? fmt.int(v) : v); } });
  const cols = [
    { key: 'player', label: 'Player', sortable: false, render: r => el('div', { class: 'score-player' }, playerLink(r, { showAvatar: false }), r.is_me ? el('span', { class: 'badge me' }, 'me') : null, r.friend ? el('span', { class: 'badge friend' }, 'friend') : null, r.is_focus && !r.is_me ? el('span', { class: 'badge' }, 'viewing') : null) },
    { key: 'civ', label: 'Civ', sortable: false, render: r => civChip(r.civilization, { name: 'short' }) },
    { key: 'rating', label: 'Rating', num: true, sortValue: r => r.rating, render: r => el('span', { class: 'num' }, fmt.int(r.rating), ' ', el('span', { class: `small ${r.rating_diff > 0 ? 'good' : r.rating_diff < 0 ? 'bad' : 'muted'}` }, fmt.signed(r.rating_diff))) },
    col('Kills', r => r.counters?.kills), col('Lost', r => r.counters?.units_lost),
    { key: 'K/D', label: 'K/D', num: true, title: 'kills ÷ units lost (official)', sortValue: r => r.counters?.kills != null ? r.counters.kills / Math.max(1, r.counters.units_lost || 0) : null, render: r => r.counters?.kills != null ? fmt.dec(r.counters.kills / Math.max(1, r.counters.units_lost || 0), 2) : el('span', { class: 'muted' }, '—') },
    col('Produced', r => r.counters?.units_produced, { title: 'units produced (official)' }), col('Bldgs', r => r.counters?.buildings_built, { title: 'buildings built (official)' }),
    col('Upg', r => r.counters?.upgrades, { title: 'upgrades researched (official)' }), col('APM', r => r.counters?.apm ?? r.replay?.apm_replay, { title: 'commands per minute' }),
    col('Vills', r => r.replay?.villagers, { title: 'villagers queued (replay)' }), col('Army', r => r.replay?.military, { title: 'military units queued (replay)' }),
    { key: 'first', label: 'First military', sortValue: r => r.replay?.first_military?.time ?? 1e9, render: r => r.replay?.first_military ? el('span', { class: 'small' }, `${fmt.duration(r.replay.first_military.time)} ${r.replay.first_military.name}`) : el('span', { class: 'muted' }, '—') },
    { key: 'ages', label: 'Age-ups', sortable: false, render: r => r.replay ? el('span', { class: 'small' }, r.replay.ages.map(a => `${AGE_ROMAN[a.age]} ${fmt.duration(a.time)}`).join(' · ') || '—') : el('span', { class: 'muted' }, '—') },
    col('TCs', r => r.replay ? r.replay.town_centers.length + 1 : null, { title: 'Town Centers incl. capital (replay)' }),
    { key: 'tags', label: 'Tags', sortable: false, render: r => el('span', { class: 'tags' }, r.tags.map(t => tagChip(t, { me: r.is_focus }))) },
  ];
  const frag = document.createDocumentFragment();
  d.teams.forEach((team, i) => {
    const won = team.some(p => p.result === 'win');
    frag.append(card(el('span', {}, `Team ${i + 1} `, resultPill(won ? 'win' : team.some(p => p.result === 'loss') ? 'loss' : null), team.some(p => p.is_focus) ? el('span', { class: 'muted small' }, ' · viewed player’s team') : null),
      dataTable({ columns: cols, rows: team, sort: { key: 'Kills', dir: 'desc' } }), { flush: true, level: 3 }));
    frag.append(el('div', { style: { height: '12px' } }));
  });
  return frag;
}

/* ============================== build order board ============================== */
function iconImg(bp, size = 28) {
  const img = el('img', { class: 'bp-icon', src: bp?.icon || '', alt: '', width: size, height: size, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => { img.replaceWith(el('span', { class: 'bp-icon fallback', style: { width: `${size}px`, height: `${size}px` } }, (bp?.name || '?').slice(0, 2))); });
  return img;
}
function iconStrip(entries, bps, { cls = '' } = {}) {
  // entries: [{id, n}] sorted by count
  if (!entries.length) return el('div', { class: `icon-strip ${cls}` }, el('span', { class: 'muted small' }, 'none'));
  return el('div', { class: `icon-strip ${cls}` }, entries.map(({ id, n }) => {
    const bp = bps[id] || {};
    const cell = el('span', { class: 'icon-cell', tabindex: 0 }, iconImg(bp), el('span', { class: 'n' }, String(n)));
    return bindTooltip(cell, () => ttRows(bp.name || `#${id}`, [{ label: 'queued', value: String(n) }, bp.role ? { label: 'type', value: bp.role.replace('_', ' ') } : null, bp.age ? { label: 'age', value: AGE_ROMAN[bp.age] || String(bp.age) } : null].filter(Boolean)));
  }));
}
function spentChart(perMinute, duration) {
  const series = ['food', 'wood', 'gold', 'stone'].map(k => ({ name: k, color: RES_COLORS[k], points: perMinute.map((m, i) => ({ x: i, y: m[k] })) })).filter(s => s.points.some(p => p.y > 0));
  return lineChart({ series, height: 120, xIsTime: false, xFormat: v => `${Math.round(v)}:00`, yFormat: v => fmt.compact(v), directLabels: false, legend: false, area: false, xDomain: [0, Math.max(1, perMinute.length - 1)], emptyText: 'No spending recorded' });
}

function buildOrderBoard(d, players, colour, focus) {
  const bps = d.blueprints;
  const duration = d.game.duration || Math.max(...players.map(p => p.replay.per_minute.length * 60));
  const state = { kinds: new Set(['train', 'build', 'research']), full: false, hidden: new Set() };
  const body = el('div', { class: 'bo-board-wrap' });
  const controls = el('div', { class: 'filters', style: { marginBottom: '10px' } });

  const chipRow = el('div', { class: 'tags' });
  const kindChips = () => {
    clear(chipRow);
    for (const [k, label] of [['train', 'Units'], ['build', 'Buildings'], ['research', 'Technologies']]) {
      chipRow.append(el('button', { type: 'button', class: `chip ${state.kinds.has(k) ? 'on' : ''}`, 'aria-pressed': String(state.kinds.has(k)), onClick: () => { if (state.kinds.has(k)) state.kinds.delete(k); else state.kinds.add(k); draw(); } }, label));
    }
    chipRow.append(el('span', { class: 'muted small', style: { marginLeft: '8px' } }, 'Players:'));
    for (const p of players) chipRow.append(el('button', { type: 'button', class: `chip ${state.hidden.has(p.profile_id) ? '' : 'on'}`, 'aria-pressed': String(!state.hidden.has(p.profile_id)), style: { '--c': colour.get(p.profile_id) }, onClick: () => { if (state.hidden.has(p.profile_id)) state.hidden.delete(p.profile_id); else state.hidden.add(p.profile_id); draw(); } }, el('i', { class: 'dot' }), p.name));
  };
  const lenBtn = el('button', { type: 'button', class: 'btn sm', onClick: () => { state.full = !state.full; draw(); } });
  controls.append(chipRow, el('span', { class: 'spacer' }), lenBtn);

  function draw() {
    kindChips();
    clear(body);
    const shown = players.filter(p => !state.hidden.has(p.profile_id));
    if (!shown.length) { body.append(emptyState('Pick at least one player.')); return; }
    const limitMin = state.full ? Math.ceil(duration / 60) : Math.min(Math.ceil(duration / 60), 15);
    lenBtn.textContent = state.full ? 'Show first 15 minutes' : `Show full game (${fmt.duration(duration)})`;
    lenBtn.style.display = duration > 15 * 60 ? '' : 'none';
    const board = el('div', { class: 'bo-board', style: { gridTemplateColumns: `repeat(${shown.length}, minmax(${shown.length > 4 ? 200 : 230}px, 1fr))` } });
    // headers
    for (const p of shown) {
      const teamIdx = d.teams.findIndex(t => t.includes(p));
      board.append(el('div', { class: 'bo-head' },
        el('div', { class: 'who' }, el('i', { class: 'dot', style: { background: colour.get(p.profile_id) } }), el('a', { href: hrefTo(`/player/${p.profile_id}`), class: p.is_focus ? 'focus' : '' }, p.name), resultPill(p.result)),
        el('div', { class: 'muted small team' }, `Team ${teamIdx + 1}`, ' · ', civChip(p.civilization, { name: 'short' }))));
    }
    // resources spent per minute
    for (const p of shown) board.append(el('div', { class: 'bo-cell chart' }, el('div', { class: 'cap' }, 'Resources spent per minute'), spentChart(p.replay.per_minute, duration)));
    board.append(el('div', { class: 'bo-legend', style: { gridColumn: '1 / -1' } }, el('div', { class: 'legend' }, Object.entries(RES_COLORS).map(([k, c]) => el('span', { class: 'key' }, el('i', { style: { '--c': c } }), k)), el('span', { class: 'muted' }, '· cost of everything queued, placed or researched in that minute'))));
    // icon strips
    const strip = (p, kind, roles) => {
      const entries = Object.entries(p.replay.counts).map(([id, n]) => ({ id, n, bp: bps[id] })).filter(x => x.bp && x.bp.kind === kind && (!roles || roles.includes(x.bp.role))).sort((a, b) => b.n - a.n);
      return entries.map(({ id, n }) => ({ id, n }));
    };
    for (const p of shown) board.append(el('div', { class: 'bo-cell' }, el('div', { class: 'cap' }, `Units · ${p.replay.villagers} villagers, ${p.replay.military} military`), iconStrip(strip(p, 'unit'), bps, { cls: 'units' })));
    for (const p of shown) board.append(el('div', { class: 'bo-cell' }, el('div', { class: 'cap' }, `Buildings · ${sum(Object.values(p.replay.buildings_by_name))}`), iconStrip(strip(p, 'building'), bps, { cls: 'buildings' })));
    for (const p of shown) board.append(el('div', { class: 'bo-cell' }, el('div', { class: 'cap' }, `Technologies · ${p.replay.research.length}`), iconStrip(strip(p, 'tech'), bps, { cls: 'techs' })));
    // minute-aligned timeline
    const byMinute = new Map(shown.map(p => [p.profile_id, groupEvents(p.replay.events.filter(e => state.kinds.has(e.k)))]));
    let any = false;
    for (let m = 0; m < limitMin; m++) {
      const cells = shown.map(p => (byMinute.get(p.profile_id).get(m) || []));
      if (cells.every(c => !c.length)) continue;
      any = true;
      board.append(el('div', { class: 'bo-minute', style: { gridColumn: '1 / -1' } }, `${m}:00`));
      shown.forEach((p, i) => {
        board.append(el('div', { class: 'bo-cell events' }, cells[i].map(ev => {
          const bp = bps[ev.id] || {};
          const ageUp = p.replay.ages.find(a => a.via === bp.name && Math.abs(a.time - ev.t) < 1);
          return el('div', { class: `bo-ev ${ev.k} ${bp.role || ''} ${ageUp ? 'ageup' : ''}`, title: `${fmt.duration(ev.t)} ${bp.name || ev.id}${ev.n > 1 ? ` × ${ev.n}` : ''}` },
            el('span', { class: 'num t' }, fmt.duration(ev.t)), iconImg(bp, 22), el('span', { class: 'nm' }, bp.name || `#${ev.id}`), ageUp ? el('span', { class: 'age-pill' }, `→ ${AGE[ageUp.age]}`) : null, ev.n > 1 ? el('span', { class: 'x' }, `× ${ev.n}`) : null);
        })));
      });
    }
    if (!any) board.append(el('div', { style: { gridColumn: '1 / -1' } }, emptyState('Nothing to show for this selection.')));
    body.append(board);
  }
  draw();
  return card('Build orders', el('div', {}, controls, body), { meta: 'every order from the replay, aligned by minute · consecutive identical orders are collapsed into × n', level: 2 });
}
function groupEvents(events) {
  const m = new Map();
  for (const e of events) { const k = Math.floor(e.t / 60); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
  return m;
}

/* ============================== timelines ============================== */
function timelines(d, players, colour, focus) {
  const duration = d.game.duration || 0;
  const metrics = [
    { value: 'villagers', label: 'Villagers queued', pick: m => m.villagers, cumulative: true, fmt: v => fmt.int(v) },
    { value: 'military', label: 'Military queued', pick: m => m.military, cumulative: true, fmt: v => fmt.int(v) },
    { value: 'mil_rate', label: 'Military per minute', pick: m => m.military, cumulative: false, fmt: v => fmt.int(v) },
    { value: 'spend', label: 'Resources spent (cumulative)', pick: m => m.food + m.wood + m.gold + m.stone, cumulative: true, fmt: v => fmt.compact(v) },
    { value: 'mil_spend', label: 'Military spend (cumulative)', pick: m => m.mil_spend, cumulative: true, fmt: v => fmt.compact(v) },
    { value: 'buildings', label: 'Buildings placed', pick: m => m.buildings, cumulative: true, fmt: v => fmt.int(v) },
  ];
  let metric = 'villagers'; let markFor = focus.replay ? focus.profile_id : players[0].profile_id;
  const box = el('div');
  const draw = () => {
    const mt = metrics.find(m => m.value === metric);
    const series = players.map(p => {
      let acc = 0;
      const pts = p.replay.per_minute.map((m, i) => { const v = mt.pick(m); acc += v; return { x: i, y: mt.cumulative ? acc : v }; });
      return { name: p.name, color: colour.get(p.profile_id), points: pts };
    });
    const mp = players.find(p => p.profile_id === markFor);
    const markers = [];
    if (mp) {
      for (const a of mp.replay.ages) markers.push({ x: a.time / 60, label: AGE[a.age], color: colour.get(mp.profile_id), row: 0 });
      mp.replay.town_centers.forEach((t, i) => markers.push({ x: t / 60, label: `TC ${i + 2}`, color: 'var(--axis)', row: 1 }));
    }
    clear(box);
    box.append(lineChart({ series, height: 280, xIsTime: false, xFormat: v => fmt.duration(Math.round(v * 60)), yFormat: mt.fmt, markers, directLabels: players.length <= 4, area: false, xDomain: [0, Math.max(1, Math.ceil(duration / 60))] }));
  };
  const controls = el('div', { class: 'filters', style: { marginBottom: '8px' } },
    el('label', {}, 'Metric ', select(metrics.map(m => ({ value: m.value, label: m.label })), metric, v => { metric = v; draw(); })),
    el('label', {}, 'Markers for ', select(players.map(p => ({ value: String(p.profile_id), label: p.name })), String(markFor), v => { markFor = Number(v); draw(); })));
  draw();
  return card('Timelines', el('div', {}, controls, box), { meta: 'one-minute buckets from the replay · vertical lines mark age-ups and extra Town Centers of the selected player', level: 2 });
}

/* ============================== unit matrix + team production ============================== */
function unitMatrix(players, bps) {
  const unitTotals = {};
  for (const p of players) for (const [u, n] of Object.entries(p.replay.by_unit)) unitTotals[u] = (unitTotals[u] || 0) + n;
  const units = Object.keys(unitTotals).sort((a, b) => unitTotals[b] - unitTotals[a]);
  const max = Math.max(...players.flatMap(p => Object.values(p.replay.by_unit)), 1);
  const matrix = el('table', { class: 'data unit-matrix' });
  matrix.append(el('thead', {}, el('tr', {}, el('th', {}, 'Unit queued'), players.map(p => el('th', { class: `num ${p.is_focus ? 'me' : ''}`, title: p.name }, el('span', { class: 'col-head' }, civChip(p.civilization, { name: 'none' }), el('span', {}, p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name)))))));
  const tb = el('tbody');
  for (const u of units) tb.append(el('tr', {}, el('td', {}, u), players.map(p => { const n = p.replay.by_unit[u] || 0; return el('td', { class: 'num', style: n ? { background: `color-mix(in srgb, var(--s1) ${Math.round(12 + 60 * n / max)}%, transparent)` } : {} }, n ? String(n) : el('span', { class: 'muted' }, '·')); })));
  tb.append(el('tr', { class: 'total' }, el('td', {}, el('strong', {}, 'Villagers')), players.map(p => el('td', { class: 'num' }, el('strong', {}, String(p.replay.villagers))))));
  tb.append(el('tr', { class: 'total' }, el('td', {}, el('strong', {}, 'Military total')), players.map(p => el('td', { class: 'num' }, el('strong', {}, String(p.replay.military))))));
  matrix.append(tb);
  return card('Units queued, by player', el('div', { class: 'table-wrap' }, matrix), { flush: true, meta: 'counts are production orders from the replay; cancelled units are included; Veteran/Elite tiers folded into the base unit', level: 2 });
}
function teamProduction(d) {
  const roles = ['infantry', 'ranged', 'cavalry', 'siege', 'naval', 'other'];
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
        el('div', { class: 'stack' }, segs.map(([r, n]) => bindTooltip(el('span', { class: 'seg', style: { width: `${(100 * n / maxB).toFixed(1)}%`, background: ROLE_COLORS[r] }, tabindex: 0 }), () => ttRows(`${b}–${b + 5} min`, [{ label: r, value: String(n), color: ROLE_COLORS[r] }])))),
        el('span', { class: 'val' }, String(total))));
    }
    compGrid.append(card(`Team ${i + 1} military production`, el('div', {}, bars.children.length ? bars : emptyState('No replay data for this team.'),
      el('div', { class: 'legend' }, roles.map(r => el('span', { class: 'key' }, el('i', { class: 'rect', style: { '--c': ROLE_COLORS[r] } }), r)))), { level: 3 }));
  });
  return compGrid;
}

/* ============================== tags ============================== */
export function explainTags(d) {
  const rows = [];
  for (const t of d.tags) rows.push({ who: 'Game', tag: t });
  for (const p of d.teams.flat()) for (const t of p.tags) rows.push({ who: p.name, tag: t });
  return card('How these tags were assigned', rows.length ? el('ul', { class: 'why-list' }, rows.map(r => el('li', {}, el('strong', {}, r.who), ' → ', tagChip(r.tag), ' ', el('span', { class: 'muted' }, r.tag.why)))) : emptyState('No tags for this game yet — a replay enables replay-based tags.'),
    { meta: 'rules live in tools/replays.py (player_tags, counter_tags, game_tags)', level: 2 });
}
