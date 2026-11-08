import { el, setTitle, fmt } from '../util.js';
import { relic, api } from '../api.js';
import { card, statTile } from '../components.js';
import { pageHead } from './_shared.js';

const row = (cells, { head = false } = {}) => el('tr', {}, cells.map(c => el(head ? 'th' : 'td', {}, c)));
const code = s => el('code', {}, s);

export async function render(app) {
  setTitle('Data & sources');
  app.append(pageHead('Data & sources', 'Where the numbers come from, which APIs exist, and what each one can and cannot do.',
    el('a', { class: 'btn', href: '#/api' }, 'Open the API console →')));

  const status = el('div', { class: 'tiles', style: { marginBottom: '20px' } });
  app.append(status);
  const ping = async (label, fn) => {
    const t0 = performance.now();
    try { const r = await fn(); const ms = Math.round(performance.now() - t0); return statTile({ label, value: r ? 'Reachable' : 'Unavailable', sub: r ? `${fmt.int(ms)} ms` : 'see notes below' }); }
    catch { return statTile({ label, value: 'Unavailable', sub: 'request failed' }); }
  };
  Promise.all([
    ping('AoE4 World API (browser → aoe4world.com)', () => api.leaderboard('rm_solo')),
    ping('Official World’s Edge API (via local proxy)', () => relic.availableLeaderboards()),
  ]).then(tiles => status.replaceChildren(...tiles));

  const prose = el('div', { class: 'prose' });
  app.append(prose);

  prose.append(el('h2', {}, 'Short answer'),
    el('p', {}, el('strong', {}, 'There is no officially documented public API from the developers.'), ' World’s Edge / Relic have never published developer documentation, keys or terms for Age of Empires IV data. Repeated community requests on the official forums since 2021 have gone without a developer response.'),
    el('p', {}, 'In practice every stats site is built on two sources: the ', el('strong', {}, 'undocumented but openly reachable game-backend API'), ' that the game client itself uses, and the ', el('strong', {}, 'community-run AoE4 World API'), ', which ingests that backend plus replay data and exposes a clean, documented, CORS-enabled JSON API at no cost. This prototype uses both.'));

  prose.append(el('h2', {}, 'Source 1 — AoE4 World public API'),
    el('p', {}, 'Base URL ', code('https://aoe4world.com/api/v0'), '. Documented at ', el('a', { href: 'https://aoe4world.com/api', rel: 'noopener', target: '_blank' }, 'aoe4world.com/api'), '. No key, no auth, responds with ', code('Access-Control-Allow-Origin: *'), ' so a browser can call it directly. Verified working on 7 Nov 2026.'));
  const t1 = el('table', { class: 'data' });
  t1.append(row(['Endpoint', 'Used for', 'Notes'], { head: true }));
  [
    ['GET /players/search?query=', 'Search box', 'min. 3 chars; returns per-ladder ratings and socials'],
    ['GET /players/autocomplete?leaderboard=&query=', '—', 'lighter alternative scoped to one ladder'],
    ['GET /players/:id', 'Profile header, tiles, rating chart, civ pool, seasons', 'all modes incl. hidden ELO; rating_history per game'],
    ['GET /players/:id/games', 'Match list, Insights, head-to-head', 'filters: leaderboard, opponent_profile_id, since; 50/page'],
    ['GET /players/:id/games/last?include_stats=true', '(not yet used)', 'per-player in-game stats for the latest game'],
    ['GET /leaderboards/:key', 'Leaderboards, home snapshot', 'rm_solo, rm_team, qm_1v1…qm_4v4; country, query, profile_ids, time'],
    ['GET /games', 'Live feed, home', 'order=started_at|updated_at, leaderboard=rm_1v1…; ongoing flag'],
    ['GET /stats/:lb/civilizations', 'Civilizations', 'patch, rank_level (RM only), rating'],
    ['GET /stats/:lb/matchups', 'Matchup heatmap', 'rm_solo and qm_1v1 only'],
    ['GET /stats/:lb/maps and /maps/:id', 'Maps', 'rm_solo, qm_1v1, rm_2v2'],
    ['GET /stats/qm_2v2|qm_3v3/teams', 'Team compositions', 'civ combos with win rates'],
    ['GET /esports/leaderboards/1', '(not yet used)', 'tournament Elo'],
    ['/dumps', '(not yet used)', 'periodic bulk match-history dumps for offline analysis'],
  ].forEach(r => t1.append(row([code(r[0]), r[1], r[2]])));
  prose.append(el('div', { class: 'table-wrap' }, t1));
  prose.append(el('h3', {}, 'Terms of use (from the API page)'),
    el('ul', {},
      el('li', {}, 'Non-profit fan project, not affiliated with Microsoft. No formal licence; the maintainers ask for responsible use.'),
      el('li', {}, 'No bulk crawling. Cache locally; use ', code('since'), ' / ', code('updated_since'), ' for incremental sync; prefer the dumps for large analyses.'),
      el('li', {}, 'Automated callers must send a descriptive ', code('User-Agent'), ' with contact details (a browser calling on a user’s behalf is fine).'),
      el('li', {}, 'Abuse leads to blocks. Larger projects are invited to discuss their use case on the project Discord.')));

  prose.append(el('h2', {}, 'Source 2 — World’s Edge community API (the game backend)'),
    el('p', {}, 'Base URL ', code('https://aoe-api.worldsedgelink.com/community/'), ' (the older ', code('aoe-api.reliclink.com'), ' host now fails TLS verification). This is the service the game client talks to. Reads are public and need no session, but it sends no CORS headers, so it must be read server-side — in this prototype through the tiny proxy in ', code('server.py'), '.'));
  const t2 = el('table', { class: 'data' });
  t2.append(row(['Endpoint', 'Used for', 'Notes'], { head: true }));
  [
    ['leaderboard/getAvailableLeaderboards?title=age4', 'Status check, ladder names', '127 leaderboards incl. console, Empire Wars, event modes'],
    ['leaderboard/getLeaderBoard2?leaderboard_id=&start=&count=&sortBy=1&platform=PC_STEAM', '(available)', 'raw official ladder with rank, rating, xp/level, region'],
    ['leaderboard/getPersonalStat?profile_ids=[…]', 'Profile → Official data', 'all ladders a player has entries on, account level & XP'],
    ['leaderboard/getRecentMatchHistory?profile_ids=[…]', 'Profile → Official data (telemetry)', 'per-match counters: units produced/killed/lost, buildings, upgrades, total commands, rating before/after, replay URLs'],
  ].forEach(r => t2.append(row([code(r[0]), r[1], r[2]])));
  prose.append(el('div', { class: 'table-wrap' }, t2));
  prose.append(el('ul', {},
    el('li', {}, 'Undocumented: field names and ladder ids are reverse-engineered by the community (see the LibreMatch wiki and the aoe-api atlas repo). No compatibility guarantee.'),
    el('li', {}, 'Community-observed rate limit around 50 requests/second; be conservative and cache.'),
    el('li', {}, 'Map names come back as ', code('generated_map'), ' and civilizations as numeric ids — join against AoE4 World data for readable names, as this site does.')));

  prose.append(el('h2', {}, 'Source 3 — static game data'),
    el('p', {}, el('a', { href: 'https://github.com/aoe4world/data', rel: 'noopener', target: '_blank' }, 'aoe4world/data'), ' publishes units, buildings, technologies and civilization descriptions as JSON at ', code('data.aoe4world.com'), ' (e.g. ', code('/civilizations/english.json'), ', ', code('/units/all.json'), ') with unit icons under ', code('/images/units/'), '. Civilization flag artwork in this prototype is bundled locally. Game assets remain Microsoft’s IP under the Game Content Usage Rules.'));

  prose.append(el('h2', {}, 'What this means for a real site'),
    el('ul', {},
      el('li', {}, el('strong', {}, 'Prototype (this build):'), ' browser → AoE4 World directly; optional local proxy for the official backend.'),
      el('li', {}, el('strong', {}, 'Production:'), ' a small backend that ingests both sources on a schedule (AoE4 World ', code('/games?updated_since'), ' plus dumps; official ladders and match history), stores them, and serves its own API. That removes dependence on third-party uptime and lets you compute things neither source offers: rating distributions, long-term trends, clan/team pages, custom percentiles.'),
      el('li', {}, el('strong', {}, 'Replays:'), ' the official match history exposes replay download URLs; AoE4 World also runs a replay parser. Build orders and timelines are a realistic next feature.'),
      el('li', {}, el('strong', {}, 'Attribution:'), ' credit AoE4 World visibly and keep request volume modest; talk to the maintainers before launching anything high-traffic.')));
}
