// Router + shell behaviour.
import { parseHash, el, clear, qs } from './util.js';
import { searchBox, errorBox, notice } from './components.js';
import { getMe, syncMe } from './me.js';
import { pageHead } from './pages/_shared.js';
import * as home from './pages/home.js';
import * as player from './pages/player.js';
import * as compare from './pages/compare.js';
import * as leaderboard from './pages/leaderboard.js';
import * as civs from './pages/civs.js';
import * as maps from './pages/maps.js';
import * as live from './pages/live.js';
import * as data from './pages/data.js';
import * as mygames from './pages/mygames.js';
import * as game from './pages/game.js';
import * as tournament from './pages/tournament.js';
import * as apiConsole from './pages/api.js';

/** #/player/me → the configured or chosen profile; explains how to set one otherwise. */
const mePage = {
  async render(app, r) {
    const me = await syncMe();
    if (me) { location.replace(`#/player/${me}${qs(r.query)}`); return; }
    app.append(pageHead('My profile', 'Forge does not know which player you are yet.'),
      notice(el('strong', {}, 'Pick yourself: '), 'search for your name, open your profile and press ', el('strong', {}, 'This is me'), '. With the companion running, the ', el('code', {}, 'me'), ' entry of forge.local.json is used automatically.'),
      el('div', { style: { marginTop: '16px', maxWidth: '560px' } }, searchBox({ large: true, autofocus: true, placeholder: 'Search your name…' })));
  },
};

// `nav` is the data-nav key of the active header link, or a function of the route when it depends on state.
const routes = [
  { test: p => p.length === 0, page: home, nav: null },
  { test: p => p[0] === 'player' && p[1] === 'me', page: mePage, nav: 'me' },
  { test: p => p[0] === 'player' && /^\d+$/.test(p[1] || ''), page: player, nav: r => String(r.parts[1]) === String(getMe()) ? 'me' : null },
  { test: p => p[0] === 'game' && /^\d+$/.test(p[1] || ''), page: game, nav: null },
  { test: p => p[0] === 'tournament', page: tournament, nav: 'tournament' },
  { test: p => p[0] === 'compare', page: compare, nav: 'compare' },
  { test: p => p[0] === 'leaderboard', page: leaderboard, nav: 'leaderboard' },
  { test: p => p[0] === 'civs', page: civs, nav: 'civs' },
  { test: p => p[0] === 'maps', page: maps, nav: 'maps' },
  { test: p => p[0] === 'live', page: live, nav: 'live' },
  { test: p => p[0] === 'data', page: data, nav: 'data' },
  { test: p => p[0] === 'api', page: apiConsole, nav: 'api' },
  { test: p => p[0] === 'mygames', page: mygames, nav: 'mygames' },
  { test: p => p[0] === 'scout', page: { render: app => { app.append(notice(el('strong', {}, 'Scout moved. '), 'Opponent intel now lives on the profile page: open ', el('a', { href: '#/player/me' }, 'My profile'), ' — in a game the panel fills in by itself, otherwise use "Scout ahead".')); } }, nav: 'me' },
];
const notFound = { page: { render: app => { app.append(notice('Page not found. ', el('a', { href: '#/' }, 'Go home'))); } }, nav: null };

let cleanup = null, seq = 0, lastPath = null;
function markNav(navKey) {
  document.querySelectorAll('.main-nav a').forEach(a => { if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.querySelectorAll('.main-nav details').forEach(d => { d.open = false; d.classList.toggle('active', !!d.querySelector('a[aria-current]')); });
}
async function route() {
  const r = parseHash();
  const match = routes.find(x => x.test(r.parts)) || notFound;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const my = ++seq;
  markNav(typeof match.nav === 'function' ? match.nav(r) : match.nav);
  const app = document.getElementById('app');
  const samePath = lastPath === r.path; lastPath = r.path;
  const y = window.scrollY;
  clear(app);
  try {
    const res = await match.page.render(app, r);
    if (my !== seq) return;
    if (typeof res === 'function') cleanup = res;
  } catch (e) {
    if (my !== seq) return;
    console.error(e);
    clear(app); app.append(errorBox(e, route));
  }
  if (!samePath) window.scrollTo(0, 0); else window.scrollTo(0, Math.min(y, document.body.scrollHeight));
}

/* "My profile" link: points at the configured / chosen player, or at the explainer page */
function refreshMeNav() {
  const a = document.getElementById('nav-me');
  if (!a) return;
  const me = getMe();
  a.href = me ? `#/player/${me}` : '#/player/me';
  const r = parseHash();
  if (r.parts[0] === 'player' && me && String(r.parts[1]) === String(me)) markNav('me');
}
document.addEventListener('forge:me', refreshMeNav);
// the Testing menu closes when you click elsewhere
document.addEventListener('pointerdown', e => { document.querySelectorAll('.main-nav details[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }); });

/* theme */
const THEME_KEY = 'forge-theme';
function applyTheme(t) { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); }
function initTheme() {
  let t = null; try { t = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (!t) t = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(t);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    // Charts read colours from CSS variables at render time; re-render the page so canvases pick them up.
    route();
  });
}

initTheme();
document.getElementById('header-search')?.append(searchBox({ placeholder: 'Search players…' }));
window.addEventListener('hashchange', route);
refreshMeNav();
syncMe().then(refreshMeNav);
route();
