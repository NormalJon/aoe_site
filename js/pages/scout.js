// Scout: paste a lobby (up to 8 names, two teams) or open it from a live game → ratings, form, civ pools,
// playstyle tags, team averages and which side is favoured. Pick the civ each player is on this game and the
// companion pulls that player's recent replays as that civ: openings, first military, army mix, per-game builds.
import { el, fmt, setTitle, hrefTo, navigate, clear, mean } from '../util.js';
import { api, getJSON } from '../api.js';
import { playerLink, civChip, rankBadge, select, card, skeleton, errorBox, emptyState, bindTooltip, ttRows, statTile, streakEl, resultPill, barList } from '../components.js';
import { LEADERBOARDS, civName, civShort, CIVS, CHART_SERIES } from '../constants.js';
import { pageHead, companionHint } from './_shared.js';

const MODES = LEADERBOARDS.map(l => ({ value: l.key, label: l.name }));
const lines = s => s.split(/\n/).map(x => x.trim()).filter(Boolean).slice(0, 4);
const civPick = new Map();   // profile id -> civ chosen for this game (mirrored into the URL's `c` param)

export async function render(app, route) {
  setTitle('Scout a lobby');
  const q = route.query;
  const mode = LEADERBOARDS.some(l => l.key === q.mode) ? q.mode : 'rm_team';
  civPick.clear();
  for (const part of (q.c || '').split(',')) { const [pid, civ] = part.split(':'); if (pid && CIVS[civ]) civPick.set(pid, civ); }
  app.append(pageHead('Scout', 'Paste the names from a lobby or loading screen — one per line, two teams — and see who you are up against: ratings, recent form, civ pools and playstyle tags. Pick the civ each player is on and their recent builds with it are pulled from replays.'));

  const taA = el('textarea', { rows: 5, placeholder: 'Team 1 — one name per line', 'aria-label': 'Team 1 names' }, (q.a_names || '').split(',').filter(Boolean).join('\n'));
  const taB = el('textarea', { rows: 5, placeholder: 'Team 2 — one name per line', 'aria-label': 'Team 2 names' }, (q.b_names || '').split(',').filter(Boolean).join('\n'));
  const go = () => navigate('/scout', { mode, a_names: lines(taA.value).join(',') || undefined, b_names: lines(taB.value).join(',') || undefined });
  app.append(el('div', { class: 'scout-input grid cols-2' }, card('Team 1', taA, { level: 3 }), card('Team 2', taB, { level: 3 })),
    el('div', { class: 'filters', style: { margin: '12px 0 18px' } },
      el('label', {}, 'Ladder ', select(MODES, mode, v => navigate('/scout', { ...q, mode: v }))),
      el('button', { class: 'btn primary', type: 'button', onClick: go }, 'Scout'),
      el('span', { class: 'muted small' }, 'Names are matched exactly first, then by best rating; ids from a live game are used as-is.')));

  const results = el('div'); app.append(results);
  const idsA = (q.a || '').split(',').filter(x => /^\d+$/.test(x)), idsB = (q.b || '').split(',').filter(x => /^\d+$/.test(x));
  const namesA = lines((q.a_names || '').replace(/,/g, '\n')), namesB = lines((q.b_names || '').replace(/,/g, '\n'));
  if (!idsA.length && !idsB.length && !namesA.length && !namesB.length) { results.append(emptyState('Enter some names to scout, or pick a live game from the Live page.')); return; }
  results.append(skeleton(8));
  try {
    const [teamA, teamB] = await Promise.all([resolveTeam(idsA, namesA, mode), resolveTeam(idsB, namesB, mode)]);
    clear(results);
    renderResults(results, teamA, teamB, mode, route);
  } catch (e) { clear(results); results.append(errorBox(e)); }
}

async function resolveTeam(ids, names, mode) {
  const found = [];
  for (const id of ids) found.push({ query: id, player: await api.player(id).catch(() => null) });
  for (const name of names) {
    let player = null;
    try {
      const d = await api.searchPlayers(name);
      const ql = name.toLowerCase();
      const cands = (d.players || []).slice().sort((a, b) => {
        const ea = a.name?.toLowerCase() === ql ? 1 : 0, eb = b.name?.toLowerCase() === ql ? 1 : 0;
        if (ea !== eb) return eb - ea;
        return (b.leaderboards?.[mode]?.rating || 0) - (a.leaderboards?.[mode]?.rating || 0);
      });
      if (cands[0]) player = await api.player(cands[0].profile_id);
    } catch { player = null; }
    found.push({ query: name, player });
  }
  return found;
}

function syncUrl(route) {
  const q = { ...route.query, c: [...civPick].map(([pid, civ]) => `${pid}:${civ}`).join(',') || undefined };
  const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  history.replaceState(null, '', `#/scout?${p}`);   // keep the picks shareable without re-rendering the page
}

function renderResults(box, teamA, teamB, mode, route) {
  const m = p => p?.modes?.[mode] || {};
  const avg = team => mean(team.map(x => m(x.player).rating).filter(Number.isFinite));
  const rA = avg(teamA), rB = avg(teamB);
  const bothTeams = teamA.some(x => x.player) && teamB.some(x => x.player);
  const pA = rA !== null && rB !== null ? 1 / (1 + Math.pow(10, (rB - rA) / 400)) : null;   // Elo expectation from average ratings
  if (bothTeams) {
    box.append(el('div', { class: 'tiles', style: { marginBottom: '16px' } },
      statTile({ label: 'Team 1 average rating', value: fmt.int(rA), sub: `${teamA.filter(x => x.player).length} players found` }),
      statTile({ label: 'Team 2 average rating', value: fmt.int(rB), sub: `${teamB.filter(x => x.player).length} players found` }),
      statTile({ label: 'Favoured', value: pA === null ? '—' : pA >= 0.5 ? 'Team 1' : 'Team 2', sub: pA === null ? 'no ratings' : `${fmt.pct(100 * Math.max(pA, 1 - pA), 0)} by the Elo formula on average ratings` }),
      statTile({ label: 'Rating gap', value: rA !== null && rB !== null ? fmt.signed(Math.round(rA - rB)) : '—', sub: 'Team 1 minus Team 2' })));
  }
  const grid = el('div', { class: 'grid cols-2' });
  grid.append(teamCard('Team 1', teamA, mode, route), teamCard('Team 2', teamB, mode, route));
  box.append(grid);
  box.append(el('p', { class: 'muted small', style: { marginTop: '12px' } }, 'Ratings, ranks, win rates and civ pools come from AoE4 World for the selected ladder. Playstyle tags and the per-civ build scouting are computed from each player’s recent replays by the local companion and appear when it is running.'));
}

function teamCard(title, team, mode, route) {
  const rows = team.map(x => {
    const p = x.player; const md = p?.modes?.[mode] || {};
    const civs = [...(md.civilizations || [])].sort((a, b) => b.games_count - a.games_count);
    return el('div', { class: 'scout-row' },
      el('div', { class: 'top' }, p ? playerLink(p) : el('span', { class: 'muted' }, `${x.query} — not found`), p ? el('a', { class: 'small', href: hrefTo(`/player/${p.profile_id}`, { mode }) }, 'profile') : null),
      p ? el('div', { class: 'stats' },
        el('span', { class: 'num big' }, fmt.int(md.rating)), md.rank_level ? rankBadge(md.rank_level, { sm: true, rank: md.rank }) : (md.rank ? el('span', { class: 'muted small' }, `#${fmt.int(md.rank)}`) : el('span', { class: 'muted small' }, 'unrated here')),
        md.games_count ? el('span', { class: 'small' }, `${fmt.pct(md.win_rate, 0)} over ${fmt.int(md.games_count)} games`) : null,
        md.streak ? streakEl(md.streak) : null,
        md.max_rating ? el('span', { class: 'muted small', title: 'peak rating' }, `peak ${fmt.int(md.max_rating)}`) : null) : null,
      p && civs.length ? el('div', { class: 'civs' }, civs.slice(0, 3).map(c => bindTooltip(el('span', { class: 'civpick', tabindex: 0 }, civChip(c.civilization, { name: 'short' }), el('span', { class: 'muted small' }, ` ${fmt.pct(c.pick_rate, 0)}`)), () => ttRows(civName(c.civilization), [{ label: 'pick rate', value: fmt.pct(c.pick_rate, 0) }, { label: 'win rate', value: fmt.pct(c.win_rate, 0) }, { label: 'games', value: String(c.games_count) }])))) : null,
      p ? playstyleLine(p.profile_id) : null,
      p ? civScout(p, civs, route) : null);
  });
  return card(title, rows.length ? el('div', { class: 'scout-list' }, rows) : emptyState('No players on this side.'), { level: 3 });
}

/** Async line of playstyle tags from the companion (quiet when unavailable). */
function playstyleLine(pid) {
  const line = el('div', { class: 'tags small', style: { minHeight: '18px' } }, el('span', { class: 'muted small' }, 'playstyle…'));
  getJSON(`local/profile/${pid}?n=6&budget=8`, { ttl: 10 * 60e3 }).then(d => {
    clear(line);
    const tags = (d.tags || []).filter(t => t.pct >= 30).slice(0, 5);
    if (!d.analysed) { line.append(el('span', { class: 'muted small' }, d.rate_limited ? 'replay store rate-limited, try again shortly' : 'no replays analysed yet')); return; }
    line.append(el('span', { class: 'muted small' }, `${d.analysed} replays: `), ...tags.map(t => bindTooltip(el('span', { class: 'tag', tabindex: 0 }, `${t.label} ${t.pct}%`), () => ttRows(t.label, [{ label: 'in', value: `${t.count} of ${d.analysed} analysed games` }]))));
    if (!tags.length) line.append(el('span', { class: 'muted small' }, 'no dominant pattern'));
    const med = d.medians || {};
    const bits = [med.villagers_by_10 ? `${fmt.int(med.villagers_by_10)} vills by 10:00` : null, med.feudal ? `feudal ${fmt.duration(med.feudal)}` : null, med.military_by_8 !== null && med.military_by_8 !== undefined ? `${fmt.int(med.military_by_8)} military by 8:00` : null].filter(Boolean);
    if (bits.length) line.append(el('span', { class: 'muted small' }, ` · ${bits.join(' · ')}`));
  }).catch(() => { clear(line); });
  return line;
}

/* ---------- civ this game → builds from replays ---------- */
function civScout(p, civs, route) {
  const pid = String(p.profile_id);
  const played = civs.map(c => c.civilization);
  const sel = el('select', { 'aria-label': `Civilization ${p.name} is playing this game`, onChange: e => { const v = e.target.value; if (v) civPick.set(pid, v); else civPick.delete(pid); syncUrl(route); drawPanel(); } });
  sel.append(el('option', { value: '' }, 'Civ this game…'));
  if (played.length) {
    const g1 = el('optgroup', { label: 'Their ladder picks' });
    for (const c of civs) g1.append(el('option', { value: c.civilization }, `${civName(c.civilization)} · ${fmt.pct(c.pick_rate, 0)} of games`));
    sel.append(g1);
  }
  const g2 = el('optgroup', { label: played.length ? 'Other civilizations' : 'Civilizations' });
  for (const c of Object.keys(CIVS).filter(c => !played.includes(c))) g2.append(el('option', { value: c }, civName(c)));
  sel.append(g2);
  sel.value = civPick.get(pid) || '';
  const panel = el('div', { class: 'civ-scout' });
  const wrap = el('div', { class: 'civ-scout-wrap' }, el('div', { class: 'row' }, el('span', { class: 'muted small' }, 'This game:'), sel), panel);
  let want = 6;
  function drawPanel(force = false) {
    const civ = civPick.get(pid);
    clear(panel);
    if (!civ) return;
    panel.append(el('div', { class: 'muted small' }, `Pulling ${p.name}'s recent ${civName(civ)} replays from the official store…`), skeleton(3));
    getJSON(`local/profile/${pid}?civ=${civ}&n=${want}&budget=15`, { ttl: 10 * 60e3, force }).then(d => { if (!panel.isConnected) return; clear(panel); panel.append(civPanel(p, civ, d, () => { want = d.analysed + 6; drawPanel(true); })); })
      .catch(e => { clear(panel); panel.append(el('p', { class: 'muted small', style: { margin: 0 } }, e?.status === 404 || !e?.status ? ['Build scouting needs the companion server. ', ...companionHint()] : String(e.message || e))); });
  }
  drawPanel();
  return wrap;
}

function civPanel(p, civ, d, more) {
  const o = d.openings || {};
  const head = el('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } },
    el('span', {}, civChip(civ, { name: 'short' }), ' ', el('strong', {}, `${d.analysed} game${d.analysed === 1 ? '' : 's'}`), el('span', { class: 'muted small' }, ` analysed of ${d.candidates} on record · `), d.analysed ? el('span', { class: 'num small' }, `${d.wins}W – ${d.losses}L`) : null),
    (d.pending || d.rate_limited) ? el('button', { class: 'btn sm', type: 'button', onClick: more }, d.rate_limited ? 'Store rate-limited — retry' : `Analyse ${Math.min(6, d.pending)} more`) : null);
  if (!d.analysed) return el('div', {}, head, el('p', { class: 'muted small', style: { margin: '6px 0 0' } }, d.candidates ? (d.rate_limited ? 'The official replay store is rate-limiting downloads; try again in a minute.' : 'No replays could be fetched for these games yet.') : `No ${civName(civ)} games among this player's last ${fmt.int(d.games_scanned || 0)} games on record (the ladder civ list covers the whole season).`));
  const list = (items, n = 3) => items.length ? items.slice(0, n).map((x, i) => [i ? ', ' : '', el('strong', {}, x.name), el('span', { class: 'muted' }, ` ${x.games}/${d.analysed}`)]) : el('span', { class: 'muted' }, '—');
  const facts = el('dl', { class: 'kv' },
    el('dt', {}, 'Feudal via'), el('dd', {}, list(o.feudal_landmark || [])),
    el('dt', {}, 'Castle via'), el('dd', {}, list(o.castle_landmark || [])),
    el('dt', {}, 'First military'), el('dd', {}, list(o.first_military_unit || [], 2), o.first_military_time ? el('span', { class: 'muted' }, ` · median ${fmt.duration(o.first_military_time)}`) : null),
    el('dt', {}, 'First military building'), el('dd', {}, list(o.first_military_building || [], 2), o.first_military_building_time ? el('span', { class: 'muted' }, ` · ${fmt.duration(o.first_military_building_time)}`) : null),
    el('dt', {}, '2nd Town Center'), el('dd', {}, o.second_tc_rate ? `${o.second_tc_rate}% of games${o.second_tc_time ? ` · median ${fmt.duration(o.second_tc_time)}` : ''}` : 'never in these games'),
    el('dt', {}, 'Feudal · Castle time'), el('dd', {}, `${fmt.duration(d.medians?.feudal)} · ${fmt.duration(d.medians?.castle)}`),
    el('dt', {}, 'Villagers by 10:00'), el('dd', {}, d.medians?.villagers_by_10 === null || d.medians?.villagers_by_10 === undefined ? '—' : fmt.int(d.medians.villagers_by_10)));
  const mix = d.unit_mix || [];
  const mixBar = mix.length ? el('div', {}, el('div', { style: { display: 'flex', gap: '2px', height: '12px', borderRadius: '4px', overflow: 'hidden' } }, mix.map((u, i) => bindTooltip(el('span', { style: { width: `${u.pct}%`, background: `var(${CHART_SERIES[i % CHART_SERIES.length]})`, display: 'block', minWidth: '2px' }, tabindex: 0 }), () => ttRows(u.unit, [{ label: 'share of military queued', value: `${u.pct}%` }, { label: 'units over analysed games', value: String(u.count) }])))),
    el('div', { class: 'legend', style: { marginTop: '6px' } }, mix.slice(0, 6).map((u, i) => el('span', { class: 'key' }, el('i', { class: 'rect', style: { '--c': `var(${CHART_SERIES[i % CHART_SERIES.length]})` } }), `${u.unit} ${u.pct}%`)))) : emptyState('No military queued in these games.');
  const early = (d.early_buildings || []).filter(b => b.per_game >= 0.3).slice(0, 8);
  const tags = (d.tags || []).filter(t => t.pct >= 30).slice(0, 6);
  const grid = el('div', { class: 'grid cols-2', style: { gap: '12px', marginTop: '8px' } },
    el('div', {}, el('div', { class: 'cap' }, 'Opening'), facts, early.length ? [el('div', { class: 'cap', style: { marginTop: '8px' } }, 'Buildings in the first 5 minutes · per game'), barList(early.map(b => ({ label: b.name, value: b.per_game, display: fmt.dec(b.per_game, 1) })))] : null),
    el('div', {}, el('div', { class: 'cap' }, 'Army mix · all military queued'), mixBar, tags.length ? [el('div', { class: 'cap', style: { marginTop: '8px' } }, `Tendencies as ${civShort(civ)}`), el('div', { class: 'tags' }, tags.map(t => bindTooltip(el('span', { class: 'tag', tabindex: 0 }, `${t.label} ${t.pct}%`), () => ttRows(t.label, [{ label: 'in', value: `${t.count} of ${d.analysed} games` }]))))] : null));
  // per-game builds
  const collapse = ev => { const out = []; for (const e of ev) { const last = out.at(-1); if (last && last.name === e.name && last.k === e.k) last.n++; else out.push({ ...e, n: 1 }); } return out; };
  const games = el('div', { class: 'civ-games' }, (d.games || []).map(g => el('div', { class: 'civ-game' },
    el('div', { class: 'row small' }, resultPill(g.result), el('strong', {}, g.map || '—'), el('span', { class: 'muted' }, fmt.date(g.started_at)), el('span', { class: 'muted' }, `· ${fmt.duration(g.duration)}`), g.feudal ? el('span', { class: 'muted' }, `· Feudal ${fmt.duration(g.feudal)}`) : null, g.first_military ? el('span', { class: 'muted' }, `· ${g.first_military.name} ${fmt.duration(g.first_military.time)}`) : null, el('span', { class: 'spacer' }), el('a', { class: 'small', href: hrefTo(`/game/${g.game_id}`, { p: p.profile_id }) }, 'Summary ›')),
    el('div', { class: 'bo-line' }, collapse((g.opening || []).slice(0, 14)).map(e => el('span', { class: `bo-chip ${e.k}`, title: `${fmt.duration(e.t)} ${e.name}` }, el('span', { class: 'muted num' }, fmt.duration(e.t)), ' ', e.name, e.n > 1 ? el('span', { class: 'muted' }, ` ×${e.n}`) : null))))));
  return el('div', {}, head, grid, el('div', { class: 'cap', style: { marginTop: '10px' } }, 'Each game · first buildings and technologies in order'), games,
    el('p', { class: 'muted small', style: { margin: '8px 0 0' } }, 'Order counts from replays: queued units include cancellations. Replays come from the official store, which keeps them for a limited time.'));
}
