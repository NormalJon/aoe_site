// Tournament draft engine. Pure: a draft is a config plus an ordered log of actions, and `reduce()` turns them
// into the state the page shows. The hot-seat mode keeps the log in localStorage, the shared mode on the companion
// (tools/draft.py), which only stores and orders actions; every browser derives the same state from the same log.
//
// Flow: draft phase (the script: alternating map bans / map picks / civ bans / civ pool picks between the two
// sides) → games. Before each game the loser of the previous game picks the map (game 1: the first map picked in
// the draft, or a coin flip when the script picks no maps), both players pick two civilizations blind, then each
// removes ("snipes") one of the opponent's two blind; each plays the civ that is left. A result ends the game.
import { CIVS } from './constants.js';

export const MAPS = ['Dry Arabia', 'Gorge', 'Flankwoods', 'Himeyama', 'King of the Hill', 'Forts', 'Hill and Dale', 'Ancient Spires', 'Baltic',
  'Lipany', 'Golden Heights', 'Four Lakes', 'French Pass', 'Kerlaugar', 'Rocky River', 'Cliffside', 'Carmel', 'Waterholes', 'Prairie',
  'Mountain Pass', 'Hidden Valley', 'Mongolian Heights', 'Black Forest', 'Boulder Bay', 'Altai', 'Danube River', 'Confluence', 'Thickets',
  'Holy Island', 'Nagari', 'Marshland', 'Glade', 'Relic River', 'Enlightened Horizon'];
export const DEFAULT_POOL = MAPS.slice(0, 9);
export const CIV_IDS = Object.keys(CIVS);

export const STEP_LABEL = {
  map_ban: 'Map ban', map_pick: 'Map pick', civ_ban: 'Civ ban', civ_pick: 'Civ pool pick',
  game_map: 'Map', game_civs: 'Two civs', game_snipe: 'Snipe', game_result: 'Result',
};
export const DRAFT_TYPES = ['map_ban', 'map_pick', 'civ_ban', 'civ_pick'];

/* ---------- presets: the draft script, as text so it can be edited by hand ---------- */
export const PRESETS = [
  { key: 'bo3', label: 'Best of 3', bestOf: 3, blurb: '2 map bans each, 2 map picks each (4 maps for 3 games), 2 civ bans each.',
    script: 'map_ban:a map_ban:b map_ban:a map_ban:b map_pick:a map_pick:b map_pick:a map_pick:b civ_ban:a civ_ban:b civ_ban:a civ_ban:b' },
  { key: 'bo5', label: 'Best of 5', bestOf: 5, blurb: '1 map ban each, 3 map picks each (6 maps for 5 games), 2 civ bans each.',
    script: 'map_ban:a map_ban:b map_pick:a map_pick:b map_pick:a map_pick:b map_pick:a map_pick:b civ_ban:a civ_ban:b civ_ban:a civ_ban:b' },
  { key: 'bo7', label: 'Best of 7', bestOf: 7, blurb: '1 map ban each, no map picks (the 7 maps left are the pool and a coin flip decides who picks the game-1 map), 3 civ bans each.',
    script: 'map_ban:a map_ban:b civ_ban:a civ_ban:b civ_ban:a civ_ban:b civ_ban:a civ_ban:b' },
  { key: 'pools', label: 'Bo5 · civ pools', bestOf: 5, blurb: 'Like best of 5, then each player picks a pool of 4 civs; per game the two civs come from your pool.',
    script: 'map_ban:a map_ban:b map_pick:a map_pick:b map_pick:a map_pick:b map_pick:a map_pick:b civ_ban:a civ_ban:b civ_ban:a civ_ban:b civ_pick:a civ_pick:b civ_pick:a civ_pick:b civ_pick:a civ_pick:b civ_pick:a civ_pick:b' },
];
export const PRESET = Object.fromEntries(PRESETS.map(p => [p.key, p]));

/** "map_ban:a map_pick:b …" → [{type, by}]. Throws with a readable message. */
export function parseScript(text) {
  const steps = [];
  for (const tok of String(text || '').trim().split(/[\s,]+/).filter(Boolean)) {
    const [type, by] = tok.split(':');
    if (!DRAFT_TYPES.includes(type)) throw new Error(`unknown step "${tok}" — use ${DRAFT_TYPES.join(', ')} with :a or :b`);
    if (by !== 'a' && by !== 'b') throw new Error(`step "${tok}" needs a side: ${type}:a or ${type}:b`);
    steps.push({ type, by });
  }
  return steps;
}
export const scriptText = steps => steps.map(s => `${s.type}:${s.by}`).join(' ');

/* ---------- seed / coin ---------- */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCode(n = 10) {
  let a = new Uint8Array(n);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(a); else a = a.map(() => Math.floor(Math.random() * 256));
  return Array.from(a, x => ALPHABET[x % ALPHABET.length]).join('');
}
export function hashSeed(str) {   // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** Deterministic coin from the seed, so every browser in a shared draft agrees. */
export const coin = (seed, salt = '') => ((hashSeed(`${seed}|${salt}`) >>> 7) & 1 ? 'b' : 'a');

/* ---------- config ---------- */
export function makeConfig({ preset = 'bo3', bestOf, script, mapPool, names, seed, first = 'coin', title } = {}) {
  const p = PRESET[preset] || PRESETS[0];
  const steps = parseScript(script ?? p.script);
  const pool = [...new Set((mapPool || DEFAULT_POOL).map(m => String(m).trim()).filter(Boolean))];
  const bo = Number(bestOf || p.bestOf);
  if (!(bo >= 1 && bo <= 15) || bo % 2 === 0) throw new Error('best-of must be an odd number from 1 to 15');
  const bans = steps.filter(s => s.type === 'map_ban').length, picks = steps.filter(s => s.type === 'map_pick').length;
  if (pool.length < 2) throw new Error('the map pool needs at least two maps');
  if (bans + picks > pool.length) throw new Error(`the script bans or picks ${bans + picks} maps but the pool has ${pool.length}`);
  if (pool.length - bans < 1) throw new Error('the bans would empty the map pool');
  const civBans = steps.filter(s => s.type === 'civ_ban').length;
  const poolPicks = { a: steps.filter(s => s.type === 'civ_pick' && s.by === 'a').length, b: steps.filter(s => s.type === 'civ_pick' && s.by === 'b').length };
  if (civBans + poolPicks.a + poolPicks.b > CIV_IDS.length - 2) throw new Error('too many civ bans and pool picks for the number of civilizations');
  for (const s of ['a', 'b']) if (poolPicks[s] === 1) throw new Error('a civ pool needs at least two civs (each game needs two picks)');
  if (!['a', 'b', 'coin'].includes(first)) throw new Error('first must be a, b or coin');
  return {
    v: 1, title: String(title || '').slice(0, 60), preset: PRESET[preset] && scriptText(steps) === p.script && bo === p.bestOf ? preset : 'custom', bestOf: bo, script: steps, mapPool: pool,
    names: { a: String(names?.a || 'Player 1').slice(0, 24), b: String(names?.b || 'Player 2').slice(0, 24) },
    seed: String(seed || newCode()), first, created: new Date().toISOString(),
  };
}
export const needWins = config => Math.floor(config.bestOf / 2) + 1;
export const other = side => (side === 'a' ? 'b' : 'a');

/* ---------- state ---------- */
function initial(config) {
  const first = config.first === 'coin' ? coin(config.seed, 'first') : config.first;
  const script = config.script.map(s => ({ type: s.type, by: first === 'a' ? s.by : other(s.by) }));
  const st = {
    config, first, script, index: 0, phase: 'draft', names: { ...config.names },
    mapBans: { a: [], b: [] }, mapPicks: [], civBans: { a: [], b: [] }, pools: { a: [], b: [] },
    games: [], current: null, score: { a: 0, b: 0 }, winner: null, step: null, log: [], skipped: [],
  };
  if (!script.length) startGame(st); else st.step = computeStep(st);
  return st;
}
/** Maps still open in the draft phase (not banned, not picked). */
export const openMaps = st => st.config.mapPool.filter(m => !st.mapBans.a.includes(m) && !st.mapBans.b.includes(m) && !st.mapPicks.some(p => p.map === m));
/** The maps the series is played on: the picked maps, or everything that survived the bans. */
export const seriesMaps = st => (st.mapPicks.length ? st.mapPicks.map(p => p.map) : st.config.mapPool.filter(m => !st.mapBans.a.includes(m) && !st.mapBans.b.includes(m)));
/** Maps the next game may be played on: unplayed series maps, or the whole series pool once every map has been played. */
export function availableMaps(st) {
  const pool = seriesMaps(st), played = st.games.map(g => g.map);
  const left = pool.filter(m => !played.includes(m));
  return left.length ? left : pool;
}
export const isBanned = (st, civ) => st.civBans.a.includes(civ) || st.civBans.b.includes(civ);
export const bannedBy = (st, civ) => (st.civBans.a.includes(civ) ? 'a' : st.civBans.b.includes(civ) ? 'b' : null);
/** May `side` bring `civ` to a game? Not banned, and inside the side's pool when the draft built one. */
export const civAllowed = (st, side, civ) => !!CIVS[civ] && !isBanned(st, civ) && (!st.pools[side].length || st.pools[side].includes(civ));
export const civsFor = (st, side) => CIV_IDS.filter(c => civAllowed(st, side, c));
/** The civ `side` plays in game g once the opponent has sniped: the one of the pair that was not removed. */
export const playing = (g, side) => (g.civs[side] && g.snipes[other(side)] ? g.civs[side].find(c => c !== g.snipes[other(side)]) ?? null : null);

function startGame(st) {
  const n = st.games.length + 1;
  const g = { n, map: null, mapBy: null, mapWhy: '', stage: 'map', civs: { a: null, b: null }, snipes: { a: null, b: null }, winner: null };
  if (n === 1 && st.mapPicks.length) {
    g.map = st.mapPicks[0].map; g.mapBy = st.mapPicks[0].by; g.mapWhy = 'first map picked in the draft'; g.stage = 'civs';
  } else {
    const avail = availableMaps(st);
    if (n === 1) { g.mapBy = coin(st.config.seed, 'game1'); g.mapWhy = 'coin flip'; } else { const prev = st.games[n - 2]; g.mapBy = other(prev.winner); g.mapWhy = `lost game ${n - 1}`; }
    if (avail.length === 1) { g.map = avail[0]; g.mapWhy += ' · the last map in the pool'; g.stage = 'civs'; }
  }
  st.current = g; st.phase = 'games'; st.step = computeStep(st);
}
function computeStep(st) {
  if (st.phase === 'draft') { const s = st.script[st.index]; return { type: s.type, by: s.by, waiting: [s.by], index: st.index }; }
  if (st.phase === 'games') {
    const g = st.current;
    if (g.stage === 'map') return { type: 'game_map', by: g.mapBy, waiting: [g.mapBy], game: g.n };
    if (g.stage === 'civs') return { type: 'game_civs', by: 'both', waiting: ['a', 'b'].filter(s => !g.civs[s]), game: g.n };
    if (g.stage === 'snipe') return { type: 'game_snipe', by: 'both', waiting: ['a', 'b'].filter(s => !g.snipes[s]), game: g.n };
    return { type: 'game_result', by: 'both', waiting: ['a', 'b'], game: g.n };
  }
  return null;
}

/** null when `action` is legal in `st`, else why not. Actions: {t, side, value}. */
export function check(st, action) {
  if (!action || (action.side !== 'a' && action.side !== 'b')) return 'the action names no side';
  if (action.t === 'name') return typeof action.value === 'string' && action.value.trim() && action.value.length <= 24 ? null : 'a name is 1–24 characters';
  const s = st.step;
  if (!s) return 'the series is over';
  if (action.t !== s.type) return `the next step is ${STEP_LABEL[s.type] || s.type}, not ${STEP_LABEL[action.t] || action.t}`;
  if (s.by !== 'both' && action.side !== s.by) return `it is ${st.names[s.by]}'s turn`;
  const v = action.value, g = st.current;
  switch (action.t) {
    case 'map_ban': case 'map_pick': return openMaps(st).includes(v) ? null : 'that map is not open';
    case 'civ_ban':
      if (!CIVS[v]) return 'unknown civilization';
      if (isBanned(st, v)) return 'already banned';
      if (st.pools.a.includes(v) || st.pools.b.includes(v)) return 'already picked into a pool';
      return null;
    case 'civ_pick':
      if (!CIVS[v]) return 'unknown civilization';
      if (isBanned(st, v)) return 'that civilization is banned';
      if (st.pools[action.side].includes(v)) return 'already in your pool';
      return null;
    case 'game_map': return availableMaps(st).includes(v) ? null : 'that map is not available for this game';
    case 'game_civs': {
      if (g.civs[action.side]) return 'you have already picked for this game';
      if (!Array.isArray(v) || v.length !== 2 || v[0] === v[1]) return 'pick two different civilizations';
      for (const c of v) if (!civAllowed(st, action.side, c)) return `${CIVS[c]?.name || c} is not available to you`;
      return null;
    }
    case 'game_snipe': {
      if (!s.waiting.includes(action.side)) return 'you have already sniped';
      const pair = g.civs[other(action.side)] || [];
      return pair.includes(v) ? null : "pick one of the opponent's two civilizations";
    }
    case 'game_result': return v === 'a' || v === 'b' ? null : 'the result names the winner, a or b';
    default: return `unknown action ${action.t}`;
  }
}

function apply(st, action) {
  const { t, side, value } = action, nm = st.names;
  const say = text => st.log.push({ side, text });
  if (t === 'name') { say(`${nm[side]} is now called ${value.trim()}`); nm[side] = value.trim(); return; }
  if (st.phase === 'draft') {
    if (t === 'map_ban') { st.mapBans[side].push(value); say(`${nm[side]} banned ${value}`); }
    else if (t === 'map_pick') { st.mapPicks.push({ map: value, by: side }); say(`${nm[side]} picked ${value}`); }
    else if (t === 'civ_ban') { st.civBans[side].push(value); say(`${nm[side]} banned ${CIVS[value].name}`); }
    else if (t === 'civ_pick') { st.pools[side].push(value); say(`${nm[side]} added ${CIVS[value].name} to their pool`); }
    st.index++;
    if (st.index >= st.script.length) { say('Draft complete'); startGame(st); } else st.step = computeStep(st);
    return;
  }
  const g = st.current;
  if (t === 'game_map') { g.map = value; g.stage = 'civs'; say(`${nm[side]} picked ${value} for game ${g.n}`); }
  else if (t === 'game_civs') { g.civs[side] = [...value]; if (g.civs.a && g.civs.b) { g.stage = 'snipe'; say(`Game ${g.n}: both pairs are in — ${nm.a}: ${g.civs.a.map(c => CIVS[c].name).join(' + ')}; ${nm.b}: ${g.civs.b.map(c => CIVS[c].name).join(' + ')}`); } }
  else if (t === 'game_snipe') {
    g.snipes[side] = value;
    if (g.snipes.a && g.snipes.b) { g.stage = 'result'; say(`Game ${g.n}: ${nm.a} sniped ${CIVS[g.snipes.a].name}, ${nm.b} sniped ${CIVS[g.snipes.b].name} — ${nm.a} plays ${CIVS[playing(g, 'a')].name}, ${nm.b} plays ${CIVS[playing(g, 'b')].name}`); }
  } else if (t === 'game_result') {
    g.winner = value; g.played = { a: playing(g, 'a'), b: playing(g, 'b') };
    st.games.push(g); st.current = null; st.score[value]++;
    say(`Game ${g.n} on ${g.map}: ${nm[value]} won (${st.score.a}–${st.score.b})`);
    if (st.score[value] >= needWins(st.config)) { st.phase = 'done'; st.winner = value; st.step = null; say(`${nm[value]} wins the series ${st.score.a}–${st.score.b}`); }
    else startGame(st);
    return;
  }
  st.step = computeStep(st);
}

/** Derive the full state from the config and the action log. Illegal actions are skipped and listed in `skipped`. */
export function reduce(config, actions = []) {
  const st = initial(config);
  actions.forEach((a, i) => { const err = check(st, a); if (err) st.skipped.push({ i, action: a, err }); else apply(st, a); });
  return st;
}

/** Timeline entries for the page: every draft step and, for the games, the four stages of each game played or in play. */
export function timeline(st) {
  const items = st.script.map((s, i) => {
    const done = i < st.index;
    let value = null;
    if (done) {
      const nth = st.script.slice(0, i).filter(x => x.type === s.type && x.by === s.by).length;
      value = s.type === 'map_ban' ? st.mapBans[s.by][nth] : s.type === 'civ_ban' ? st.civBans[s.by][nth] : s.type === 'civ_pick' ? st.pools[s.by][nth]
        : st.mapPicks.filter(p => p.by === s.by)[nth]?.map;
    }
    return { group: s.type, type: s.type, side: s.by, done, now: st.phase === 'draft' && i === st.index, value };
  });
  const games = [...st.games, ...(st.current ? [st.current] : [])];
  for (const g of games) {
    const stages = ['map', 'civs', 'snipe', 'result'];
    const at = g.winner ? 4 : stages.indexOf(g.stage);
    stages.forEach((stg, k) => items.push({ group: `game${g.n}`, game: g.n, type: `game_${stg}`, side: stg === 'map' ? g.mapBy : 'both', done: k < at, now: k === at && !st.winner, value: stg === 'map' ? g.map : stg === 'result' ? g.winner : null }));
  }
  return items;
}
