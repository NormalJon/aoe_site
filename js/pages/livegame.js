// Live game panel for a profile (the op.gg "live game" idea, for AoE IV).
// Polls AoE4 World for the newest game of the viewed player while the page is open; when one is ongoing it shows
// both rosters and, for every opponent, intel on how they have been piloting the civ they are on this game:
//   * tells from their recent replays as that civ, computed by the companion (Dark Age spearmen, Feudal pressure,
//     2nd-TC rate, Castle timing, landmark choices, army mix, early techs, scripted vs improvised openings…),
//   * ladder numbers for that civ, recent form, record on this map and against the viewed player (AoE4 World).
// Between games the panel offers "Scout ahead": type the opponent's name from the loading screen, pick their civ.
import { el, fmt, hrefTo, clear, median } from '../util.js';
import { api, getJSON, fetchPlayerGames, ApiError } from '../api.js';
import { civChip, rankBadge, resultPill, streakEl, searchBox, select, card, skeleton, emptyState, bindTooltip, ttRows, flattenTeams, playerLink } from '../components.js';
import { CIVS, civName, civShort, civFlag, kindName, CHART_SERIES, LB } from '../constants.js';
import { companionHint, defaultMode } from './_shared.js';
import { perspective } from './player_overview.js';
import { getMe } from '../me.js';
import { harvestControl } from './_harvest.js';

const POLL_MS = 30000;
const companionMissing = e => !(e instanceof ApiError) || [404, 501, 405].includes(e.status);
const KIND_LABEL = { aggression: 'Aggression', tempo: 'Tempo', economy: 'Economy', army: 'Army', defense: 'Defence', tech: 'Tech', habit: 'Habit' };
const lbOf = g => g.leaderboard || (g.kind === 'rm_1v1' ? 'rm_solo' : /^rm_/.test(g.kind || '') ? 'rm_team' : g.kind);
const scoutKey = id => `forge-scout-${id}`;
const loadScout = id => { try { return JSON.parse(sessionStorage.getItem(scoutKey(id)) || 'null'); } catch { return null; } };
const saveScout = (id, v) => { try { if (v) sessionStorage.setItem(scoutKey(id), JSON.stringify(v)); else sessionStorage.removeItem(scoutKey(id)); } catch { /* ignore */ } };

/**
 * Build the panel. `gamesP` resolves to the viewer's recent games (newest first) and seeds the first state;
 * afterwards the panel polls on its own. Returns { el, stop }.
 */
export function liveGamePanel({ player, gamesP }) {
  const id = player.profile_id;
  const body = el('div', { class: 'lg-body' });
  const metaEl = el('span', { class: 'meta' }, 'checking…');
  const checkBtn = el('button', { class: 'btn sm', type: 'button' }, 'Check now');
  const root = card('Live game', body, { level: 2, meta: metaEl, actions: el('div', { class: 'lg-actions' }, checkBtn, el('a', { class: 'btn sm ghost', href: '#/live' }, 'Live feed ›')) });
  root.classList.add('live-panel');
  let timer = null, clock = null, current = null, lastGame = null, clockEl = null, checking = false, stopped = false, drawn = false;

  const tick = () => { if (clockEl && current) clockEl.textContent = fmt.duration(Math.max(0, (Date.now() - new Date(current.started_at).getTime()) / 1000)); };
  function apply(g) {
    lastGame = g;
    const live = g?.ongoing ? g : null;
    const changed = (live?.game_id || null) !== (current?.game_id || null);
    current = live;
    if (changed || !drawn) { drawn = true; draw(); } else tick();
  }
  function draw() {
    clear(body); clockEl = null;
    if (current) drawGame(body, current, player, c => { clockEl = c; });
    else drawIdle(body, player, lastGame);
  }
  async function check(force = false) {
    if (checking || stopped) return;
    checking = true; checkBtn.disabled = true;
    try {
      apply(await api.latestGame(id, force));
      metaEl.textContent = `checked ${new Date().toLocaleTimeString()} · every ${POLL_MS / 1000} s while this page is open`;
    } catch (e) { metaEl.textContent = `check failed: ${e.message || e}`; }
    checking = false; checkBtn.disabled = false;
  }
  function start() { if (stopped) return; stopTimers(); timer = setInterval(() => { if (!document.hidden) check(true); }, POLL_MS); clock = setInterval(tick, 1000); }   // never after stop(): the page may already be gone
  function stopTimers() { clearInterval(timer); clearInterval(clock); timer = clock = null; }
  const onVis = () => { if (!document.hidden) check(true); };
  document.addEventListener('visibilitychange', onVis);
  checkBtn.addEventListener('click', () => check(true));
  body.append(skeleton(2));
  gamesP.then(({ games }) => { if (stopped) return; apply(games?.[0] || null); metaEl.textContent = `checked ${new Date().toLocaleTimeString()} · every ${POLL_MS / 1000} s while this page is open`; start(); })
    .catch(() => { if (!stopped) check(false).then(start); });
  return { el: root, stop: () => { stopped = true; stopTimers(); document.removeEventListener('visibilitychange', onVis); } };
}

/* ---------- in a game ---------- */
function drawGame(body, g, viewer, setClock) {
  const id = viewer.profile_id;
  const teams = flattenTeams(g);
  const mine = teams.find(t => t.some(p => p.profile_id === id)) || teams[0] || [];
  const others = teams.filter(t => t !== mine);
  const opps = others.flat();
  const lb = lbOf(g);
  const clockEl = el('span', { class: 'lg-clock num' }, fmt.duration(Math.max(0, (Date.now() - new Date(g.started_at).getTime()) / 1000)));
  setClock(clockEl);
  body.append(el('div', { class: 'lg-head' }, resultPill('live'), el('strong', {}, g.map || 'Unknown map'), el('span', { class: 'muted' }, kindName(g.kind)),
    g.server ? el('span', { class: 'muted' }, g.server) : null, el('span', { class: 'muted' }, 'elapsed ', clockEl),
    g.average_rating ? el('span', { class: 'muted' }, `avg rating ${fmt.int(g.average_rating)}`) : (g.average_mmr ? el('span', { class: 'muted' }, `avg MMR ${fmt.int(g.average_mmr)}`) : null),
    el('span', { class: 'muted small', title: fmt.dateTime(g.started_at) }, `started ${fmt.rel(g.started_at)}`)));
  const col = (team, label, cls) => el('div', { class: `lg-team ${cls}` }, el('div', { class: 'lg-team-label' }, label), team.map(p => playerRow(p, p.profile_id === id)));
  body.append(el('div', { class: 'lg-teams' },
    col(mine, `${viewer.name}'s side`, 'mine'),
    el('div', { class: 'lg-vs' }, 'vs'),
    el('div', { class: 'lg-others' }, others.map((t, i) => col(t, others.length > 1 ? `Opponents · team ${i + 1}` : 'Opponents', 'theirs')))));
  if (!opps.length) { body.append(emptyState('No opponents listed yet; AoE4 World fills in the roster a minute or two after a game starts.')); return; }
  body.append(el('div', { class: 'lg-intel-list' }, opps.map(o => opponentIntel({ opp: o, civ: CIVS[o.civilization] ? o.civilization : '', viewer, lb, map: g.map }))));
}
function playerRow(p, isViewer) {
  return el('div', { class: `lg-p ${isViewer ? 'viewer' : ''}` },
    el('img', { class: 'lg-flag', src: civFlag(p.civilization), alt: civName(p.civilization), title: civName(p.civilization), width: 28, height: 15 }),
    el('div', { class: 'lg-who' }, el('a', { class: 'lg-name', href: hrefTo(`/player/${p.profile_id}`) }, p.name || `#${p.profile_id}`),
      el('div', { class: 'muted small' }, civName(p.civilization), p.civilization_randomized ? ' · random' : '')),
    el('div', { class: 'lg-rating num' }, p.rating ? fmt.int(p.rating) : p.mmr ? el('span', { title: 'hidden MMR' }, fmt.int(p.mmr)) : el('span', { class: 'muted' }, '—')));
}

/* ---------- between games: last game + scout ahead ---------- */
function drawIdle(body, viewer, last) {
  const id = viewer.profile_id;
  const line = el('div', { class: 'lg-idle muted' }, el('span', {}, `${viewer.name} is not in a game right now.`));
  if (last) {
    const { me, opps } = perspective(last, id);
    line.append(el('span', {}, 'Last game ', el('strong', { title: fmt.dateTime(last.started_at) }, fmt.rel(last.started_at)), `: ${last.map} · ${kindName(last.kind)}`,
      opps.length ? [' vs ', opps.map((o, i) => [i ? ', ' : '', el('a', { href: hrefTo(`/player/${o.profile_id}`) }, o.name)])] : null,
      me?.result ? [' · ', resultPill(me.result)] : null, ' · ', el('a', { href: hrefTo(`/game/${last.game_id}`, { p: id }) }, 'Summary ›')));
  }
  body.append(line);

  const saved = loadScout(id);
  let pick = saved?.pick || null, civ = saved?.civ && CIVS[saved.civ] ? saved.civ : '';
  const resBox = el('div', { class: 'lg-scout-result' });
  const chosen = el('span', { class: 'lg-chosen' });
  const civSel = select([{ value: '', label: 'Any civ · whole record' }, ...Object.keys(CIVS).map(c => ({ value: c, label: civName(c) }))], civ,
    v => { civ = v; saveScout(id, { pick, civ }); drawResult(); }, { ariaLabel: 'Civilization the opponent is on' });
  const sb = searchBox({ placeholder: 'Opponent’s name from the loading screen…', onPick: p => { pick = { profile_id: p.profile_id, name: p.name, country: p.country }; saveScout(id, { pick, civ }); drawResult(); } });
  function drawResult() {
    clear(chosen); clear(resBox);
    if (!pick) {
      resBox.append(el('p', { class: 'muted small', style: { margin: '8px 0 0' } }, 'Type the opponent’s name and pick the civ they are on to see how they have been piloting it: Dark Age military, Feudal pressure, 2nd-TC rate, Castle timing, landmark choices, army mix, early techs, recent form, and your record against them. In a game, this fills in by itself.'));
      return;
    }
    chosen.append(playerLink(pick, { showAvatar: false }), ' ', el('button', { class: 'linkish small', type: 'button', onClick: () => { pick = null; saveScout(id, null); drawResult(); } }, 'clear'));
    resBox.append(opponentIntel({ opp: pick, civ, viewer, lb: null, map: null }));
  }
  body.append(el('div', { class: 'lg-scout' }, el('div', { class: 'lg-scout-row' }, el('span', { class: 'muted small' }, 'Scout ahead:'), sb, civSel, chosen), resBox));
  drawResult();
}

/* ---------- one opponent, one civ ---------- */
export function opponentIntel({ opp, civ, viewer, lb, map }) {
  const pid = opp.profile_id, vid = viewer.profile_id;
  const box = el('section', { class: 'intel' });
  const ladder = el('div', { class: 'intel-ladder small' }, el('span', { class: 'muted' }, 'ladder…'));
  const facts = el('div', { class: 'intel-facts' }, skeleton(2));
  const tells = el('div', { class: 'intel-tells' });
  const numbers = el('div', { class: 'intel-numbers' });
  const games = el('div', { class: 'intel-games' });
  const metaEl = el('div', { class: 'muted small', style: { marginTop: '8px' } });
  const numbersCap = el('div', { class: 'cap', style: { marginTop: '12px' } }, 'By the numbers · medians');   // hidden while there is nothing to show
  box.append(
    el('div', { class: 'intel-head' },
      civ ? civChip(civ, { size: 'lg' }) : el('span', { class: 'civ lg' }, el('span', { class: 'cname muted' }, 'All civs')),
      el('div', { class: 'intel-title' },
        el('div', { class: 'intel-name' }, el('a', { href: hrefTo(`/player/${pid}`) }, opp.name || `#${pid}`), civ ? el('span', { class: 'muted' }, ` on ${civName(civ)}`) : null, ' ', el('a', { class: 'small', href: hrefTo(`/compare/${vid}/${pid}`) }, 'compare ›')),
        ladder)),
    el('div', { class: 'intel-grid' },
      el('div', {}, el('div', { class: 'cap' }, 'Tells from replays'), tells),
      el('div', {}, el('div', { class: 'cap' }, 'Quick facts'), facts, numbersCap, numbers)),
    games, metaEl);

  /* ladder: rating, rank, civ pick/win rate on the relevant ladder */
  api.player(pid).then(p => {
    clear(ladder);
    const key = lb && p.modes?.[lb] ? lb : defaultMode(p);
    const m = p.modes?.[key] || {};
    const short = LB[key]?.short || key;
    ladder.append(el('div', {}, el('strong', {}, fmt.int(m.rating)), ' ',
      m.rank_level && m.rank_level !== 'unranked' ? rankBadge(m.rank_level, { sm: true, rank: m.rank }) : el('span', { class: 'muted' }, m.rank ? `#${fmt.int(m.rank)} ${short}` : `${short} · unranked`),
      m.games_count ? el('span', {}, ` · ${fmt.pct(m.win_rate, 0)} over ${fmt.int(m.games_count)} games`) : null,
      m.streak ? [' · ', streakEl(m.streak)] : null,
      m.max_rating ? el('span', { class: 'muted' }, ` · peak ${fmt.int(m.max_rating)}`) : null));
    const pool = [...(m.civilizations || [])].sort((a, b) => b.games_count - a.games_count);
    if (civ) {
      const c = pool.find(x => x.civilization === civ);
      ladder.append(el('div', {}, c ? [`Plays ${civShort(civ)} in `, el('strong', {}, fmt.pct(c.pick_rate, 0)), ` of ${short} games this season · `, el('strong', {}, fmt.pct(c.win_rate, 0)), ` win rate over ${c.games_count}`]
        : el('span', { class: 'muted' }, `No ${civShort(civ)} games on the ${short} ladder this season: an off-civ pick.`)));
    }
    if (pool.length) ladder.append(el('div', { class: 'muted' }, 'Usual picks: ', pool.slice(0, 3).map((x, i) => [i ? ', ' : '', `${civShort(x.civilization)} ${fmt.pct(x.pick_rate, 0)}`])));
  }).catch(() => { clear(ladder); ladder.append(el('span', { class: 'muted' }, 'ladder data unavailable')); });

  /* quick facts from the API record alone (works without the companion) */
  fetchPlayerGames(pid, {}, 2).then(({ games: gs }) => {
    clear(facts);
    const done = gs.filter(g => !g.ongoing).map(g => { const v = perspective(g, pid); return { g, me: v.me, opps: v.opps }; }).filter(x => x.me?.result);
    if (!done.length) { facts.append(el('span', { class: 'muted small' }, 'No finished games on record.')); return; }
    const rec = arr => { const w = arr.filter(x => x.me.result === 'win').length; return `${w}–${arr.length - w}`; };
    const last10 = done.slice(0, 10);
    let streak = 0;
    for (const x of done) { const w = x.me.result === 'win'; if (!streak) streak = w ? 1 : -1; else if ((streak > 0) === w) streak += w ? 1 : -1; else break; }
    const net10 = last10.reduce((a, x) => a + (x.me.rating_diff || 0), 0);
    const rows = [['Form', el('span', {}, el('strong', {}, rec(last10)), ` in the last ${last10.length} · streak `, streakEl(streak), net10 ? [' · ', el('span', { class: `num ${net10 > 0 ? 'good' : 'bad'}` }, fmt.signed(net10)), ' rating'] : null)]];
    if (civ) {
      const asCiv = done.filter(x => x.me.civilization === civ);
      const recent = done.slice(0, 20).filter(x => x.me.civilization === civ).length;
      rows.push([`As ${civShort(civ)}`, asCiv.length ? el('span', {}, el('strong', {}, rec(asCiv)), ` in the last ${done.length} games · ${recent} of the last ${Math.min(20, done.length)}`) : el('span', { class: 'muted' }, `none in the last ${done.length} games`)]);
    }
    if (map) {
      const onMap = done.filter(x => x.g.map === map);
      rows.push([`On ${map}`, onMap.length ? el('span', {}, el('strong', {}, rec(onMap)), civ && onMap.some(x => x.me.civilization === civ) ? ` · as ${civShort(civ)}: ${rec(onMap.filter(x => x.me.civilization === civ))}` : '') : el('span', { class: 'muted' }, 'no recent games')]);
    }
    const vs = done.filter(x => x.opps.some(o => o.profile_id === vid));
    rows.push([`vs ${viewer.name}`, vs.length ? el('span', {}, el('strong', {}, `${vs.filter(x => x.me.result === 'loss').length}–${vs.filter(x => x.me.result === 'win').length}`), ` for ${viewer.name} · last ${fmt.rel(vs[0].g.started_at)}`) : el('span', { class: 'muted' }, 'no meetings in their recent games')]);
    const lens = done.map(x => x.g.duration).filter(Number.isFinite);
    if (lens.length) rows.push(['Game length', `median ${fmt.duration(median(lens))} · longest ${fmt.duration(Math.max(...lens))}`]);
    facts.append(el('dl', { class: 'kv' }, rows.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
  }).catch(() => { clear(facts); facts.append(el('span', { class: 'muted small' }, 'recent games unavailable')); });

  /* replay intel from the companion; the viewer's own medians give the "you" column */
  let want = 6;
  const mineP = getJSON(`local/profile/${vid}?n=10&budget=20`, { ttl: 10 * 60e3 }).catch(() => null);
  const moreBtn = d => el('button', { class: 'btn sm', type: 'button', onClick: e => { e.target.disabled = true; e.target.textContent = 'Fetching…'; want = d.analysed + 6; load(true); } },
    d.rate_limited ? 'Store rate-limited — retry' : `Analyse ${Math.min(6, d.pending)} more`);
  function load(force = false) {
    clear(tells); clear(numbers); clear(games);
    tells.append(el('p', { class: 'muted small', style: { margin: '0 0 6px' } }, `Pulling ${opp.name}’s recent ${civ ? `${civName(civ)} ` : ''}replays from the official store… a few seconds per game.`), skeleton(4));
    numbersCap.hidden = false; numbers.append(skeleton(3));
    const url =`local/profile/${pid}?${new URLSearchParams({ ...(civ ? { civ } : {}), n: String(want), budget: '15' })}`;
    Promise.all([getJSON(url, { ttl: 10 * 60e3, force }), mineP]).then(([d, mine]) => { if (box.isConnected) drawReplayIntel(d, mine); }).catch(e => {
      clear(tells); clear(numbers); clear(games); metaEl.textContent = '';
      tells.append(el('p', { class: 'muted small', style: { margin: 0 } }, companionMissing(e) ? ['Replay tells need the companion server. ', ...companionHint()] : String(e.message || e)));
      numbersCap.hidden = true;
    });
  }
  function drawReplayIntel(d, mine) {
    clear(tells); clear(numbers); clear(games);
    const n = d.analysed;
    const civWord = civ ? `${civShort(civ)} ` : '';
    metaEl.textContent = `${n} ${civWord}replay${n === 1 ? '' : 's'} analysed of ${d.candidates} recent ${civWord}games on record${d.missing ? ` · ${d.missing} unavailable` : ''}. Percentages are shares of the analysed games. `;
    metaEl.append(harvestControl({ pid, label: 'Pull all their replays', onDone: () => load(true) }));
    if (!n) {
      tells.append(el('p', { class: 'muted small', style: { margin: 0 } }, d.candidates ? (d.rate_limited ? 'The official replay store is rate-limiting downloads; try again in a minute. ' : 'No replays could be fetched for these games yet. ') : `No ${civ ? `${civName(civ)} ` : ''}games among the last ${fmt.int(d.games_scanned || 0)} on record. `,
        (d.pending || d.rate_limited) ? moreBtn(d) : null));
      numbersCap.hidden = true;
      return;
    }
    const list = el('ul', { class: 'tells' });
    for (const t of d.intel || []) {
      list.append(el('li', { class: t.pct >= 60 ? 'strong' : '' },
        el('div', { class: 'tell-top' }, el('span', { class: 'tell-kind' }, KIND_LABEL[t.kind] || t.kind), el('strong', {}, t.label), el('span', { class: 'tell-n num', title: `${t.count} of ${t.n} analysed games` }, `${t.count}/${t.n}`)),
        el('div', { class: 'tell-bar' }, el('span', { style: { width: `${t.pct}%` } })),
        el('div', { class: 'tell-text muted small' }, t.text)));
    }
    if (!(d.intel || []).length) list.append(el('li', { class: 'muted small' }, `No strong pattern across ${n} game${n === 1 ? '' : 's'}.`));
    tells.append(list);
    const tags = (d.tags || []).filter(t => t.pct >= 30 && !['most_villagers', 'biggest_army', 'fastest_feudal'].includes(t.tag)).slice(0, 6);
    if (tags.length) tells.append(el('div', { class: 'tags', style: { marginTop: '8px' } }, el('span', { class: 'muted small' }, 'Tags: '), tags.map(t => bindTooltip(el('span', { class: 'tag', tabindex: 0 }, `${t.label} ${t.pct}%`), () => ttRows(t.label, [{ label: 'in', value: `${t.count} of ${n} analysed games` }])))));

    const m = d.medians || {}, o = d.openings || {}, mm = mine?.medians || {};
    const youLabel = String(getMe()) === String(vid) ? 'you' : viewer.name;   // the comparison column is the viewed profile
    const you = (v, f = x => x) => mine && v !== null && v !== undefined ? el('span', { class: 'muted small you' }, ` · ${youLabel} ${f(v)}`) : null;
    const top = (items, k = 2) => items?.length ? items.slice(0, k).map((x, i) => [i ? ', ' : '', el('strong', {}, x.name), el('span', { class: 'muted' }, ` ${x.games}/${n}`)]) : el('span', { class: 'muted' }, '—');
    numbers.append(el('dl', { class: 'kv' },
      el('dt', {}, 'Feudal · Castle placed'), el('dd', {}, `${fmt.duration(m.feudal)} · ${fmt.duration(m.castle)}`, mm.feudal !== undefined ? you(`${fmt.duration(mm.feudal)} · ${fmt.duration(mm.castle)}`) : null),
      el('dt', {}, 'Villagers by 10:00'), el('dd', {}, m.villagers_by_10 === null && civ === 'vikings' ? el('span', { class: 'muted' }, 'n/a · Bondi spawn from Longhouses') : fmt.int(m.villagers_by_10), you(mm.villagers_by_10, fmt.int)),
      el('dt', {}, 'Military by 8:00 · 12:00'), el('dd', {}, `${fmt.int(m.military_by_8)} · ${fmt.int(m.military_by_12)}`, mm.military_by_8 !== undefined ? you(`${fmt.int(mm.military_by_8)} · ${fmt.int(mm.military_by_12)}`) : null),
      el('dt', {}, 'Town Centers'), el('dd', {}, fmt.dec(m.tcs, 1), o.second_tc_rate ? el('span', { class: 'muted' }, ` · 2nd TC in ${o.second_tc_rate}%${o.second_tc_time ? ` at ${fmt.duration(o.second_tc_time)}` : ''}`) : el('span', { class: 'muted' }, ' · never a 2nd TC')),
      el('dt', {}, 'First military'), el('dd', {}, top(o.first_military_unit, 2), o.first_military_time ? el('span', { class: 'muted' }, ` · ${fmt.duration(o.first_military_time)}`) : null),
      el('dt', {}, 'First military building'), el('dd', {}, top(o.first_military_building, 2), o.first_military_building_time ? el('span', { class: 'muted' }, ` · ${fmt.duration(o.first_military_building_time)}`) : null),
      el('dt', {}, 'Feudal via'), el('dd', {}, top(o.feudal_landmark, 2)),
      el('dt', {}, 'Castle via'), el('dd', {}, top(o.castle_landmark, 2)),
      el('dt', {}, 'Military share of spend'), el('dd', {}, fmt.pct(m.mil_share, 0), you(mm.mil_share, v => fmt.pct(v, 0))),
      el('dt', {}, 'APM (replay)'), el('dd', {}, fmt.int(m.apm), you(mm.apm, fmt.int))));
    const mix = d.unit_mix || [];
    if (mix.length) {
      numbers.append(el('div', { class: 'cap', style: { marginTop: '12px' } }, 'Army mix · all military queued'),
        el('div', { class: 'mixbar' }, mix.map((u, i) => bindTooltip(el('span', { style: { width: `${u.pct}%`, background: `var(${CHART_SERIES[i % CHART_SERIES.length]})` }, tabindex: 0 }), () => ttRows(u.unit, [{ label: 'share of military queued', value: `${u.pct}%` }, { label: 'units over analysed games', value: String(u.count) }])))),
        el('div', { class: 'legend', style: { marginTop: '4px' } }, mix.slice(0, 5).map((u, i) => el('span', { class: 'key' }, el('i', { class: 'rect', style: { '--c': `var(${CHART_SERIES[i % CHART_SERIES.length]})` } }), `${u.unit} ${u.pct}%`))));
    }
    const collapse = ev => { const out = []; for (const e of ev) { const last = out.at(-1); if (last && last.name === e.name && last.k === e.k) last.n++; else out.push({ ...e, n: 1 }); } return out; };
    const SHOW = 4;
    const gameRows = (d.games || []).map((g, i) => el('div', { class: 'civ-game', hidden: i >= SHOW ? true : null },
        el('div', { class: 'row small' }, resultPill(g.result), el('strong', {}, g.map || '—'), civ ? null : civChip(g.civ, { name: 'short' }), el('span', { class: 'muted' }, fmt.date(g.started_at)), el('span', { class: 'muted' }, `· ${fmt.duration(g.duration)}`),
          g.feudal ? el('span', { class: 'muted' }, `· Feudal ${fmt.duration(g.feudal)}`) : null, g.castle ? el('span', { class: 'muted' }, `· Castle ${fmt.duration(g.castle)}`) : null,
          g.dark_age_military?.count ? el('span', { class: 'muted', title: Object.entries(g.dark_age_military.units || {}).map(([k, v]) => `${v} ${k}`).join(', ') }, `· ${g.dark_age_military.count} Dark Age military`) : null,
          g.first_military ? el('span', { class: 'muted' }, `· ${g.first_military.name} ${fmt.duration(g.first_military.time)}`) : null,
          g.tcs > 1 ? el('span', { class: 'muted' }, `· ${g.tcs} TCs`) : null,
          el('span', { class: 'spacer' }), el('a', { class: 'small', href: hrefTo(`/game/${g.game_id}`, { p: pid }) }, 'Summary ›')),
        el('div', { class: 'bo-line' }, collapse((g.opening || []).slice(0, 12)).map(e => el('span', { class: `bo-chip ${e.k}`, title: `${fmt.duration(e.t)} ${e.name}` }, el('span', { class: 'muted num' }, fmt.duration(e.t)), ' ', e.name, e.n > 1 ? el('span', { class: 'muted' }, ` ×${e.n}`) : null)))));
    games.append(el('div', { class: 'cap', style: { marginTop: '14px' } }, `Each game${civ ? ` as ${civShort(civ)}` : ''} · first buildings and technologies in order`), el('div', { class: 'civ-games' }, gameRows));
    const actions = el('div', { class: 'intel-actions' });
    if (gameRows.length > SHOW) actions.append(el('button', { class: 'btn sm ghost', type: 'button', onClick: e => { gameRows.forEach(r => { r.hidden = false; }); e.target.remove(); } }, `Show all ${gameRows.length} games`));
    if (d.pending || d.rate_limited) actions.append(moreBtn(d));
    actions.append(el('span', { class: 'muted small' }, 'Counts come from the command log, so queued units include cancellations and age-up times are landmark placements. The official store keeps replays for a limited time.'));
    games.append(actions);
  }
  load();
  return box;
}
