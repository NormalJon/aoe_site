// Compare → Timings: how two players' openings differ. Medians of replay-derived numbers for a chosen civilization,
// optionally restricted to one matchup, with the gap between the two players; then one game of each, minute by minute,
// side by side. Everything comes from the companion (local/profile and local/game); the static copy shows a notice.
import { el, fmt, hrefTo, clear } from '../util.js';
import { getJSON, ApiError } from '../api.js';
import { civChip, select, segmented, card, notice, skeleton, emptyState, resultPill } from '../components.js';
import { CIVS, civName, civShort, kindName } from '../constants.js';
import { companionNotice } from './_shared.js';
import { AGE, eventEl, groupEvents, runningTotals } from './_board.js';
import { harvestControl } from './_harvest.js';

const companionMissing = e => !(e instanceof ApiError) || [404, 501, 405].includes(e.status);
const WANT = 10;                                            // analysed games wanted per side
const MINUTE_OPTS = [{ value: '10', label: '10 min' }, { value: '15', label: '15 min' }, { value: '20', label: '20 min' }];

// Game kinds that belong to the compare page's mode, so 1v1 timings are compared with 1v1 timings.
const KIND_FOR_MODE = { rm_solo: 'rm_1v1', rm_1v1_elo: 'rm_1v1', qm_1v1: 'qm_1v1', rm_team: 'rm_2v2,rm_3v3,rm_4v4', rm_2v2_elo: 'rm_2v2', rm_3v3_elo: 'rm_3v3', rm_4v4_elo: 'rm_4v4', qm_2v2: 'qm_2v2', qm_3v3: 'qm_3v3', qm_4v4: 'qm_4v4' };
const kindWord = kind => !kind ? '' : kind.includes(',') ? 'team ranked' : kindName(kind);
const profileUrl = (pid, { civ, vs, kind }, want) => `local/profile/${pid}?${new URLSearchParams({ ...(civ ? { civ } : {}), ...(vs ? { vs } : {}), ...(kind ? { kind } : {}), n: String(want), budget: '15' })}`;
const gameUrl = (gid, pid) => `local/game/${gid}?${new URLSearchParams({ profile: String(pid), fetch: '1' })}`;
const oppCivs = g => (g.opponents || []).map(o => o.civilization).filter(Boolean);
const mostPlayed = m => [...(m.civilizations || [])].sort((x, y) => y.games_count - x.games_count)[0]?.civilization || '';
const has = v => v !== null && v !== undefined && !Number.isNaN(v);
const signedDuration = d => Math.abs(d) < 1 ? '±0:00' : `${d < 0 ? '−' : '+'}${fmt.duration(Math.abs(d))}`;
const describe = f => `${f.civ ? `${civName(f.civ)}${f.vs ? ` vs ${civName(f.vs)}` : ''}` : (f.vs ? `any civilization vs ${civName(f.vs)}` : 'all civilizations')}${f.kind ? ` ${kindWord(f.kind)}` : ' (all modes)'}`;
const sameFilter = (x, y) => x.civ === y.civ && x.vs === y.vs && x.kind === y.kind;
const top = items => items?.length ? items.slice(0, 2).map(x => `${x.name} ${x.games}×`).join(', ') : null;

/** Load one side, relaxing the filter step by step (drop the opponent civ, then the mode, then the civ) when nothing is on record. */
async function loadSide(pid, want, filter, force = false) {
  const steps = [filter];
  if (filter.vs) steps.push({ ...filter, vs: '' });
  if (filter.kind) steps.push({ civ: filter.civ, vs: '', kind: '' });
  if (filter.civ) steps.push({ civ: '', vs: '', kind: '' });
  let last = null;
  for (const f of steps) {
    const d = await getJSON(profileUrl(pid, f, want), { ttl: 10 * 60e3, force: force && f === filter });
    last = { d, used: f };
    if (d.analysed > 0 || d.pending > 0 || d.rate_limited) break;
  }
  return last;
}

/* The metric rows. `get` reads a median; `extra` adds a second line (top picks, rates); `lower`/`higher` say which way is better. */
const ROWS = [
  { key: 'feudal', label: 'Feudal landmark placed', get: d => d.medians?.feudal, f: fmt.duration, kind: 'time', lower: true },
  { key: 'castle', label: 'Castle landmark placed', get: d => d.medians?.castle, f: fmt.duration, kind: 'time', lower: true },
  { key: 'imperial', label: 'Imperial landmark placed', get: d => d.medians?.imperial, f: fmt.duration, kind: 'time', lower: true },
  { key: 'villagers_by_10', label: 'Villagers queued by 10:00', get: d => d.medians?.villagers_by_10, f: fmt.int, kind: 'count', higher: true },
  { key: 'military_by_8', label: 'Military queued by 8:00', get: d => d.medians?.military_by_8, f: fmt.int, kind: 'count' },
  { key: 'military_by_12', label: 'Military queued by 12:00', get: d => d.medians?.military_by_12, f: fmt.int, kind: 'count' },
  { key: 'second_tc', label: 'Second Town Center placed', get: d => d.openings?.second_tc_time, f: fmt.duration, kind: 'time', extra: d => has(d.openings?.second_tc_rate) ? `in ${d.openings.second_tc_rate}% of games` : null },
  { key: 'first_mil', label: 'First military unit', get: d => d.openings?.first_military_time, f: fmt.duration, kind: 'time', extra: d => top(d.openings?.first_military_unit) },
  { key: 'first_mil_b', label: 'First military building', get: d => d.openings?.first_military_building_time, f: fmt.duration, kind: 'time', extra: d => top(d.openings?.first_military_building) },
  { key: 'feudal_via', label: 'Feudal landmark', get: () => null, extra: d => top(d.openings?.feudal_landmark) || '—' },
  { key: 'castle_via', label: 'Castle landmark', get: () => null, extra: d => top(d.openings?.castle_landmark) || '—' },
  { key: 'mil_share', label: 'Military share of spending', get: d => d.medians?.mil_share, f: v => fmt.pct(v, 0), kind: 'pct' },
  { key: 'apm', label: 'Commands per minute', get: d => d.medians?.apm, f: fmt.int, kind: 'count', higher: true },
  { key: 'duration', label: 'Game length', get: d => d.medians?.duration, f: fmt.duration, kind: 'time' },
];

/**
 * The Timings card for the compare page. `A`/`B` are aoe4world player records, `mA`/`mB` their stats for the current
 * mode (season civ pools drive the civ pickers), `route` carries the query (ca, cb, vs, ga, gb, mins) for shareable links.
 */
export function timingsSection({ A, B, mA, mB, modeKey, route }) {
  const a = String(A.profile_id), b = String(B.profile_id);
  const q = route.query || {};
  const civOf = (v, fallback) => (CIVS[v] ? v : v === 'all' ? '' : fallback);
  const poolB = new Set((mB.civilizations || []).map(c => c.civilization));
  const kind = KIND_FOR_MODE[modeKey] || '';
  const state = { ca: civOf(q.ca, mostPlayed(mA)), vs: CIVS[q.vs] ? q.vs : '', ga: q.ga || null, gb: q.gb || null, gbManual: !!q.gb, mins: ['10', '15', '20'].includes(q.mins) ? Number(q.mins) : 10,
    view: q.view === 'minute' ? 'minute' : 'time', kinds: new Set(['train', 'build', 'research']) };
  state.cb = civOf(q.cb, state.ca && poolB.has(state.ca) ? state.ca : (mostPlayed(mB) || state.ca));   // the same civ as A when B plays it: like with like
  const wants = { a: WANT, b: WANT };
  let sides = null, seq = 0, boardSeq = 0;

  const syncUrl = () => history.replaceState(null, '', hrefTo(`/compare/${a}/${b}`, { mode: q.mode, ca: state.ca || 'all', cb: state.cb || 'all', vs: state.vs || undefined, ga: state.ga || undefined, gb: state.gbManual ? state.gb || undefined : undefined, mins: state.mins === 10 ? undefined : String(state.mins), view: state.view === 'minute' ? 'minute' : undefined }));

  const civOptions = m => {
    const pool = [...(m.civilizations || [])].sort((x, y) => y.games_count - x.games_count);
    const inPool = new Set(pool.map(c => c.civilization));
    return [{ value: '', label: 'All civilizations' },
      ...pool.map(c => ({ value: c.civilization, label: `${civName(c.civilization)} · ${c.games_count} games` })),
      ...Object.keys(CIVS).filter(c => !inPool.has(c)).sort((x, y) => civName(x).localeCompare(civName(y))).map(c => ({ value: c, label: civName(c) }))];
  };
  const vsOptions = [{ value: '', label: 'any civilization' }, ...Object.keys(CIVS).sort((x, y) => civName(x).localeCompare(civName(y))).map(c => ({ value: c, label: civName(c) }))];

  const statusEl = el('span', { class: 'muted small' });
  const controls = el('div', { class: 'filters', style: { marginBottom: '10px' } },
    el('label', {}, `${A.name} as `, select(civOptions(mA), state.ca, v => { state.ca = v; state.ga = null; reload(); }, { ariaLabel: `${A.name} civilization` })),
    el('label', {}, `${B.name} as `, select(civOptions(mB), state.cb, v => { state.cb = v; state.gb = null; reload(); }, { ariaLabel: `${B.name} civilization` })),
    el('label', {}, 'against ', select(vsOptions, state.vs, v => { state.vs = v; state.ga = state.gb = null; reload(); }, { ariaLabel: 'Opponent civilization' })),
    el('span', { class: 'spacer' }), statusEl);
  const noteEl = el('div', { class: 'muted small', style: { margin: '0 0 10px' } });
  const tableBox = el('div', { class: 'table-wrap' });
  const sideStatus = el('div', { class: 'muted small', style: { marginTop: '8px', display: 'grid', gap: '4px' } });
  const boardBox = el('div', { style: { marginTop: '16px' } });
  const root = card('Timings', el('div', {}, controls, noteEl, tableBox, sideStatus, boardBox),
    { meta: 'medians over each player’s recent replays · age times are landmark placements, about a minute before the age-up completes', level: 2 });

  async function reload({ force = null } = {}) {
    const my = ++seq;
    syncUrl();
    clear(tableBox); tableBox.append(skeleton(8)); clear(noteEl); clear(sideStatus); clear(boardBox);
    statusEl.textContent = 'Pulling replays from the official store… a few seconds per game.';
    try {
      const [sa, sb] = await Promise.all([loadSide(a, wants.a, { civ: state.ca, vs: state.vs, kind }, force === 'a'), loadSide(b, wants.b, { civ: state.cb, vs: state.vs, kind }, force === 'b')]);
      if (my !== seq || !root.isConnected) return;
      sides = [sa, sb];
      statusEl.textContent = '';
      drawNote(); drawTable(); drawStatus(); drawBoard();
    } catch (e) {
      if (my !== seq) return;
      clear(tableBox); statusEl.textContent = '';
      tableBox.append(companionMissing(e) ? companionNotice('The timings comparison') : notice(String(e.message || e)));
    }
  }

  function drawNote() {
    clear(noteEl);
    for (const [P, s, want] of [[A, sides[0], { civ: state.ca, vs: state.vs, kind }], [B, sides[1], { civ: state.cb, vs: state.vs, kind }]]) {
      if (!sameFilter(s.used, want)) noteEl.append(el('span', {}, el('strong', {}, P.name), ` has no recent ${describe(want)} games on record; showing ${describe(s.used)}. `));
    }
  }

  function drawTable() {
    clear(tableBox);
    const [sa, sb] = sides;
    if (!sa.d.analysed && !sb.d.analysed) {
      tableBox.append(emptyState(sa.d.rate_limited || sb.d.rate_limited ? 'The official replay store is rate-limiting downloads; try again in a minute.' : 'No replays could be analysed for either player yet.'));
      return;
    }
    const head = (P, s, color) => el('th', { class: 'center' }, el('span', { class: 'swatch', style: { background: color } }), ' ', P.name,
      el('div', { class: 'th-sub' }, s.used.civ ? civChip(s.used.civ, { name: 'short' }) : 'all civs', s.used.vs ? ` vs ${civShort(s.used.vs)}` : '', s.used.kind ? ` · ${kindWord(s.used.kind)}` : ' · all modes', ` · ${s.d.analysed} game${s.d.analysed === 1 ? '' : 's'}`));
    const cell = (r, v, d, used, better) => {
      const main = r.get === undefined || r.key.endsWith('_via') ? null : has(v) ? r.f(v) : (used.civ === 'vikings' && r.key === 'villagers_by_10' ? 'n/a' : '—');
      const extra = r.extra?.(d);
      return el('td', { class: `center ${better ? 'better' : ''}` }, main !== null ? el('span', { class: 'num' }, main) : null, extra ? el('div', { class: 'muted small' }, extra) : null);
    };
    const gap = (r, vA, vB) => {
      if (!has(vA) || !has(vB) || !r.kind) return el('td', { class: 'center muted' }, r.key.endsWith('_via') ? '' : '—');
      const d = vB - vA;
      const text = r.kind === 'time' ? signedDuration(d) : r.kind === 'pct' ? `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(0)} pts` : (d > 0 ? '+' : d < 0 ? '−' : '±') + fmt.int(Math.abs(Math.round(d)));
      return el('td', { class: 'center num gap' }, text);
    };
    const rows = ROWS.map(r => {
      const vA = r.get(sa.d), vB = r.get(sb.d);
      const both = has(vA) && has(vB) && vA !== vB;
      const betterA = both && (r.lower ? vA < vB : r.higher ? vA > vB : false), betterB = both && (r.lower ? vB < vA : r.higher ? vB > vA : false);
      return el('tr', {}, el('td', { class: 'metric' }, r.label), cell(r, vA, sa.d, sa.used, betterA), cell(r, vB, sb.d, sb.used, betterB), gap(r, vA, vB));
    });
    tableBox.append(el('table', { class: 'data compare timings' },
      el('thead', {}, el('tr', {}, el('th', { class: 'metric' }, 'Median'), head(A, sa, 'var(--s1)'), head(B, sb, 'var(--s2)'), el('th', { class: 'center' }, `${B.name} − ${A.name}`))),
      el('tbody', {}, rows)));
  }

  function drawStatus() {
    clear(sideStatus);
    for (const [P, s, key] of [[A, sides[0], 'a'], [B, sides[1], 'b']]) {
      const d = s.d, what = `${s.used.civ ? `${civShort(s.used.civ)} ` : ''}${s.used.vs ? `vs ${civShort(s.used.vs)} ` : ''}${s.used.kind ? `${kindWord(s.used.kind)} ` : ''}`;
      const line = el('div', {}, el('strong', {}, P.name), `: ${d.analysed} ${what}replay${d.analysed === 1 ? '' : 's'} analysed of ${d.candidates} recent ${what}game${d.candidates === 1 ? '' : 's'} on record${d.missing ? ` · ${d.missing} unavailable` : ''}`);
      if (d.pending || d.rate_limited) {
        line.append(' · ', el('button', { class: 'btn sm', type: 'button', onClick: e => { e.target.disabled = true; e.target.textContent = 'Fetching…'; wants[key] = d.analysed + 6; reload({ force: key }); } },
          d.rate_limited ? 'Store rate-limited — retry' : `Analyse ${Math.min(6, d.pending)} more`));
      }
      // the harvester pulls this player's whole history in the background; the table refreshes as replays land
      line.append(' ', harvestControl({ pid: key === 'a' ? a : b, onProgress: h => { if ((h.done || 0) % 5 === 0) reload({ force: key }); }, onDone: () => reload({ force: key }) }));
      sideStatus.append(line);
    }
  }

  /* ----- game by game ----- */
  const gameLabel = g => {
    const opp = oppCivs(g);
    return `${fmt.date(g.started_at)} · ${g.map} · ${civShort(g.civ)} vs ${opp.length ? opp.slice(0, 2).map(civShort).join(' + ') + (opp.length > 2 ? ' …' : '') : '?'} · ${g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : '?'} · ${fmt.duration(g.duration)}`;
  };
  const findGame = (list, id) => list.find(g => String(g.game_id) === String(id));
  const sameMatchup = (g, oppCiv) => !!oppCiv && oppCivs(g).includes(oppCiv);
  function pickDefaults() {
    const gA = sides[0].d.games, gB = sides[1].d.games;
    if (!findGame(gA, state.ga)) { state.ga = gA[0]?.game_id ?? null; state.gbManual = false; }
    const a0 = findGame(gA, state.ga), oppA = a0 ? oppCivs(a0)[0] : null, mapA = a0?.map;
    if (!state.gbManual || !findGame(gB, state.gb)) {
      // B follows A's game: the same matchup on the same map, then the same matchup, then the same map, then the newest
      const pick = gB.find(g => sameMatchup(g, oppA) && g.map === mapA) || gB.find(g => sameMatchup(g, oppA)) || gB.find(g => g.map === mapA) || gB[0];
      state.gb = pick?.game_id ?? null;
      state.gbManual = false;
    }
  }
  /** B's games grouped so the matchup A is in comes first and is counted, then the same map, then the rest. */
  function groupedOptions(games, oppA, mapA) {
    const opt = g => ({ value: String(g.game_id), label: gameLabel(g) });
    const same = games.filter(g => sameMatchup(g, oppA)), map = games.filter(g => !sameMatchup(g, oppA) && g.map === mapA), rest = games.filter(g => !sameMatchup(g, oppA) && g.map !== mapA);
    const groups = [];
    if (same.length) groups.push({ label: `Same matchup · ${civShort(same[0].civ)} vs ${civShort(oppA)} (${same.length})`, options: same.map(opt) });
    if (map.length) groups.push({ label: `Same map · ${mapA} (${map.length})`, options: map.map(opt) });
    if (rest.length) groups.push({ label: groups.length ? `Other games (${rest.length})` : 'Games', options: rest.map(opt) });
    return groups;
  }
  /** One line answering "does B have A's matchup at all?", from the companion's per-opponent counts of games on record. */
  function matchupLine(a0) {
    const oppA = a0 ? oppCivs(a0)[0] : null;
    if (!oppA) return null;
    const sb = sides[1], civB = sb.used.civ || sb.d.games[0]?.civ;
    const rec = sb.d.by_opponent?.[oppA] || { on_record: 0, analysed: 0 };
    const mu = `${civB ? civShort(civB) : 'their civ'} vs ${civShort(oppA)}`;
    const line = el('div', { class: 'muted small matchup-line' }, el('strong', {}, B.name), ` as ${mu}: `);
    if (!rec.on_record) line.append(`none among the recent ${civB ? `${civShort(civB)} ` : ''}games on record, so the list shows other games.`);
    else {
      line.append(el('strong', {}, `${rec.analysed} analysed of ${rec.on_record} on record`));
      if (rec.on_record > rec.analysed || state.vs !== oppA) line.append(' · ', el('button', { class: 'linkish', type: 'button', title: 'Filter both players to this matchup; replays not yet analysed are fetched', onClick: () => { state.vs = oppA; state.ga = state.gb = null; state.gbManual = false; reload(); } }, rec.on_record > rec.analysed ? `analyse the other ${rec.on_record - rec.analysed} and focus on ${mu}` : `focus both sides on ${mu}`));
    }
    return line;
  }
  function drawBoard() {
    clear(boardBox);
    pickDefaults(); syncUrl();
    const gA = sides[0].d.games, gB = sides[1].d.games;
    if (!gA.length || !gB.length) { boardBox.append(card('Game by game', emptyState('Both players need at least one analysed game for the side-by-side view.'), { level: 3 })); return; }
    const a0 = findGame(gA, state.ga), oppA = a0 ? oppCivs(a0)[0] : null, mapA = a0?.map;
    const pickA = select(gA.map(g => ({ value: String(g.game_id), label: gameLabel(g) })), String(state.ga), v => { state.ga = v; state.gbManual = false; drawBoard(); }, { ariaLabel: `${A.name}’s game` });
    const pickB = select(groupedOptions(gB, oppA, mapA), String(state.gb), v => { state.gb = v; state.gbManual = true; drawBoard(); }, { ariaLabel: `${B.name}’s game` });
    const chips = el('div', { class: 'tags' }, [['train', 'Units'], ['build', 'Buildings'], ['research', 'Technologies']].map(([k, label]) =>
      el('button', { type: 'button', class: `chip ${state.kinds.has(k) ? 'on' : ''}`, 'aria-pressed': String(state.kinds.has(k)), onClick: () => { if (state.kinds.has(k)) state.kinds.delete(k); else state.kinds.add(k); drawBoard(); } }, label)));
    const controls2 = el('div', { class: 'filters', style: { marginBottom: '10px' } },
      el('label', {}, `${A.name}: `, pickA), el('label', {}, `${B.name}: `, pickB), el('span', { class: 'spacer' }), chips,
      segmented([{ value: 'time', label: 'One clock' }, { value: 'minute', label: 'By minute' }], state.view, v => { state.view = v; drawBoard(); }, { ariaLabel: 'Board layout' }),
      segmented(MINUTE_OPTS, String(state.mins), v => { state.mins = Number(v); drawBoard(); }, { ariaLabel: 'Minutes shown' }));
    const grid = el('div', { class: 'bo-board-wrap' }, skeleton(8));
    boardBox.append(card(`Game by game · first ${state.mins} minutes`, el('div', {}, controls2, matchupLine(a0), grid),
      { level: 3, meta: state.view === 'time' ? 'both replays on one clock: each order sits in its player’s lane at its own time, and orders within 5 s of each other share a row' : 'every order from each replay, grouped by minute · running totals at the end of each minute' }));
    const my = ++boardSeq;
    Promise.all([getJSON(gameUrl(state.ga, a), { ttl: 5 * 60e3 }), getJSON(gameUrl(state.gb, b), { ttl: 5 * 60e3 })]).then(([da, db]) => {
      if (my !== boardSeq || !grid.isConnected) return;
      clear(grid); grid.append(renderBoard(da, db));
    }).catch(e => { if (my !== boardSeq || !grid.isConnected) return; clear(grid); grid.append(notice(String(e.message || e))); });
  }
  function renderBoard(da, db) {
    const cols = [[A, da, 'var(--s1)'], [B, db, 'var(--s2)']].map(([P, d, color]) => {
      const all = d.teams.flat();
      const p = all.find(x => x.is_focus) || all[0];
      const team = d.teams.find(t => t.includes(p)) || [];
      return { P, d, color, p, rp: p?.replay, opps: all.filter(x => !team.includes(x)) };
    });
    const board = el('div', { class: `bo-board two ${state.view}` });
    for (const s of cols) {
      board.append(el('div', { class: 'bo-head' },
        el('div', { class: 'who' }, el('i', { class: 'dot', style: { background: s.color } }), el('a', { href: hrefTo(`/player/${s.P.profile_id}`) }, s.P.name), resultPill(s.p?.result)),
        el('div', { class: 'muted small team' }, s.p ? civChip(s.p.civilization, { name: 'short' }) : null, 'vs', ...s.opps.slice(0, 3).map(o => civChip(o.civilization, { name: 'short' })),
          `· ${s.d.game.map} · ${fmt.date(s.d.game.started_at)}`, s.d.mapgen?.seed ? el('span', { title: 'match seed from the official match options; ranked seeds are random per game' }, ` · seed ${s.d.mapgen.seed}`) : null, ' · ',
          el('a', { href: hrefTo(`/game/${s.d.game.game_id}`, { p: s.P.profile_id }) }, 'Summary ›'))));
    }
    const limit = state.mins;
    const totals = cols.map(s => s.rp ? runningTotals(s.rp.events, s.d.blueprints, limit) : null);
    const minuteHead = m => el('div', { class: 'bo-minute', style: { gridColumn: '1 / -1' } }, `${m}:00`);
    const totLine = (i, m) => { const t = totals[i][m]; return el('div', { class: 'bo-tot muted small num' }, `by ${m + 1}:00 · ${t.villagers} villager${t.villagers === 1 ? '' : 's'} · ${t.military} military · ${t.buildings} building${t.buildings === 1 ? '' : 's'}`); };
    const noReplay = s => el('div', { class: 'muted small', style: { padding: '2px 6px' } }, `No replay for this game (${String(s.d.replay?.status || 'unavailable').replace('_', ' ')}).`);
    if (state.view === 'minute') {
      const byMin = cols.map(s => s.rp ? groupEvents(s.rp.events.filter(e => state.kinds.has(e.c || e.k))) : new Map());
      for (let m = 0; m < limit; m++) {
        board.append(minuteHead(m));
        cols.forEach((s, i) => {
          if (!s.rp) { board.append(el('div', { class: 'bo-cell events' }, m === 0 ? noReplay(s) : null)); return; }
          const evs = byMin[i].get(m) || [];
          board.append(el('div', { class: 'bo-cell events' }, totLine(i, m),
            evs.length ? evs.map(ev => eventEl(ev, s.d.blueprints, s.rp.ages)) : el('div', { class: 'muted small', style: { padding: '2px 6px' } }, 'nothing queued, placed or researched')));
        });
      }
    } else {
      // One clock: both players' orders sorted by time, each in its own lane. An order from the other lane within
      // PAIR_S seconds of the row's first order joins that row, so near-simultaneous moves sit side by side.
      const PAIR_S = 5;
      if (cols.some(s => !s.rp)) cols.forEach(s => board.append(el('div', { class: 'bo-cell events lane' }, s.rp ? null : noReplay(s))));
      const merged = cols.flatMap((s, lane) => (s.rp ? s.rp.events.filter(e => state.kinds.has(e.c || e.k) && e.t < limit * 60) : []).map(e => ({ e, lane }))).sort((x, y) => x.e.t - y.e.t);
      const rowsByMinute = new Map();
      for (const x of merged) {
        const m = Math.floor(x.e.t / 60);
        if (!rowsByMinute.has(m)) rowsByMinute.set(m, []);
        const rows = rowsByMinute.get(m), last = rows.at(-1);
        if (last && !last.lanes[x.lane] && x.e.t - last.t <= PAIR_S) last.lanes[x.lane] = x.e;
        else rows.push({ t: x.e.t, lanes: { [x.lane]: x.e } });
      }
      for (let m = 0; m < limit; m++) {
        board.append(minuteHead(m));
        const rows = rowsByMinute.get(m) || [];
        if (!rows.length) cols.forEach(s => board.append(el('div', { class: 'bo-cell events lane' }, s.rp ? el('div', { class: 'muted small', style: { padding: '2px 6px' } }, 'nothing') : null)));
        for (const r of rows) cols.forEach((s, i) => board.append(el('div', { class: `bo-cell events lane ${r.lanes[i] ? '' : 'empty'}` }, r.lanes[i] ? eventEl(r.lanes[i], s.d.blueprints, s.rp.ages) : null)));
        cols.forEach((s, i) => board.append(el('div', { class: 'bo-cell tot' }, s.rp ? totLine(i, m) : el('span', { class: 'muted small' }, '—'))));
      }
    }
    board.append(el('div', { class: 'bo-minute', style: { gridColumn: '1 / -1' } }, 'Age-ups in this game'));
    for (const s of cols) {
      board.append(el('div', { class: 'bo-cell' }, s.rp
        ? el('div', { class: 'small' }, s.rp.ages.length ? s.rp.ages.map(ag => `${AGE[ag.age] || ag.age} ${fmt.duration(ag.time)} via ${ag.via}`).join(' · ') : 'No age-up recorded')
        : el('span', { class: 'muted small' }, '—')));
    }
    return board;
  }

  reload();
  return root;
}
