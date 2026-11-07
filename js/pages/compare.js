import { el, fmt, setTitle, hrefTo, navigate, clear, groupBy, winRate, mean, countryName } from '../util.js';
import { api, fetchPlayerGames } from '../api.js';
import { searchBox, avatarImg, countryFlag, rankBadge, modeTabs, civChip, dataTable, gameRow, card, notice, skeleton, errorBox, emptyState, wrCell, playerLink, flattenTeams, statTile } from '../components.js';
import { lineChart } from '../charts.js';
import { MODE, PROFILE_MODES, modeName, civName, parseRankLevel } from '../constants.js';
import { fillAsync, ratingHistoryPoints, modesWithData, gamesFilterFor, pageHead } from './_shared.js';

export async function render(app, route) {
  const a = route.parts[1], b = route.parts[2];
  setTitle('Compare players');
  if (!a || !b) return renderPicker(app, a);

  const holder = el('div'); app.append(holder); holder.append(skeleton(6, { height: 22 }));
  let A, B;
  try { [A, B] = await Promise.all([api.player(a), api.player(b)]); }
  catch (e) { clear(holder); holder.append(errorBox(e, () => render(app, route))); return; }
  clear(holder);
  setTitle(`${A.name} vs ${B.name}`);
  if (A.profile_id === B.profile_id) { holder.append(notice('Pick two different players.'), el('p', {}, el('a', { class: 'btn', href: '#/compare' }, 'Choose players'))); return; }

  // Mode: must exist for at least one of them.
  const modesA = new Set(modesWithData(A).map(m => m.key)), modesB = new Set(modesWithData(B).map(m => m.key));
  const modes = PROFILE_MODES.filter(m => modesA.has(m.key) || modesB.has(m.key));
  const both = modes.filter(m => modesA.has(m.key) && modesB.has(m.key));
  const modeKey = MODE[route.query.mode] ? route.query.mode : (both[0]?.key ?? modes[0]?.key ?? 'rm_solo');
  const mA = A.modes?.[modeKey] || {}, mB = B.modes?.[modeKey] || {};

  holder.append(pageHead('Compare', `${modeName(modeKey)} · side by side`, el('a', { class: 'btn', href: hrefTo(`/compare/${a}`) }, 'Change opponent')));
  const head = p => el('div', { class: 'card compare-head' }, avatarImg(p, 'avatar-lg', 'medium'),
    el('div', { style: { minWidth: 0 } }, el('h2', {}, el('span', { class: 'swatch', style: { background: p === A ? 'var(--s1)' : 'var(--s2)' } }), el('a', { href: hrefTo(`/player/${p.profile_id}`), style: { color: 'var(--ink)' } }, p.name), countryFlag(p.country)),
      el('div', { class: 'muted small' }, countryName(p.country), ' · profile #', String(p.profile_id))));
  holder.append(el('div', { class: 'compare-heads' }, head(A), head(B)));
  holder.append(el('div', { class: 'mode-tabs' }, modeTabs(modes.filter(m => !m.hidden), modeKey, k => hrefTo(`/compare/${a}/${b}`, { mode: k })),
    modes.some(m => m.hidden) ? el('span', { class: 'muted' }, '· hidden ELO:') : null,
    modes.some(m => m.hidden) ? modeTabs(modes.filter(m => m.hidden), modeKey, k => hrefTo(`/compare/${a}/${b}`, { mode: k })) : null));

  /* ----- metric table ----- */
  const metrics = [
    { label: 'Rating', get: m => m.rating, fmt: fmt.int, higher: true },
    { label: 'Peak rating', get: m => m.max_rating, fmt: fmt.int, higher: true },
    { label: '30-day peak', get: m => m.max_rating_1m, fmt: fmt.int, higher: true },
    { label: 'Rank', get: m => m.rank, fmt: v => v ? `#${fmt.int(v)}` : '—', higher: false },
    { label: 'Rank level', get: m => m.rank_level, render: v => v ? rankBadge(v, { sm: true }) : '—', cmp: v => { const r = parseRankLevel(v); return r.tier === 'unranked' ? -1 : ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'conqueror'].indexOf(r.tier) * 10 + r.div; }, higher: true },
    { label: 'Win rate', get: m => m.win_rate, fmt: v => fmt.pct(v, 1), higher: true },
    { label: 'Wins – losses', get: m => m.wins_count, fmt: (v, m) => `${fmt.int(m.wins_count)} – ${fmt.int(m.losses_count)}`, higher: true },
    { label: 'Games', get: m => m.games_count, fmt: fmt.int, higher: true },
    { label: 'Current streak', get: m => m.streak, fmt: v => v > 0 ? `+${v}` : String(v ?? '—'), higher: true },
    { label: 'Drops', get: m => m.drops_count, fmt: fmt.int, higher: false },
    { label: 'Civ pool (season)', get: m => (m.civilizations || []).length || null, fmt: fmt.int, higher: true },
    { label: 'Most played civ', get: m => [...(m.civilizations || [])].sort((x, y) => y.games_count - x.games_count)[0]?.civilization, render: v => v ? civChip(v) : '—', cmp: null },
    { label: 'Last game', get: m => m.last_game_at ? new Date(m.last_game_at).getTime() : null, fmt: v => v ? fmt.rel(v) : '—', higher: true },
  ];
  const cell = (met, m, other) => {
    const v = met.get(m), o = met.get(other);
    const cv = met.cmp === null ? null : met.cmp ? met.cmp(v) : v, co = met.cmp === null ? null : met.cmp ? met.cmp(o) : o;
    const better = cv !== null && co !== null && cv !== undefined && co !== undefined && cv !== co && ((cv > co) === !!met.higher);
    const content = met.render ? met.render(v, m) : met.fmt(v, m);
    return el('span', { class: better ? 'better' : '' }, content instanceof Node ? content : String(content ?? '—'));
  };
  const table = el('table', { class: 'data compare' },
    el('thead', {}, el('tr', {}, el('th', { class: 'metric' }, 'Metric'), el('th', { class: 'center' }, A.name), el('th', { class: 'center' }, B.name))),
    el('tbody', {}, metrics.map(met => el('tr', {}, el('td', { class: 'metric' }, met.label), el('td', { class: 'a' }, cell(met, mA, mB)), el('td', { class: 'b' }, cell(met, mB, mA))))));

  /* ----- rating chart ----- */
  const pA = ratingHistoryPoints(mA), pB = ratingHistoryPoints(mB);
  const chart = lineChart({ series: [{ name: A.name, color: '--s1', points: pA }, { name: B.name, color: '--s2', points: pB }], height: 280, emptyText: 'Rating history is not available for this mode.' });

  holder.append(el('div', { class: 'grid cols-2', style: { marginTop: '16px' } },
    card('Rating history', chart, { meta: MODE[modeKey]?.ranked && !MODE[modeKey]?.hidden ? 'season to date' : 'all time' }),
    card(`${modeName(modeKey)} at a glance`, el('div', { class: 'table-wrap' }, table), { flush: true })));

  /* ----- civ pools ----- */
  const civsA = new Map((mA.civilizations || []).map(c => [c.civilization, c])), civsB = new Map((mB.civilizations || []).map(c => [c.civilization, c]));
  const allCivs = [...new Set([...civsA.keys(), ...civsB.keys()])].sort((x, y) => ((civsB.get(y)?.games_count || 0) + (civsA.get(y)?.games_count || 0)) - ((civsB.get(x)?.games_count || 0) + (civsA.get(x)?.games_count || 0))).slice(0, 12);
  if (allCivs.length) {
    const maxPick = Math.max(...allCivs.flatMap(c => [civsA.get(c)?.pick_rate || 0, civsB.get(c)?.pick_rate || 0]), 1);
    const db = el('div', { class: 'dumbbell' });
    for (const c of allCivs) {
      const xa = (civsA.get(c)?.pick_rate || 0) / maxPick * 100, xb = (civsB.get(c)?.pick_rate || 0) / maxPick * 100;
      const track = el('div', { class: 'track', title: `${civName(c)} — ${A.name}: ${fmt.pct(civsA.get(c)?.pick_rate ?? 0)} picks, ${fmt.pct(civsA.get(c)?.win_rate)} wins · ${B.name}: ${fmt.pct(civsB.get(c)?.pick_rate ?? 0)} picks, ${fmt.pct(civsB.get(c)?.win_rate)} wins` },
        el('span', { class: 'axis' }),
        el('span', { class: 'link', style: { left: `${Math.min(xa, xb)}%`, width: `${Math.abs(xa - xb)}%` } }),
        civsA.has(c) ? el('span', { class: 'dot', style: { left: `${xa}%`, background: 'var(--s1)' } }) : null,
        civsB.has(c) ? el('span', { class: 'dot', style: { left: `${xb}%`, background: 'var(--s2)' } }) : null);
      db.append(civChip(c), track);
    }
    const civTable = dataTable({ columns: [
      { key: 'civ', label: 'Civilization', render: r => civChip(r.civ), sortValue: r => civName(r.civ) },
      { key: 'ga', label: `${A.name} games`, num: true, render: r => fmt.int(r.ga) },
      { key: 'wa', label: `${A.name} win %`, num: true, render: r => r.ga ? wrCell(r.wa) : el('span', { class: 'muted' }, '—') },
      { key: 'gb', label: `${B.name} games`, num: true, render: r => fmt.int(r.gb) },
      { key: 'wb', label: `${B.name} win %`, num: true, render: r => r.gb ? wrCell(r.wb) : el('span', { class: 'muted' }, '—') },
    ], rows: allCivs.map(c => ({ civ: c, ga: civsA.get(c)?.games_count || 0, wa: civsA.get(c)?.win_rate ?? null, gb: civsB.get(c)?.games_count || 0, wb: civsB.get(c)?.win_rate ?? null })), sort: { key: 'ga', dir: 'desc' } });
    holder.append(el('div', { class: 'grid cols-2', style: { marginTop: '16px' } },
      card('Civilization pools', el('div', {}, db, el('div', { class: 'legend' }, el('span', { class: 'key' }, el('i', { class: 'rect', style: { '--c': 'var(--s1)' } }), A.name), el('span', { class: 'key' }, el('i', { class: 'rect', style: { '--c': 'var(--s2)' } }), B.name), el('span', { class: 'muted' }, '· dot position = pick rate, scaled to the most-picked civ'))), { meta: 'top 12 by combined games' }),
      card('Win rates by civ', civTable, { flush: true })));
  }

  /* ----- head to head ----- */
  const h2hBox = el('div');
  holder.append(el('div', { style: { marginTop: '16px' } }, card('Head to head', h2hBox, { meta: 'all modes, up to 150 most recent meetings' })));
  fillAsync(h2hBox, () => fetchPlayerGames(a, { opponent_profile_id: b, limit: 50 }, 3), ({ games, total }) => {
    const finished = games.filter(g => !g.ongoing);
    if (!finished.length) return emptyState(`${A.name} and ${B.name} have not played each other on record.`);
    const meA = g => flattenTeams(g).flat().find(p => p.profile_id === A.profile_id);
    const wA = finished.filter(g => meA(g)?.result === 'win').length, wB = finished.filter(g => meA(g)?.result === 'loss').length;
    const frag = document.createDocumentFragment();
    frag.append(el('div', { class: 'h2h', style: { marginBottom: '16px' } },
      el('div', {}, el('div', { class: 'big', style: { color: 'var(--ink)' } }, String(wA)), el('div', { class: 'muted' }, A.name, ' wins')),
      el('div', { class: 'mid' }, el('div', { style: { fontSize: '22px', fontWeight: 700 } }, `${finished.length} games`), el('div', { class: 'small' }, `${fmt.int(total)} on record · last ${fmt.rel(finished[0].started_at)}`), el('div', { class: 'small' }, `avg length ${fmt.duration(mean(finished.map(g => g.duration).filter(Number.isFinite)))}`)),
      el('div', {}, el('div', { class: 'big' }, String(wB)), el('div', { class: 'muted' }, B.name, ' wins'))));
    const rec = arr => { const w = arr.filter(g => meA(g)?.result === 'win').length; return { w, l: arr.length - w, n: arr.length, wr: winRate(w, arr.length - w) }; };
    const byMap = [...groupBy(finished, g => g.map || 'Unknown')].map(([label, arr]) => ({ label, ...rec(arr) }));
    const meB = g => flattenTeams(g).flat().find(p => p.profile_id === B.profile_id);
    const byMatchup = [...groupBy(finished, g => `${meA(g)?.civilization}|${meB(g)?.civilization}`)].map(([k, arr]) => ({ label: k, civA: k.split('|')[0], civB: k.split('|')[1], ...rec(arr) }));
    const cols = (label, render) => [
      { key: 'label', label, render, sortValue: r => r.label },
      { key: 'n', label: 'Games', num: true, render: r => fmt.int(r.n) },
      { key: 'wr', label: `${A.name} win %`, num: true, render: r => wrCell(r.wr, { w: r.w, l: r.l }) },
      { key: 'w', label: 'W – L', num: true, render: r => `${r.w} – ${r.l}` }];
    frag.append(el('div', { class: 'grid cols-2', style: { marginBottom: '16px' } },
      card('By map', dataTable({ columns: cols('Map', r => r.label), rows: byMap, sort: { key: 'n', dir: 'desc' } }), { level: 3, flush: true }),
      card('By civilization matchup', dataTable({ columns: cols('Matchup', r => el('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, civChip(r.civA, { name: 'short' }), el('span', { class: 'muted small' }, 'vs'), civChip(r.civB, { name: 'short' }))), rows: byMatchup, sort: { key: 'n', dir: 'desc' } }), { level: 3, flush: true })));
    frag.append(el('h3', { style: { margin: '0 0 8px' } }, 'Meetings'), el('div', { class: 'game-list card flush' }, finished.slice(0, 50).map(g => gameRow(g, { perspectiveId: A.profile_id }))));
    return frag;
  }, { lines: 8 });
}

/* ----- picker ----- */
async function renderPicker(app, presetId) {
  app.append(pageHead('Compare players', 'Pick two players to see ratings, civ pools and their head-to-head record side by side.'));
  const chosen = [null, null];
  const slots = [el('div'), el('div')];
  const cta = el('a', { class: 'btn primary', href: '#', 'aria-disabled': 'true', style: { opacity: .5, pointerEvents: 'none' } }, 'Compare');
  const update = () => {
    const ok = chosen[0] && chosen[1];
    cta.href = ok ? hrefTo(`/compare/${chosen[0].profile_id}/${chosen[1].profile_id}`) : '#';
    cta.style.opacity = ok ? 1 : .5; cta.style.pointerEvents = ok ? 'auto' : 'none'; cta.setAttribute('aria-disabled', String(!ok));
  };
  const slot = i => {
    const box = slots[i]; clear(box);
    if (chosen[i]) {
      const p = chosen[i];
      box.append(el('div', { class: 'card compare-head' }, avatarImg(p, 'avatar-lg', 'medium'), el('div', {}, el('h2', {}, p.name, countryFlag(p.country)), el('div', { class: 'muted small' }, countryName(p.country))),
        el('button', { class: 'btn sm ghost', type: 'button', style: { marginLeft: 'auto' }, onClick: () => { chosen[i] = null; slot(i); update(); } }, 'Change')));
    } else {
      box.append(el('div', { class: 'card' }, el('h3', { style: { marginBottom: '10px' } }, i === 0 ? 'Player one' : 'Player two'), searchBox({ large: true, placeholder: 'Search by name…', onPick: p => { chosen[i] = p; slot(i); update(); }, autofocus: i === 0 && !presetId })));
    }
  };
  app.append(el('div', { class: 'compare-pick' }, slots[0], el('div', { class: 'vs' }, 'VS'), slots[1]), el('div', { class: 'center', style: { marginTop: '18px' } }, cta));
  slot(0); slot(1); update();
  if (presetId) {
    try { chosen[0] = await api.player(presetId); slot(0); update(); slots[1].querySelector('input')?.focus(); } catch { /* ignore */ }
  }
}
