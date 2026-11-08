// Static game knowledge: civilizations, leaderboards, rank tiers, official API ids.

export const API_BASE = 'https://aoe4world.com/api/v0';
// Where the full site (static files + server.py companion) is deployed. Static-only hosts such as GitHub Pages
// link here from the features that need the companion. Leave empty until a hosted companion exists.
export const FULL_SITE_URL = '';
export const RELIC_PROXY = 'relic'; // served by server.py; relative so it works under any mount path
export const CURRENT_SEASON_FALLBACK = 14;

export const CIVS = {
  abbasid_dynasty:    { name: 'Abbasid Dynasty',    short: 'Abbasid' },
  ayyubids:           { name: 'Ayyubids',           short: 'Ayyubids' },
  byzantines:         { name: 'Byzantines',         short: 'Byzantines' },
  chinese:            { name: 'Chinese',            short: 'Chinese' },
  delhi_sultanate:    { name: 'Delhi Sultanate',    short: 'Delhi' },
  english:            { name: 'English',            short: 'English' },
  french:             { name: 'French',             short: 'French' },
  golden_horde:       { name: 'Golden Horde',       short: 'G. Horde' },
  holy_roman_empire:  { name: 'Holy Roman Empire',  short: 'HRE' },
  house_of_lancaster: { name: 'House of Lancaster', short: 'Lancaster' },
  japanese:           { name: 'Japanese',           short: 'Japanese' },
  jeanne_darc:        { name: "Jeanne d'Arc",       short: 'Jeanne' },
  jin_dynasty:        { name: 'Jin Dynasty',        short: 'Jin' },
  knights_templar:    { name: 'Knights Templar',    short: 'Templar' },
  macedonian_dynasty: { name: 'Macedonian Dynasty', short: 'Macedonian' },
  malians:            { name: 'Malians',            short: 'Malians' },
  mongols:            { name: 'Mongols',            short: 'Mongols' },
  order_of_the_dragon:{ name: 'Order of the Dragon',short: 'Dragon' },
  ottomans:           { name: 'Ottomans',           short: 'Ottomans' },
  rus:                { name: 'Rus',                short: 'Rus' },
  scots:              { name: 'Scots',              short: 'Scots' },
  sengoku_daimyo:     { name: 'Sengoku Daimyo',     short: 'Sengoku' },
  tughlaq_dynasty:    { name: 'Tughlaq Dynasty',    short: 'Tughlaq' },
  vikings:            { name: 'Vikings',            short: 'Vikings' },
  zhu_xis_legacy:     { name: "Zhu Xi's Legacy",    short: 'Zhu Xi' },
};

export function civName(id) { return CIVS[id]?.name ?? humanize(id); }
export function civShort(id) { return CIVS[id]?.short ?? humanize(id); }
export function civFlag(id) { return CIVS[id] ? `assets/flags/${id}.png` : 'assets/flags/_unknown.svg'; }

export function humanize(s) {
  if (!s) return '—';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Public leaderboards (aoe4world keys) and how they map to other endpoints.
export const LEADERBOARDS = [
  { key: 'rm_solo', name: 'Solo Ranked',     short: 'Solo RM',  team: false, ranked: true,  kinds: ['rm_1v1'],                        statsKey: 'rm_solo' },
  { key: 'rm_team', name: 'Team Ranked',     short: 'Team RM',  team: true,  ranked: true,  kinds: ['rm_2v2', 'rm_3v3', 'rm_4v4'],   statsKey: 'rm_2v2' },
  { key: 'qm_1v1',  name: 'Quick Match 1v1', short: 'QM 1v1',   team: false, ranked: false, kinds: ['qm_1v1'],                        statsKey: 'qm_1v1' },
  { key: 'qm_2v2',  name: 'Quick Match 2v2', short: 'QM 2v2',   team: true,  ranked: false, kinds: ['qm_2v2'],                        statsKey: 'qm_2v2' },
  { key: 'qm_3v3',  name: 'Quick Match 3v3', short: 'QM 3v3',   team: true,  ranked: false, kinds: ['qm_3v3'],                        statsKey: 'qm_3v3' },
  { key: 'qm_4v4',  name: 'Quick Match 4v4', short: 'QM 4v4',   team: true,  ranked: false, kinds: ['qm_4v4'],                        statsKey: 'qm_4v4' },
];
export const LB = Object.fromEntries(LEADERBOARDS.map(l => [l.key, l]));

// Extra per-profile modes that are not public leaderboards (hidden all-time ELO / MMR).
export const PROFILE_MODES = [
  ...LEADERBOARDS,
  { key: 'rm_1v1_elo', name: '1v1 Ranked ELO (all-time)', short: '1v1 ELO', team: false, ranked: true, hidden: true },
  { key: 'rm_2v2_elo', name: '2v2 Ranked ELO (all-time)', short: '2v2 ELO', team: true,  ranked: true, hidden: true },
  { key: 'rm_3v3_elo', name: '3v3 Ranked ELO (all-time)', short: '3v3 ELO', team: true,  ranked: true, hidden: true },
  { key: 'rm_4v4_elo', name: '4v4 Ranked ELO (all-time)', short: '4v4 ELO', team: true,  ranked: true, hidden: true },
];
export const MODE = Object.fromEntries(PROFILE_MODES.map(m => [m.key, m]));
export function modeName(key) { return MODE[key]?.name ?? humanize(key); }
export function modeShort(key) { return MODE[key]?.short ?? humanize(key); }

// Game "kind" values seen in match data.
export const KIND_NAMES = {
  rm_1v1: 'Ranked 1v1', rm_2v2: 'Ranked 2v2', rm_3v3: 'Ranked 3v3', rm_4v4: 'Ranked 4v4',
  qm_1v1: 'QM 1v1', qm_2v2: 'QM 2v2', qm_3v3: 'QM 3v3', qm_4v4: 'QM 4v4',
  custom: 'Custom', ffa: 'FFA',
};
export function kindName(k) { return KIND_NAMES[k] ?? humanize(k); }

// Which stats endpoints exist per leaderboard key (from the aoe4world API docs).
export const STATS_SUPPORT = {
  rm_solo: { civilizations: true, matchups: true,  maps: true,  teams: false, rankLevel: true },
  qm_1v1:  { civilizations: true, matchups: true,  maps: true,  teams: false, rankLevel: false },
  rm_2v2:  { civilizations: true, matchups: false, maps: true,  teams: false, rankLevel: true },
  qm_2v2:  { civilizations: true, matchups: false, maps: false, teams: true,  rankLevel: false },
  qm_3v3:  { civilizations: true, matchups: false, maps: false, teams: true,  rankLevel: false },
  qm_4v4:  { civilizations: true, matchups: false, maps: false, teams: false, rankLevel: false },
};
export const STATS_LB_NAMES = {
  rm_solo: 'Solo Ranked', rm_2v2: 'Team Ranked 2v2', qm_1v1: 'Quick Match 1v1',
  qm_2v2: 'Quick Match 2v2', qm_3v3: 'Quick Match 3v3', qm_4v4: 'Quick Match 4v4',
};

export const RANK_LEVEL_FILTERS = [
  { value: '', label: 'All ranks' },
  { value: 'bronze', label: 'Bronze' }, { value: 'silver', label: 'Silver' }, { value: 'gold', label: 'Gold' },
  { value: 'platinum', label: 'Platinum' }, { value: 'diamond', label: 'Diamond' }, { value: 'conqueror', label: 'Conqueror' },
  { value: '≤silver', label: 'Silver and below' }, { value: '≥gold', label: 'Gold and above' },
  { value: '≥platinum', label: 'Platinum and above' }, { value: '≥diamond', label: 'Diamond and above' },
  { value: '≥conqueror', label: 'Conqueror and above' }, { value: '≥conqueror_4', label: 'Conqueror IV' },
];
export const RATING_FILTERS = [
  { value: '', label: 'All ratings' },
  { value: '>800', label: 'Above 800' }, { value: '>1000', label: 'Above 1000' }, { value: '>1200', label: 'Above 1200' },
  { value: '>1400', label: 'Above 1400' }, { value: '>1600', label: 'Above 1600' },
];

// Rank tiers
export const TIERS = ['unranked', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'conqueror'];
const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
export function parseRankLevel(level) {
  if (!level || level === 'unranked') return { tier: 'unranked', div: 0, label: 'Unranked', short: '—' };
  const m = /^([a-z]+)_(\d)$/.exec(level);
  if (!m) return { tier: level, div: 0, label: humanize(level), short: humanize(level) };
  const tier = m[1], div = +m[2];
  const t = tier.charAt(0).toUpperCase() + tier.slice(1);
  return { tier, div, label: `${t} ${ROMAN[div] ?? div}`, short: `${t.slice(0, 1)}${ROMAN[div] ?? div}` };
}

// World's Edge (Relic) community API ids — observed from getAvailableLeaderboards.
export const RELIC_LEADERBOARD_NAMES = {
  0: 'Custom', 1: '1v1 Ranked (ELO)', 2: '2v2 Ranked (ELO)', 3: '3v3 Ranked (ELO)', 4: '4v4 Ranked (ELO)',
  17: 'Quick Match 1v1', 18: 'Quick Match 2v2', 19: 'Quick Match 3v3', 20: 'Quick Match 4v4',
  206: '1v1 Ranked (console)', 207: 'QM 1v1 (console)', 212: '2v2 Ranked (console)', 213: 'QM 2v2 (console)',
  218: '3v3 Ranked (console)', 219: 'QM 3v3 (console)', 224: '4v4 Ranked (console)', 225: 'QM 4v4 (console)',
  479: 'Empire Wars 1v1', 484: 'Empire Wars 2v2', 489: 'Empire Wars 3v3', 494: 'Empire Wars 4v4', 533: 'FFA',
};
export const RELIC_MATCHTYPE_NAMES = {
  0: 'Custom', 1: 'Ranked 1v1', 2: 'Ranked 2v2', 3: 'Ranked 3v3', 4: 'Ranked 4v4',
  20: 'QM 1v1', 21: 'QM 2v2', 22: 'QM 3v3', 23: 'QM 4v4',
  668: 'QM 1v1', 667: 'QM 2v2', 666: 'QM 3v3', 665: 'QM 4v4',
};

// Handy profiles for quick links on the home page (ids verified against the API).
export const SAMPLE_PLAYERS = [
  { id: 8139502, name: 'Beasty' },
  { id: 8354416, name: 'EL.loueMT' },
  { id: 6000037, name: 'Lusky the Husky' },
];

export const CHART_SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
