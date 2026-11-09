// Helpers shared by page modules.
import { el, clear, append, countryName } from '../util.js';
import { skeleton, errorBox, notice } from '../components.js';
import { PROFILE_MODES, LEADERBOARDS, FULL_SITE_URL } from '../constants.js';

/* ---------- companion availability messaging ---------- */
export const isLocalHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.protocol === 'file:';
/** Inline explanation of why a companion feature is unavailable, worded for the host we are on. */
export function companionHint() {
  if (isLocalHost()) return ['Start the site with ', el('code', {}, 'py -3 server.py'), ' and open ', el('code', {}, 'http://127.0.0.1:8000/'), ' to enable it.'];
  return ['This copy is the static half of Forge; replay analysis, opponent intel from replays and the Cup run on the companion server, which is not part of this deployment. ',
    FULL_SITE_URL ? el('a', { href: FULL_SITE_URL + location.hash, rel: 'noopener' }, 'Open the full site →') : 'The full site is available where server.py is deployed (see docs/HOSTING.md in the repository).'];
}
export function companionNotice(feature) {
  return notice(el('strong', {}, `${feature} ${isLocalHost() ? 'needs the local companion. ' : 'is not available on this static deployment. '}`), ...companionHint());
}

/** Show a skeleton, then swap in the rendered result (or an error box). */
export async function fillAsync(container, load, renderFn, { lines = 5 } = {}) {
  clear(container); container.append(skeleton(lines));
  try {
    const data = await load();
    if (!container.isConnected) return data;
    clear(container); append(container, [renderFn(data)]);
    return data;
  } catch (e) {
    if (!container.isConnected) return null;
    console.error(e);
    clear(container); container.append(errorBox(e, () => fillAsync(container, load, renderFn, { lines })));
    return null;
  }
}

export function pageHead(title, sub, actions) {
  return el('div', { class: 'page-head' }, el('div', {}, el('h1', {}, title), sub ? el('p', { class: 'sub' }, sub) : null), actions ?? null);
}

export function ratingHistoryPoints(mode) {
  return Object.entries(mode?.rating_history || {})
    .map(([ts, v]) => ({ x: Number(ts) * 1000, y: v.rating, meta: v }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
}

export function modesWithData(player) {
  return PROFILE_MODES.filter(m => {
    const d = player?.modes?.[m.key];
    return d && ((d.games_count ?? 0) > 0 || d.rating);
  });
}
export function defaultMode(player) {
  const pref = ['rm_solo', 'rm_team', 'qm_1v1', 'qm_2v2', 'qm_3v3', 'qm_4v4', 'rm_1v1_elo', 'rm_2v2_elo'];
  for (const k of pref) { const d = player?.modes?.[k]; if (d && (d.games_count ?? 0) > 0) return k; }
  for (const k of pref) { const d = player?.modes?.[k]; if (d && d.rating) return k; }
  return 'rm_solo';
}
/* ---------- time windows over a player's games (the aggregate stats API has none) ---------- */
export const PERIODS = [
  { value: '', label: 'Season to date' },
  { value: '7d', label: 'Last 7 days' }, { value: '14d', label: 'Last 14 days' }, { value: '30d', label: 'Last 30 days' },
  { value: 'patch', label: 'Current patch' },
];
/** ISO timestamp for the games endpoint's `since`, or null when the period is not a day count.
 *  Rounded down to the hour so the request URL, and with it the client cache key, stays stable across renders. */
export function periodSince(period) {
  const days = { '7d': 7, '14d': 14, '30d': 30 }[period];
  return days ? new Date(Math.floor((Date.now() - days * 86400e3) / 3600e3) * 3600e3).toISOString() : null;
}
export function periodLabel(period) {
  return { '7d': 'in the last 7 days', '14d': 'in the last 14 days', '30d': 'in the last 30 days', patch: 'on the current patch' }[period] || 'season to date';
}

/** Map a profile mode key to the `leaderboard` filter accepted by the player games endpoint. */
export function gamesFilterFor(modeKey) {
  const m = { rm_1v1_elo: 'rm_solo', rm_2v2_elo: 'rm_team', rm_3v3_elo: 'rm_team', rm_4v4_elo: 'rm_team' };
  return m[modeKey] ?? modeKey;
}

const COMMON_COUNTRIES = ['us', 'ca', 'mx', 'br', 'ar', 'cl', 'gb', 'ie', 'fr', 'de', 'nl', 'be', 'es', 'pt', 'it', 'ch', 'at', 'pl', 'cz', 'sk', 'se', 'no', 'dk', 'fi', 'ru', 'ua', 'by', 'tr', 'gr', 'ro', 'hu', 'rs', 'hr', 'bg', 'cn', 'tw', 'hk', 'jp', 'kr', 'in', 'pk', 'au', 'nz', 'sg', 'my', 'th', 'vn', 'ph', 'id', 'sa', 'ae', 'il', 'ir', 'eg', 'za', 'ma', 'ng'];
export function countryOptions(current) {
  const opts = COMMON_COUNTRIES.map(cc => ({ value: cc, label: countryName(cc) })).sort((a, b) => a.label.localeCompare(b.label));
  if (current && !COMMON_COUNTRIES.includes(current)) opts.unshift({ value: current, label: countryName(current) });
  return [{ value: '', label: 'All countries' }, ...opts];
}

export { LEADERBOARDS };
