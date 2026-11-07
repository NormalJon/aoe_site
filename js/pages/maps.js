import { el, fmt, setTitle, hrefTo, navigate, sum } from '../util.js';
import { api } from '../api.js';
import { civChip, dataTable, select, card, statTile, meter, divBar, notice } from '../components.js';
import { STATS_SUPPORT, STATS_LB_NAMES, RANK_LEVEL_FILTERS, RATING_FILTERS, civName } from '../constants.js';
import { fillAsync, pageHead } from './_shared.js';

const MAP_LADDERS = Object.keys(STATS_SUPPORT).filter(k => STATS_SUPPORT[k].maps);

export async function render(app, route) {
  const lb = MAP_LADDERS.includes(route.query.lb) ? route.query.lb : 'rm_solo';
  const support = STATS_SUPPORT[lb];
  const rank = support.rankLevel ? (route.query.rank || '') : '';
  const rating = route.query.rating || '';
  const params = { rank_level: rank || undefined, rating: rating || undefined };
  const mapId = route.parts[1];
  setTitle('Map statistics');
  const base = mapId ? `/maps/${mapId}` : '/maps';
  const go = patch => navigate(base, { lb, rank, rating, ...patch });

  const sub = el('span', {}, 'Which maps are played, how long they run and who wins on them.');
  app.append(pageHead('Maps', sub, mapId ? el('a', { class: 'btn', href: hrefTo('/maps', { lb, rank, rating }) }, '← All maps') : null));
  app.append(el('div', { class: 'filters' },
    el('label', {}, 'Ladder ', select(MAP_LADDERS.map(k => ({ value: k, label: STATS_LB_NAMES[k] })), lb, v => navigate(base, { lb: v, rating }), { ariaLabel: 'Ladder' })),
    support.rankLevel ? el('label', {}, 'Rank bracket ', select(RANK_LEVEL_FILTERS, rank, v => go({ rank: v, rating: '' }), { ariaLabel: 'Rank bracket' })) : null,
    el('label', {}, 'Rating ', select(RATING_FILTERS, rating, v => go({ rating: v, rank: '' }), { ariaLabel: 'Rating bracket' })),
    el('span', { class: 'spacer' }),
    (rank || rating) ? el('a', { class: 'btn sm ghost', href: hrefTo(base, { lb }) }, 'Clear filters') : null));

  if (mapId) return renderMap(app, lb, mapId, params, sub, { rank, rating });

  const tiles = el('div', { class: 'tiles', style: { marginBottom: '16px' } });
  const box = el('div');
  app.append(tiles, card('Map pool', box, { flush: true, meta: 'click a map for per-civilization win rates' }));
  await fillAsync(box, () => api.stats.maps(lb, params), d => {
    const rows = d.data || [];
    const total = sum(rows.map(r => r.games_count));
    sub.replaceChildren(`${STATS_LB_NAMES[lb]} · patch${String(d.patch).includes(',') ? 'es' : ''} ${d.patch}${d.rank_level ? ` · ${d.rank_level}` : ''}${d.rating ? ` · rating ${d.rating}` : ''}`);
    const longest = [...rows].sort((a, b) => b.duration_median - a.duration_median)[0];
    const shortest = [...rows].sort((a, b) => a.duration_median - b.duration_median)[0];
    const most = [...rows].sort((a, b) => b.games_count - a.games_count)[0];
    tiles.replaceChildren(
      statTile({ label: 'Games analysed', value: fmt.compact(total), sub: `${rows.length} maps` }),
      statTile({ label: 'Most played', value: most?.map ?? '—', sub: most ? `${fmt.pct(100 * most.games_count / total)} of games` : null }),
      statTile({ label: 'Longest games', value: longest?.map ?? '—', sub: longest ? `median ${fmt.duration(longest.duration_median)}` : null }),
      statTile({ label: 'Shortest games', value: shortest?.map ?? '—', sub: shortest ? `median ${fmt.duration(shortest.duration_median)}` : null }));
    const maxShare = Math.max(...rows.map(r => r.games_count));
    return dataTable({ columns: [
      { key: 'map', label: 'Map', render: r => el('strong', {}, r.map) },
      { key: 'games_count', label: 'Share of games', num: true, render: r => el('span', { class: 'wr-cell' }, meter(100 * r.games_count / maxShare, { width: 110 }), el('span', { class: 'num' }, fmt.pct(100 * r.games_count / total))) },
      { key: 'games', label: 'Games', num: true, sortValue: r => r.games_count, render: r => fmt.compact(r.games_count) },
      { key: 'duration_median', label: 'Median length', num: true, render: r => fmt.duration(r.duration_median) },
      { key: 'duration_average', label: 'Average length', num: true, render: r => fmt.duration(r.duration_average) },
      { key: 'highest_win_rate_civilization', label: 'Best civ on map', sortValue: r => civName(r.highest_win_rate_civilization), render: r => r.highest_win_rate_civilization ? civChip(r.highest_win_rate_civilization) : '—' },
    ], rows, sort: { key: 'games_count', dir: 'desc' }, rowHref: r => hrefTo(`/maps/${r.map_id}`, { lb, rank, rating }) });
  }, { lines: 20 });
}

async function renderMap(app, lb, mapId, params, sub, q) {
  const tiles = el('div', { class: 'tiles', style: { marginBottom: '16px' } });
  const box = el('div');
  const title = el('h2', {}, 'Map');
  app.append(tiles, el('section', { class: 'card flush' }, el('div', { class: 'card-head' }, title, el('span', { class: 'meta' }, 'civilization performance on this map')), box));
  await fillAsync(box, async () => {
    const [detail, all] = await Promise.all([api.stats.map(lb, mapId, params), api.stats.maps(lb, params)]);
    return { detail, mapRow: (all.data || []).find(m => String(m.map_id) === String(mapId)) };
  }, ({ detail, mapRow }) => {
    const rows = detail.data || [];
    const name = mapRow?.map || detail.map || `Map ${mapId}`;
    setTitle(`${name} · map stats`);
    title.textContent = name;
    sub.replaceChildren(`${STATS_LB_NAMES[lb]} · patch${String(detail.patch).includes(',') ? 'es' : ''} ${detail.patch}${detail.rank_level ? ` · ${detail.rank_level}` : ''}${detail.rating ? ` · rating ${detail.rating}` : ''}`);
    const sorted = [...rows].sort((a, b) => b.win_rate - a.win_rate);
    tiles.replaceChildren(
      statTile({ label: 'Games on this map', value: fmt.compact(mapRow?.games_count ?? sum(rows.map(r => r.games_count)) / 2), sub: mapRow ? `median length ${fmt.duration(mapRow.duration_median)}` : null }),
      sorted[0] ? statTile({ label: 'Best civ here', value: el('span', {}, civChip(sorted[0].civilization, { size: 'lg', name: 'short' })), sub: `${fmt.pct(sorted[0].win_rate)} win rate · ${fmt.compact(sorted[0].games_count)} games` }) : null,
      sorted.at(-1) ? statTile({ label: 'Worst civ here', value: el('span', {}, civChip(sorted.at(-1).civilization, { size: 'lg', name: 'short' })), sub: `${fmt.pct(sorted.at(-1).win_rate)} win rate · ${fmt.compact(sorted.at(-1).games_count)} games` }) : null,
      statTile({ label: 'Win-rate spread', value: sorted.length ? `${(sorted[0].win_rate - sorted.at(-1).win_rate).toFixed(1)} pts` : '—', sub: 'how map-dependent civ balance is' }));
    if (!rows.length) return notice('No per-civilization data for this map in the selected bracket.');
    const hasPick = rows.some(r => r.pick_rate !== null && r.pick_rate !== undefined);
    const maxPick = Math.max(...rows.map(r => r.pick_rate || 0), 1);
    return dataTable({ columns: [
      { key: 'civilization', label: 'Civilization', render: r => civChip(r.civilization), sortValue: r => civName(r.civilization) },
      { key: 'win_rate', label: 'Win rate', num: true, render: r => el('span', { class: 'wr-cell' }, divBar(r.win_rate, { span: 10 }), el('strong', { class: 'num' }, fmt.pct(r.win_rate))) },
      hasPick ? { key: 'pick_rate', label: 'Pick rate', num: true, render: r => el('span', { class: 'wr-cell' }, meter(100 * (r.pick_rate || 0) / maxPick, { width: 70 }), el('span', { class: 'num' }, fmt.pct(r.pick_rate))) } : null,
      { key: 'games_count', label: 'Games', num: true, render: r => fmt.compact(r.games_count) },
      { key: 'duration_median', label: 'Median length', num: true, render: r => fmt.duration(r.duration_median) },
    ].filter(Boolean), rows, sort: { key: 'win_rate', dir: 'desc' } });
  }, { lines: 20 });
}
