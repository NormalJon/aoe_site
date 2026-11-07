import { el, fmt, setTitle, hrefTo, navigate, qs } from '../util.js';
import { api } from '../api.js';
import { playerLink, rankBadge, dataTable, pagination, segmented, select, streakEl, signedNum, wrCell, notice } from '../components.js';
import { LEADERBOARDS, LB } from '../constants.js';
import { fillAsync, pageHead, countryOptions } from './_shared.js';

export async function render(app, route) {
  const key = LB[route.parts[1]] ? route.parts[1] : 'rm_solo';
  const lbMeta = LB[key];
  const page = Math.max(1, parseInt(route.query.page || '1', 10) || 1);
  const country = (route.query.country || '').toLowerCase();
  const query = route.query.query || '';
  setTitle(`${lbMeta.name} leaderboard`);

  const go = patch => navigate(`/leaderboard/${key}`, { page: 1, country, query, ...patch });
  const sub = el('span', {}, 'Loading…');
  app.append(pageHead('Leaderboards', sub));
  app.append(el('div', { class: 'mode-tabs' }, segmented(LEADERBOARDS.map(l => ({ value: l.key, label: l.name, href: hrefTo(`/leaderboard/${l.key}`, { country, query }) })), key, null, { ariaLabel: 'Leaderboard' })));

  // Filters
  const nameInput = el('input', { type: 'search', placeholder: 'Filter by name…', value: query, 'aria-label': 'Filter by player name' });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') go({ query: nameInput.value.trim() }); });
  const pageInput = el('input', { type: 'number', min: 1, value: page, style: { width: '84px' }, 'aria-label': 'Jump to page' });
  pageInput.addEventListener('keydown', e => { if (e.key === 'Enter') go({ page: Math.max(1, parseInt(pageInput.value, 10) || 1) }); });
  app.append(el('div', { class: 'filters' },
    el('label', {}, 'Name ', nameInput), el('button', { class: 'btn sm', type: 'button', onClick: () => go({ query: nameInput.value.trim() }) }, 'Search'),
    el('label', {}, 'Country ', select(countryOptions(country), country, v => go({ country: v }), { ariaLabel: 'Country' })),
    el('span', { class: 'spacer' }),
    el('label', {}, 'Page ', pageInput),
    (query || country) ? el('a', { class: 'btn sm ghost', href: hrefTo(`/leaderboard/${key}`) }, 'Clear filters') : null));

  // Compare picker bar
  const picked = new Map();
  const bar = el('div', { class: 'notice', style: { display: 'none', marginBottom: '12px', alignItems: 'center', gap: '12px' } });
  const refreshBar = () => {
    const ps = [...picked.values()];
    bar.style.display = ps.length ? 'flex' : 'none';
    bar.replaceChildren(el('span', {}, 'Compare: ', ps.map((p, i) => [i ? ' vs ' : '', el('strong', {}, p.name)])), ps.length === 2
      ? el('a', { class: 'btn sm primary', href: hrefTo(`/compare/${ps[0].profile_id}/${ps[1].profile_id}`) }, 'Open comparison')
      : el('span', { class: 'muted small' }, 'pick one more player'),
      el('button', { class: 'btn sm ghost', type: 'button', onClick: () => { picked.clear(); app.querySelectorAll('input.pick').forEach(c => { c.checked = false; }); refreshBar(); } }, 'Clear'));
  };
  app.append(bar);

  const body = el('div', { class: 'card flush' });
  app.append(body);

  await fillAsync(body, () => api.leaderboard(key, { page, country: country || undefined, query: query || undefined }), d => {
    const total = d.total_count ?? 0, per = d.per_page || 50, totalPages = Math.max(1, Math.ceil(total / per));
    sub.replaceChildren(`${lbMeta.name}${d.season ? ` · Season ${d.season}` : ''} · ${fmt.int(total)} ranked players${country ? ` from ${countryOptions(country).find(o => o.value === country)?.label ?? country}` : ''}${query ? ` matching “${query}”` : ''}`);
    const columns = [
      { key: 'rank', label: '#', num: true, shrink: true, sortable: false, render: r => el('span', { class: 'num muted' }, String(r.rank ?? '—')) },
      { key: 'pick', label: '', shrink: true, sortable: false, render: r => el('input', { type: 'checkbox', class: 'pick', 'aria-label': `Pick ${r.name} to compare`, onChange: e => { if (e.target.checked) { if (picked.size >= 2) { e.target.checked = false; return; } picked.set(r.profile_id, r); } else picked.delete(r.profile_id); refreshBar(); } }) },
      { key: 'name', label: 'Player', sortable: false, render: r => el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } }, playerLink(r), r.twitch_is_live ? el('span', { class: 'pill live', title: 'Streaming on Twitch' }, 'Live') : null) },
      { key: 'rank_level', label: 'Rank', sortable: false, render: r => rankBadge(r.rank_level, { sm: true }) },
      { key: 'rating', label: 'Rating', num: true, render: r => el('span', { style: { display: 'inline-flex', gap: '8px', alignItems: 'baseline' } }, el('strong', { class: 'num' }, fmt.int(r.rating)), r.last_rating_change ? signedNum(r.last_rating_change, { cls: 'small' }) : null) },
      { key: 'max_rating', label: 'Peak', num: true, title: 'Highest rating this season', render: r => fmt.int(r.max_rating) },
      { key: 'win_rate', label: 'Win rate', num: true, render: r => wrCell(r.win_rate, { w: r.wins_count, l: r.losses_count }) },
      { key: 'wins_count', label: 'W', num: true, render: r => fmt.int(r.wins_count) },
      { key: 'losses_count', label: 'L', num: true, render: r => fmt.int(r.losses_count) },
      { key: 'streak', label: 'Streak', num: true, render: r => streakEl(r.streak) },
      { key: 'games_count', label: 'Games', num: true, render: r => fmt.int(r.games_count) },
      { key: 'last_game_at', label: 'Last game', sortValue: r => r.last_game_at ? new Date(r.last_game_at).getTime() : 0, render: r => el('span', { class: 'muted small', title: fmt.dateTime(r.last_game_at) }, fmt.rel(r.last_game_at)) },
    ];
    const frag = document.createDocumentFragment();
    if (!d.players?.length) frag.append(notice('No players match these filters.'));
    frag.append(dataTable({ columns, rows: d.players || [], rowHref: r => hrefTo(`/player/${r.profile_id}`), caption: `${lbMeta.name} leaderboard page ${page}` }));
    frag.append(pagination({ page, totalPages, hrefFor: p => hrefTo(`/leaderboard/${key}`, { page: p, country, query }), info: `Page ${fmt.int(page)} of ${fmt.int(totalPages)} · ranks ${fmt.int((page - 1) * per + 1)}–${fmt.int(Math.min(total, page * per))}` }));
    return frag;
  }, { lines: 14 });
}
