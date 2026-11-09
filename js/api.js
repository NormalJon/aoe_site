// Data layer: aoe4world public API (CORS-enabled, no key) + optional Relic proxy served by server.py.
import { API_BASE, RELIC_PROXY } from './constants.js';
import { qs } from './util.js';

export class ApiError extends Error {
  constructor(message, status, url) { super(message); this.status = status; this.url = url; }
}

const mem = new Map();
const TTL = { short: 2 * 60e3, medium: 5 * 60e3, long: 60 * 60e3 };

function fromSession(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { exp, at, data } = JSON.parse(raw);
    if (Date.now() > exp) { sessionStorage.removeItem(key); return null; }
    return { at, data };
  } catch { return null; }
}
function toSession(key, data, ttl, at) {
  try { sessionStorage.setItem(key, JSON.stringify({ exp: Date.now() + ttl, at, data })); } catch { /* quota or private mode: ignore */ }
}

/** GET JSON with a two-level cache (memory, then sessionStorage). In-flight requests are shared. */
export async function getJSON(url, { ttl = TTL.medium, force = false } = {}) {
  if (!force) {
    const hit = mem.get(url);
    if (hit && hit.exp > Date.now()) return hit.promise;
    const s = fromSession(url);
    if (s) { mem.set(url, { exp: Date.now() + ttl, at: s.at, promise: Promise.resolve(s.data) }); return s.data; }
  }
  const at = Date.now();
  const promise = (async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* body not JSON */ }
      throw new ApiError(msg, res.status, url);
    }
    const data = await res.json();
    toSession(url, data, ttl, at);
    return data;
  })();
  mem.set(url, { exp: Date.now() + ttl, at, promise });
  promise.catch(() => mem.delete(url));
  return promise;
}

/** When the cached copy of `url` was fetched (ms), or null. */
export function cachedAt(url) {
  const hit = mem.get(url);
  if (hit?.at) return hit.at;
  return fromSession(url)?.at ?? null;
}

/** Drop every cached response whose URL contains `substr` (memory + sessionStorage). */
export function invalidate(substr) {
  for (const k of [...mem.keys()]) if (k.includes(substr)) mem.delete(k);
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.includes(substr)) sessionStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

const u = (path, params) => `${API_BASE}${path}${qs(params)}`;
export const urls = { player: id => u(`/players/${id}`) };

export const api = {
  // ----- players -----
  searchPlayers: (query, page = 1) => getJSON(u('/players/search', { query, page }), { ttl: TTL.short }),
  autocomplete: (query, leaderboard = 'rm_solo', limit = 8) => getJSON(u('/players/autocomplete', { query, leaderboard, limit }), { ttl: TTL.short }),
  player: id => getJSON(u(`/players/${id}`), { ttl: TTL.short }),
  playerGames: (id, params = {}) => getJSON(u(`/players/${id}/games`, { limit: 50, ...params }), { ttl: TTL.short }),
  lastGame: (id, includeStats = false) => getJSON(u(`/players/${id}/games/last`, { include_stats: includeStats || undefined }), { ttl: TTL.short }),
  /** The newest game on record (ongoing games included); `force` bypasses the cache for live polling. */
  latestGame: (id, force = false) => getJSON(u(`/players/${id}/games`, { limit: 1 }), { ttl: 30e3, force }).then(d => d.games?.[0] || null),
  game: (playerId, gameId) => getJSON(u(`/players/${playerId}/games/${gameId}`), { ttl: TTL.long }),

  // ----- leaderboards -----
  leaderboard: (key, params = {}) => getJSON(u(`/leaderboards/${key}`, params), { ttl: TTL.short }),

  // ----- games feed -----
  games: (params = {}) => getJSON(u('/games', params), { ttl: 30e3 }),

  // ----- aggregate stats -----
  stats: {
    civilizations: (lb, params = {}) => getJSON(u(`/stats/${lb}/civilizations`, params), { ttl: TTL.long }),
    matchups: (lb, params = {}) => getJSON(u(`/stats/${lb}/matchups`, params), { ttl: TTL.long }),
    maps: (lb, params = {}) => getJSON(u(`/stats/${lb}/maps`, params), { ttl: TTL.long }),
    map: (lb, mapId, params = {}) => getJSON(u(`/stats/${lb}/maps/${mapId}`, params), { ttl: TTL.long }),
    teams: (lb, params = {}) => getJSON(u(`/stats/${lb}/teams`, params), { ttl: TTL.long }),
  },
};

/** Fetch up to `maxPages` pages of a player's games and concatenate them. */
export async function fetchPlayerGames(id, params = {}, maxPages = 2) {
  const out = []; let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const d = await api.playerGames(id, { ...params, page });
    total = d.total_count ?? total;
    out.push(...(d.games || []));
    if (!d.next_page) break;
  }
  return { games: out, total };
}

/* ---------- Relic / World's Edge via local proxy ---------- */
let relicState = 'unknown'; // unknown | available | unavailable
export function relicAvailable() { return relicState !== 'unavailable'; }

async function relicGet(path, params) {
  if (relicState === 'unavailable') return null;
  const url = `${RELIC_PROXY}/${path}${qs({ title: 'age4', ...params })}`;
  try {
    const data = await getJSON(url, { ttl: TTL.short });
    if (data?.result && data.result.code !== 0) throw new ApiError(data.result.message || 'Relic error', 502, url);
    relicState = 'available';
    return data;
  } catch (e) {
    // 404/502 from the static server means no proxy; network errors mean file:// or offline.
    if (e instanceof ApiError && (e.status === 404 || e.status === 501 || e.status === 405)) relicState = 'unavailable';
    if (!(e instanceof ApiError)) relicState = 'unavailable';
    return null;
  }
}
export const relic = {
  availableLeaderboards: () => relicGet('leaderboard/getAvailableLeaderboards'),
  personalStat: ids => relicGet('leaderboard/getPersonalStat', { profile_ids: JSON.stringify(ids) }),
  leaderboard: (id, start = 1, count = 50, sortBy = 1) => relicGet('leaderboard/getLeaderBoard2', { leaderboard_id: id, platform: 'PC_STEAM', sortBy, start, count }),
  recentMatchHistory: ids => relicGet('leaderboard/getRecentMatchHistory', { profile_ids: JSON.stringify(ids) }),
};
