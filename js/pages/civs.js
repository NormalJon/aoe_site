import { el, fmt, setTitle, hrefTo, navigate, clear, divergingColor, sum } from '../util.js';
import { api } from '../api.js';
import { civChip, dataTable, select, card, notice, statTile, wrCell, meter, barList, segmented, divBar } from '../components.js';
import { heatmap, scaleLegend } from '../charts.js';
import { STATS_SUPPORT, STATS_LB_NAMES, RANK_LEVEL_FILTERS, RATING_FILTERS, civName, civShort, civFlag, CIVS } from '../constants.js';
import { fillAsync, pageHead } from './_shared.js';

export async function render(app, route) {
  const lb = STATS_SUPPORT[route.query.lb] ? route.query.lb : 'rm_solo';
  const support = STATS_SUPPORT[lb];
  const rank = support.rankLevel ? (route.query.rank || '') : '';
  const rating = route.query.rating || '';
  const selected = route.query.civ && CIVS[route.query.civ] ? route.query.civ : null;
  const params = { rank_level: rank || undefined, rating: rating || undefined };
  setTitle('Civilization statistics');
  const go = patch => navigate('/civs', { lb, rank, rating, civ: selected, ...patch });

  const sub = el('span', {}, 'Win and pick rates from recent ranked and quick match games.');
  app.append(pageHead('Civilizations', sub));
  app.append(el('div', { class: 'filters' },
    el('label', {}, 'Ladder ', select(Object.entries(STATS_LB_NAMES).map(([value, label]) => ({ value, label })), lb, v => navigate('/civs', { lb: v, rating, civ: selected }), { ariaLabel: 'Ladder' })),
    support.rankLevel ? el('label', {}, 'Rank bracket ', select(RANK_LEVEL_FILTERS, rank, v => go({ rank: v, rating: '' }), { ariaLabel: 'Rank bracket' })) : null,
    el('label', {}, 'Rating ', select(RATING_FILTERS, rating, v => go({ rating: v, rank: '' }), { ariaLabel: 'Rating bracket' })),
    el('span', { class: 'spacer' }),
    (rank || rating) ? el('a', { class: 'btn sm ghost', href: hrefTo('/civs', { lb }) }, 'Clear filters') : null));

  const tiles = el('div', { class: 'tiles', style: { marginBottom: '16px' } });
  const tableBox = el('div');
  const detailBox = el('div');
  const heatBox = el('div');
  const teamsBox = el('div');
  app.append(tiles, el('div', { class: 'grid main-side' }, card('All civilizations', tableBox, { flush: true, meta: 'click a row for matchups' }), el('div', { class: 'stack' }, detailBox)));
  if (support.matchups) app.append(el('div', { style: { marginTop: '16px' } }, card('Matchup heatmap', heatBox, { meta: 'row civ win rate against column civ · hover for games' })));
  if (support.teams) app.append(el('div', { style: { marginTop: '16px' } }, card('Team compositions', teamsBox, { flush: true, meta: 'civ pairs/trios with the best win rate (min. 200 games)' })));

  const civP = api.stats.civilizations(lb, params);
  const matchP = support.matchups ? api.stats.matchups(lb, params) : Promise.resolve(null);

  const civData = await fillAsync(tableBox, () => civP, d => {
    const rows = d.data || [];
    const totalPlayerGames = sum(rows.map(r => r.games_count));
    sub.replaceChildren(`${STATS_LB_NAMES[lb]} · patch${String(d.patch).includes(',') ? 'es' : ''} ${d.patch}${d.rank_level ? ` · ${RANK_LEVEL_FILTERS.find(r => r.value === d.rank_level)?.label ?? d.rank_level}` : ''}${d.rating ? ` · rating ${d.rating}` : ''}`);
    const sorted = [...rows].sort((a, b) => b.win_rate - a.win_rate);
    tiles.replaceChildren(
      statTile({ label: 'Player-games analysed', value: fmt.compact(totalPlayerGames), sub: `${rows.length} civilizations` }),
      statTile({ label: 'Highest win rate', value: el('span', {}, civChip(sorted[0].civilization, { size: 'lg', name: 'short' })), sub: `${fmt.pct(sorted[0].win_rate)} · ${fmt.pct(sorted[0].pick_rate)} pick rate` }),
      statTile({ label: 'Lowest win rate', value: el('span', {}, civChip(sorted.at(-1).civilization, { size: 'lg', name: 'short' })), sub: `${fmt.pct(sorted.at(-1).win_rate)} · ${fmt.pct(sorted.at(-1).pick_rate)} pick rate` }),
      statTile({ label: 'Most picked', value: el('span', {}, civChip([...rows].sort((a, b) => b.pick_rate - a.pick_rate)[0].civilization, { size: 'lg', name: 'short' })), sub: `${fmt.pct([...rows].sort((a, b) => b.pick_rate - a.pick_rate)[0].pick_rate)} of player-games` }),
      statTile({ label: 'Win-rate spread', value: `${(sorted[0].win_rate - sorted.at(-1).win_rate).toFixed(1)} pts`, sub: 'best minus worst civ' }));
    const maxPick = Math.max(...rows.map(r => r.pick_rate));
    return dataTable({ columns: [
      { key: 'civilization', label: 'Civilization', render: r => civChip(r.civilization), sortValue: r => civName(r.civilization) },
      { key: 'win_rate', label: 'Win rate', num: true, render: r => el('span', { class: 'wr-cell' }, divBar(r.win_rate, { span: 8 }), el('strong', { class: 'num' }, fmt.pct(r.win_rate))) },
      { key: 'pick_rate', label: 'Pick rate', num: true, render: r => el('span', { class: 'wr-cell' }, meter(100 * r.pick_rate / maxPick, { width: 56 }), el('span', { class: 'num' }, fmt.pct(r.pick_rate))) },
      { key: 'games_count', label: 'Games', num: true, render: r => fmt.compact(r.games_count) },
      { key: 'duration_median', label: 'Median', num: true, title: 'Median game length', render: r => fmt.duration(r.duration_median) },
    ], rows, sort: { key: 'win_rate', dir: 'desc' }, rowHref: r => hrefTo('/civs', { lb, rank, rating, civ: r.civilization }), rowClass: r => r.civilization === selected ? 'selected' : '' });
  }, { lines: 23 });

  if (!civData) return;
  const matchups = await matchP.catch(() => null);
  const civs = (civData.data || []).map(r => r.civilization).sort((x, y) => civName(x).localeCompare(civName(y)));

  // Matchup lookup: as -> vs -> {win_rate, games}
  const mu = new Map();
  for (const m of matchups?.data || []) {
    if (!mu.has(m.civilization)) mu.set(m.civilization, new Map());
    mu.get(m.civilization).set(m.other_civilization, m);
  }

  /* ----- detail panel ----- */
  const renderDetail = () => {
    clear(detailBox);
    if (!selected) { detailBox.append(card('Civilization detail', notice('Select a civilization in the table to see its matchups and stats.'))); return; }
    const row = (civData.data || []).find(r => r.civilization === selected);
    if (!row) { detailBox.append(card(civName(selected), notice('No data for this civilization in the selected bracket.'))); return; }
    const my = mu.get(selected);
    const list = my ? [...my.values()].filter(m => m.other_civilization !== selected).sort((a, b) => b.win_rate - a.win_rate) : [];
    detailBox.append(card(el('span', {}, civChip(selected, { size: 'lg' })), el('div', {},
      el('div', { class: 'tiles', style: { marginBottom: '14px', gridTemplateColumns: '1fr 1fr' } },
        statTile({ label: 'Win rate', value: fmt.pct(row.win_rate), sub: `${fmt.compact(row.win_count)} wins / ${fmt.compact(row.games_count)} games` }),
        statTile({ label: 'Pick rate', value: fmt.pct(row.pick_rate), sub: `median game ${fmt.duration(row.duration_median)}` })),
      list.length ? el('div', {},
        el('h3', { style: { margin: '6px 0 8px' } }, 'Matchups'),
        el('div', { class: 'barlist' }, list.map(m => el('div', { class: 'barrow', style: { gridTemplateColumns: 'minmax(110px, 150px) 1fr 54px' } },
          civChip(m.other_civilization, { name: 'short' }), divBar(m.win_rate, { span: 15, title: `${civName(selected)} vs ${civName(m.other_civilization)}: ${fmt.pct(m.win_rate)} over ${fmt.int(m.games_count)} games` }), el('span', { class: 'val' }, fmt.pct(m.win_rate))))),
        el('p', { class: 'muted small', style: { margin: '10px 0 0' } }, `Best: ${civName(list[0].other_civilization)} (${fmt.pct(list[0].win_rate)}) · Worst: ${civName(list.at(-1).other_civilization)} (${fmt.pct(list.at(-1).win_rate)})`))
        : el('p', { class: 'muted small' }, 'Matchup data is only published for Solo Ranked and Quick Match 1v1.')),
      { actions: el('a', { class: 'btn sm ghost', href: hrefTo('/civs', { lb, rank, rating }) }, 'Close') }));
  };
  renderDetail();

  /* ----- heatmap ----- */
  if (support.matchups) {
    clear(heatBox);
    if (!matchups) heatBox.append(notice('Matchup data could not be loaded.'));
    else {
      heatBox.append(heatmap({
        rows: civs, cols: civs,
        value: (r, c) => mu.get(r)?.get(c)?.win_rate ?? null,
        color: v => divergingColor(v, 50, 12),
        rowLabel: r => el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, el('span', { class: 'muted', style: { fontSize: '11px' } }, civShort(r)), el('img', { src: civFlag(r), alt: civName(r), title: civName(r) })),
        colLabel: c => el('img', { src: civFlag(c), alt: civName(c), title: civName(c) }),
        tooltip: (r, c, v) => { const m = mu.get(r)?.get(c); return el('div', {}, el('div', { class: 'tt-title' }, `${civName(r)} vs ${civName(c)}`), el('div', { class: 'tt-row' }, el('span', { class: 'k' }, 'Win rate'), el('span', { class: 'v' }, fmt.pct(v))), m ? el('div', { class: 'tt-row' }, el('span', { class: 'k' }, 'Games'), el('span', { class: 'v' }, fmt.int(m.games_count))) : null); },
        ariaLabel: 'Civilization matchup win rates',
      }), scaleLegend('≤ 38% (row loses)', '≥ 62% (row wins)'));
      heatBox.append(el('p', { class: 'muted small', style: { margin: '10px 0 0' } }, 'Click a civilization in the table to read its row as a sortable list.'));
    }
  }

  /* ----- team comps ----- */
  if (support.teams) {
    fillAsync(teamsBox, () => api.stats.teams(lb, params), d => {
      const rows = (d.data || []).filter(t => t.games_count >= 200).sort((a, b) => b.win_rate - a.win_rate).slice(0, 40);
      return dataTable({ columns: [
        { key: 'civilization', label: 'Composition', sortable: false, render: r => el('span', { style: { display: 'inline-flex', gap: '10px', flexWrap: 'wrap' } }, r.civilization.map(c => civChip(c, { name: 'short' }))) },
        { key: 'win_rate', label: 'Win rate', num: true, render: r => wrCell(r.win_rate) },
        { key: 'games_count', label: 'Games', num: true, render: r => fmt.int(r.games_count) },
        { key: 'duration_median', label: 'Median length', num: true, render: r => fmt.duration(r.duration_median) },
      ], rows, sort: { key: 'win_rate', dir: 'desc' } });
    }, { lines: 10 });
  }
}
