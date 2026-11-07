import { el, fmt, setTitle, hrefTo } from '../util.js';
import { api } from '../api.js';
import { searchBox, playerLink, rankBadge, civChip, divBar, card, resultPill, flattenTeams } from '../components.js';
import { SAMPLE_PLAYERS, civName, kindName } from '../constants.js';
import { fillAsync } from './_shared.js';

function miniLeaderboard(lb) {
  return el('div', { class: 'mini-lb' }, (lb.players || []).slice(0, 10).map(p => el('div', { class: 'row' },
    el('span', { class: 'rk' }, String(p.rank)),
    el('div', { style: { minWidth: 0, display: 'grid', gap: '2px' } }, playerLink(p), rankBadge(p.rank_level, { sm: true })),
    el('div', { class: 'right' }, el('div', { class: 'rt' }, fmt.int(p.rating)), el('div', { class: 'muted small num' }, `${fmt.pct(p.win_rate, 0)} · ${fmt.int(p.games_count)} g`)))));
}

function civSnapshot(d) {
  const rows = [...(d.data || [])].sort((a, b) => b.win_rate - a.win_rate);
  const top = rows.slice(0, 5), bottom = rows.slice(-5).reverse();
  const list = arr => el('div', { class: 'barlist' }, arr.map(c => el('div', { class: 'barrow', style: { gridTemplateColumns: 'minmax(120px,170px) 1fr 56px' } },
    civChip(c.civilization, { name: 'short' }), divBar(c.win_rate, { span: 10, title: `${fmt.pct(c.win_rate)} win rate · ${fmt.pct(c.pick_rate)} pick rate` }), el('span', { class: 'val' }, fmt.pct(c.win_rate)))));
  return el('div', { class: 'stack' },
    el('div', {}, el('h3', { class: 'muted small', style: { marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.05em' } }, 'Highest win rate'), list(top)),
    el('div', {}, el('h3', { class: 'muted small', style: { marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.05em' } }, 'Lowest win rate'), list(bottom)),
    el('p', { class: 'muted small', style: { margin: '4px 0 0' } }, `Solo Ranked · patches ${d.patch} · all ranks. `, el('a', { href: '#/civs' }, 'Full breakdown →')));
}

function liveSnapshot(feed) {
  const games = (feed.games || []);
  const ongoing = games.filter(g => g.ongoing);
  const recent = games.filter(g => !g.ongoing && g.state === 'processed').slice(0, 5);
  const row = g => {
    const teams = flattenTeams(g);
    return el('div', { class: 'row', style: { gridTemplateColumns: '1fr auto' } },
      el('div', { style: { minWidth: 0 } },
        el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
          teams.map((t, i) => [i > 0 ? el('span', { class: 'muted small' }, 'vs') : null, t.map(p => el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } },
            el('img', { src: `assets/flags/${p.civilization}.png`, alt: civName(p.civilization), title: civName(p.civilization), width: 20, height: 11, style: { borderRadius: '2px' } }),
            el('a', { href: hrefTo(`/player/${p.profile_id}`), style: { fontWeight: 600, color: 'var(--ink)' } }, p.name)))])),
        el('div', { class: 'muted small' }, `${g.map} · ${kindName(g.kind)}${g.server ? ` · ${g.server}` : ''}`)),
      g.ongoing ? resultPill('live') : el('span', { class: 'muted small' }, fmt.duration(g.duration)));
  };
  return el('div', {},
    el('div', { class: 'tiles', style: { marginBottom: '12px', gridTemplateColumns: '1fr 1fr' } },
      el('div', { class: 'tile' }, el('div', { class: 'label' }, 'Live in the last feed page'), el('div', { class: 'value' }, String(ongoing.length), el('span', { class: 'unit' }, 'games'))),
      el('div', { class: 'tile' }, el('div', { class: 'label' }, 'Feed window'), el('div', { class: 'value' }, String(games.length), el('span', { class: 'unit' }, 'most recent')))),
    el('div', { class: 'mini-lb' }, ongoing.slice(0, 4).map(row), recent.slice(0, 3).map(row)),
    el('p', { class: 'small', style: { margin: '10px 0 0' } }, el('a', { href: '#/live' }, 'Open the live feed →')));
}

export async function render(app) {
  setTitle(null);
  const hero = el('section', { class: 'hero' },
    el('h1', {}, 'Every Age of Empires IV player, one search away.'),
    el('p', {}, 'Profiles, head-to-head comparisons, leaderboards and civilization statistics for ranked and quick match. Built on live community data.'),
    searchBox({ large: true, autofocus: true, id: 'home-search' }),
    el('div', { class: 'quick' }, el('span', {}, 'Try:'), SAMPLE_PLAYERS.map(p => el('a', { href: hrefTo(`/player/${p.id}`) }, p.name)), el('a', { href: '#/compare' }, 'Compare two players →')));

  const soloBox = el('div'), teamBox = el('div'), civBox = el('div'), liveBox = el('div');
  const grid = el('div', { class: 'grid cols-3' },
    card('Solo Ranked · Top 10', soloBox, { flush: true, actions: el('a', { class: 'small', href: '#/leaderboard/rm_solo' }, 'Full leaderboard') }),
    card('Team Ranked · Top 10', teamBox, { flush: true, actions: el('a', { class: 'small', href: '#/leaderboard/rm_team' }, 'Full leaderboard') }),
    card('Civilizations right now', civBox, { actions: el('a', { class: 'small', href: '#/civs' }, 'Stats') }));
  const second = el('div', { class: 'grid cols-2', style: { marginTop: '16px' } },
    card('Happening now', liveBox, { flush: false, actions: el('a', { class: 'small', href: '#/live' }, 'Live feed') }),
    card('What this prototype covers', el('div', { class: 'prose' },
      el('ul', {},
        el('li', {}, el('strong', {}, 'Player profiles'), ' — every mode, rating history, civ pool, season history, full match list with filters, derived insights (maps, matchups, rivals) and official account telemetry.'),
        el('li', {}, el('strong', {}, 'Compare'), ' — two players side by side with overlaid rating curves, civ pool dumbbells and a complete head-to-head record.'),
        el('li', {}, el('strong', {}, 'Leaderboards'), ' — six ladders, country filter, name search, pick-two-to-compare.'),
        el('li', {}, el('strong', {}, 'Civilizations & maps'), ' — win/pick rates by rank bracket, a 23×23 matchup heatmap, team compositions and per-map civ performance.'),
        el('li', {}, el('strong', {}, 'Data'), ' — which APIs exist, which are official, and what each can and cannot provide.')),
      el('p', { class: 'muted small' }, 'Everything on this page is fetched live in your browser from the AoE4 World public API; nothing is mocked.'))));
  app.append(hero, grid, second);

  fillAsync(soloBox, () => api.leaderboard('rm_solo'), miniLeaderboard, { lines: 10 });
  fillAsync(teamBox, () => api.leaderboard('rm_team'), miniLeaderboard, { lines: 10 });
  fillAsync(civBox, () => api.stats.civilizations('rm_solo'), civSnapshot, { lines: 10 });
  fillAsync(liveBox, () => api.games({ order: 'updated_at', per_page: 50 }), liveSnapshot, { lines: 8 });
}
