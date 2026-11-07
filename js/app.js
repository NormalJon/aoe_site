// Router + shell behaviour.
import { parseHash, el, clear } from './util.js';
import { searchBox, errorBox, notice } from './components.js';
import * as home from './pages/home.js';
import * as player from './pages/player.js';
import * as compare from './pages/compare.js';
import * as leaderboard from './pages/leaderboard.js';
import * as civs from './pages/civs.js';
import * as maps from './pages/maps.js';
import * as live from './pages/live.js';
import * as data from './pages/data.js';
import * as mygames from './pages/mygames.js';

const routes = [
  { test: p => p.length === 0, page: home, nav: null },
  { test: p => p[0] === 'player' && /^\d+$/.test(p[1] || ''), page: player, nav: null },
  { test: p => p[0] === 'compare', page: compare, nav: 'compare' },
  { test: p => p[0] === 'leaderboard', page: leaderboard, nav: 'leaderboard' },
  { test: p => p[0] === 'civs', page: civs, nav: 'civs' },
  { test: p => p[0] === 'maps', page: maps, nav: 'maps' },
  { test: p => p[0] === 'live', page: live, nav: 'live' },
  { test: p => p[0] === 'data', page: data, nav: 'data' },
  { test: p => p[0] === 'mygames', page: mygames, nav: 'mygames' },
];
const notFound = { page: { render: app => { app.append(notice('Page not found. ', el('a', { href: '#/' }, 'Go home'))); } }, nav: null };

let cleanup = null, seq = 0, lastPath = null;
async function route() {
  const r = parseHash();
  const match = routes.find(x => x.test(r.parts)) || notFound;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const my = ++seq;
  document.querySelectorAll('.main-nav a').forEach(a => { if (a.dataset.nav === match.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
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
route();
