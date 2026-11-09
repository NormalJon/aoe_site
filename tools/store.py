"""SQLite store for the companion: AoE4 World game records, per-player per-game replay summaries, replay fetch
state and harvest progress. One file (cache/forge.sqlite), standard library only, a connection per operation so
the threaded server and the background harvester can share it (WAL mode).

Why a database: a replay is parsed once and every player's perspective of it is kept, so a game analysed for one
player never has to be fetched or parsed again for an opponent, a friend or a pro, and the compare/intel medians can
grow to hundreds of games per player without re-reading JSON blobs on every request."""
import json
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'cache'
DB_PATH = CACHE / 'forge.sqlite'

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS games (
    game_id INTEGER PRIMARY KEY, started_at TEXT, kind TEXT, map TEXT, map_id INTEGER, duration INTEGER, patch INTEGER,
    server TEXT, ongoing INTEGER, json TEXT NOT NULL, updated REAL);
CREATE INDEX IF NOT EXISTS games_started ON games(started_at);
CREATE TABLE IF NOT EXISTS game_players (
    game_id INTEGER, profile_id INTEGER, name TEXT, civ TEXT, team INTEGER, result TEXT, rating INTEGER, rating_diff INTEGER,
    PRIMARY KEY (game_id, profile_id));
CREATE INDEX IF NOT EXISTS gp_profile ON game_players(profile_id, game_id);
CREATE TABLE IF NOT EXISTS replays (
    game_id INTEGER PRIMARY KEY, status TEXT, path TEXT, attempts INTEGER DEFAULT 0, last_attempt REAL, duration REAL);
CREATE TABLE IF NOT EXISTS player_stats (
    game_id INTEGER, profile_id INTEGER, v INTEGER, started_at TEXT, civ TEXT, kind TEXT, json TEXT NOT NULL,
    PRIMARY KEY (game_id, profile_id));
CREATE INDEX IF NOT EXISTS ps_profile ON player_stats(profile_id, started_at);
CREATE TABLE IF NOT EXISTS mapgen (
    game_id INTEGER PRIMARY KEY, seed INTEGER, biome INTEGER, layout INTEGER, map_name TEXT, size INTEGER);
CREATE TABLE IF NOT EXISTS unmatched (
    game_id INTEGER, profile_id INTEGER, attempts INTEGER DEFAULT 0, last_attempt REAL, PRIMARY KEY (game_id, profile_id));
CREATE TABLE IF NOT EXISTS harvest (
    profile_id INTEGER PRIMARY KEY, state TEXT, message TEXT, pages INTEGER DEFAULT 0, games INTEGER DEFAULT 0,
    candidates INTEGER DEFAULT 0, done INTEGER DEFAULT 0, not_found INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
    started REAL, updated REAL, finished REAL);
CREATE TABLE IF NOT EXISTS official_matches (
    game_id INTEGER PRIMARY KEY, matchtype_id INTEGER, duration INTEGER, has_replay_urls INTEGER, fetched REAL);
CREATE TABLE IF NOT EXISTS counters (
    game_id INTEGER, profile_id INTEGER, json TEXT NOT NULL, PRIMARY KEY (game_id, profile_id));
CREATE INDEX IF NOT EXISTS counters_profile ON counters(profile_id, game_id);
"""

_init_lock = threading.Lock()
_ready = False


def connect():
    """A fresh connection (autocommit; WAL). Call sites use `with closing(connect()) as con:`."""
    global _ready
    CACHE.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA busy_timeout=30000')
    if not _ready:
        with _init_lock:
            if not _ready:
                con.execute('PRAGMA journal_mode=WAL')
                con.execute('PRAGMA synchronous=NORMAL')
                con.executescript(SCHEMA)
                _ready = True
                try:
                    migrate_from_json()   # before anything else writes, so the old caches never overwrite newer rows
                except Exception:  # noqa: BLE001
                    pass
    return con


def _chunks(items, n=500):
    items = list(items)
    for i in range(0, len(items), n):
        yield items[i:i + n]


def _players_of(game):
    for ti, t in enumerate(game.get('teams') or []):
        for x in t:
            p = x.get('player', x)
            yield ti, p


# ----------------------------------------------------------------------------- meta

def meta_get(key, default=None):
    with closing(connect()) as con:
        r = con.execute('SELECT value FROM meta WHERE key = ?', (key,)).fetchone()
    return r['value'] if r else default


def meta_set(key, value):
    with closing(connect()) as con:
        con.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', (key, str(value)))


# ----------------------------------------------------------------------------- games

def upsert_games(games):
    """Insert or refresh AoE4 World game records (list of API dicts) and their players."""
    games = [g for g in games if g and g.get('game_id')]
    if not games:
        return 0
    now = time.time()
    with closing(connect()) as con:
        con.execute('BEGIN')
        for g in games:
            con.execute('INSERT OR REPLACE INTO games (game_id, started_at, kind, map, map_id, duration, patch, server, ongoing, json, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                        (g['game_id'], g.get('started_at'), g.get('kind'), g.get('map'), g.get('map_id'), g.get('duration'), g.get('patch'), g.get('server'),
                         1 if g.get('ongoing') else 0, json.dumps(g, ensure_ascii=False), now))
            con.execute('DELETE FROM game_players WHERE game_id = ?', (g['game_id'],))
            for ti, p in _players_of(g):
                if p.get('profile_id') is None:
                    continue
                con.execute('INSERT OR REPLACE INTO game_players (game_id, profile_id, name, civ, team, result, rating, rating_diff) VALUES (?,?,?,?,?,?,?,?)',
                            (g['game_id'], p['profile_id'], p.get('name'), p.get('civilization'), ti, p.get('result'), p.get('rating'), p.get('rating_diff')))
        con.execute('COMMIT')
    return len(games)


def game(game_id):
    with closing(connect()) as con:
        r = con.execute('SELECT json FROM games WHERE game_id = ?', (int(game_id),)).fetchone()
    return json.loads(r['json']) if r else None


def games_for(profile_id, kinds=None, limit=None):
    """Every stored game record this player appears in, newest first."""
    sql = 'SELECT g.json FROM games g JOIN game_players p ON p.game_id = g.game_id WHERE p.profile_id = ?'
    args = [int(profile_id)]
    if kinds:
        sql += f" AND g.kind IN ({','.join('?' * len(kinds))})"
        args += list(kinds)
    sql += ' ORDER BY g.started_at DESC'
    if limit:
        sql += ' LIMIT ?'
        args.append(int(limit))
    with closing(connect()) as con:
        return [json.loads(r['json']) for r in con.execute(sql, args)]


def games_count(profile_id):
    with closing(connect()) as con:
        return con.execute('SELECT COUNT(*) FROM game_players WHERE profile_id = ?', (int(profile_id),)).fetchone()[0]


# ----------------------------------------------------------------------------- replays (fetch state)

def replay_get(game_id):
    with closing(connect()) as con:
        r = con.execute('SELECT * FROM replays WHERE game_id = ?', (int(game_id),)).fetchone()
    return dict(r) if r else None


def replay_set(game_id, status, path=None, duration=None):
    with closing(connect()) as con:
        con.execute('INSERT INTO replays (game_id, status, path, attempts, last_attempt, duration) VALUES (?,?,?,1,?,?) '
                    'ON CONFLICT(game_id) DO UPDATE SET status = excluded.status, path = COALESCE(excluded.path, replays.path), '
                    'attempts = replays.attempts + 1, last_attempt = excluded.last_attempt, duration = COALESCE(excluded.duration, replays.duration)',
                    (int(game_id), status, str(path) if path else None, time.time(), duration))


def replay_paths():
    """Every replay the store has a file for: [(game_id, status, path)], for re-analysis after a parser change."""
    with closing(connect()) as con:
        return [(r['game_id'], r['status'], r['path']) for r in con.execute('SELECT game_id, status, path FROM replays WHERE path IS NOT NULL ORDER BY game_id')]


def replays_for(game_ids):
    """Fetch state for many games in one query: {game_id: row dict}."""
    out = {}
    ids = [int(g) for g in game_ids]
    if not ids:
        return out
    with closing(connect()) as con:
        for chunk in _chunks(ids):
            for r in con.execute(f"SELECT * FROM replays WHERE game_id IN ({','.join('?' * len(chunk))})", chunk):
                out[r['game_id']] = dict(r)
    return out


def replays_status_counts():
    with closing(connect()) as con:
        return {r['status']: r['n'] for r in con.execute('SELECT status, COUNT(*) AS n FROM replays GROUP BY status')}


# ----------------------------------------------------------------------------- map generation (official match options)

def mapgen_set(game_id, seed=None, biome=None, layout=None, map_name=None, size=None):
    with closing(connect()) as con:
        con.execute('INSERT OR REPLACE INTO mapgen (game_id, seed, biome, layout, map_name, size) VALUES (?,?,?,?,?,?)',
                    (int(game_id), seed, biome, layout, map_name, size))


def mapgen_set_many(rows):
    """rows: iterable of dicts with game_id, seed, biome, layout, map_name, size. Existing rows are kept (seeds do not change)."""
    rows = list(rows)
    if not rows:
        return
    with closing(connect()) as con:
        con.execute('BEGIN')
        for m in rows:
            con.execute('INSERT OR IGNORE INTO mapgen (game_id, seed, biome, layout, map_name, size) VALUES (?,?,?,?,?,?)',
                        (int(m['game_id']), m.get('seed'), m.get('biome'), m.get('layout'), m.get('map_name'), m.get('size')))
        con.execute('COMMIT')


def mapgen_missing(game_ids):
    """The subset of `game_ids` that has no mapgen row yet."""
    ids = {int(g) for g in game_ids}
    if not ids:
        return set()
    have = set()
    with closing(connect()) as con:
        for chunk in _chunks(ids):
            have.update(r['game_id'] for r in con.execute(f"SELECT game_id FROM mapgen WHERE game_id IN ({','.join('?' * len(chunk))})", chunk))
    return ids - have


def mapgen_get(game_id):
    with closing(connect()) as con:
        r = con.execute('SELECT * FROM mapgen WHERE game_id = ?', (int(game_id),)).fetchone()
    return dict(r) if r else None


# ----------------------------------------------------------------------------- players a replay could not be matched to
# A replay's players carry display names, not ids; when neither the name nor civ+team pins an API player down, that
# (game, player) pair is recorded here. It is per player: the same replay may match everyone else in the game.

def unmatched_bump(game_id, profile_id):
    with closing(connect()) as con:
        con.execute('INSERT INTO unmatched (game_id, profile_id, attempts, last_attempt) VALUES (?,?,1,?) '
                    'ON CONFLICT(game_id, profile_id) DO UPDATE SET attempts = unmatched.attempts + 1, last_attempt = excluded.last_attempt',
                    (int(game_id), int(profile_id), time.time()))


def unmatched_clear(game_id, profile_ids):
    ids = [int(p) for p in profile_ids]
    if not ids:
        return
    with closing(connect()) as con:
        con.execute(f"DELETE FROM unmatched WHERE game_id = ? AND profile_id IN ({','.join('?' * len(ids))})", (int(game_id), *ids))


def unmatched_ids(profile_id, min_attempts=2):
    """Games whose replay has failed to match this player `min_attempts` times: not worth re-parsing on every call."""
    with closing(connect()) as con:
        return {r['game_id'] for r in con.execute('SELECT game_id FROM unmatched WHERE profile_id = ? AND attempts >= ?', (int(profile_id), int(min_attempts)))}


# ----------------------------------------------------------------------------- per-player per-game summaries

def stats_put(game_id, profile_id, summary):
    with closing(connect()) as con:
        con.execute('INSERT OR REPLACE INTO player_stats (game_id, profile_id, v, started_at, civ, kind, json) VALUES (?,?,?,?,?,?,?)',
                    (int(game_id), int(profile_id), summary.get('v') or 0, summary.get('started_at'), summary.get('civ'), summary.get('kind'), json.dumps(summary, ensure_ascii=False)))


def stats_put_many(rows, replace=True):
    """rows: iterable of (game_id, profile_id, summary). `replace=False` keeps rows that already exist (used by the import)."""
    rows = list(rows)
    if not rows:
        return
    verb = 'INSERT OR REPLACE' if replace else 'INSERT OR IGNORE'
    with closing(connect()) as con:
        con.execute('BEGIN')
        for gid, pid, s in rows:
            con.execute(f'{verb} INTO player_stats (game_id, profile_id, v, started_at, civ, kind, json) VALUES (?,?,?,?,?,?,?)',
                        (int(gid), int(pid), s.get('v') or 0, s.get('started_at'), s.get('civ'), s.get('kind'), json.dumps(s, ensure_ascii=False)))
        con.execute('COMMIT')


def stats_ids(profile_id):
    with closing(connect()) as con:
        return {r['game_id'] for r in con.execute('SELECT game_id FROM player_stats WHERE profile_id = ?', (int(profile_id),))}


def stats_for(profile_id, civ=None, kinds=None, limit=None):
    """Summaries for one player, newest first, optionally only as one civ and/or in some game kinds."""
    sql = 'SELECT json FROM player_stats WHERE profile_id = ?'
    args = [int(profile_id)]
    if civ:
        sql += ' AND civ = ?'
        args.append(civ)
    if kinds:
        sql += f" AND kind IN ({','.join('?' * len(kinds))})"
        args += list(kinds)
    sql += ' ORDER BY started_at DESC'
    if limit:
        sql += ' LIMIT ?'
        args.append(int(limit))
    with closing(connect()) as con:
        return [json.loads(r['json']) for r in con.execute(sql, args)]


def stats_count(profile_id=None):
    with closing(connect()) as con:
        if profile_id is None:
            return con.execute('SELECT COUNT(*) FROM player_stats').fetchone()[0]
        return con.execute('SELECT COUNT(*) FROM player_stats WHERE profile_id = ?', (int(profile_id),)).fetchone()[0]


# ----------------------------------------------------------------------------- harvest progress

HARVEST_FIELDS = ('state', 'message', 'pages', 'games', 'candidates', 'done', 'not_found', 'errors', 'started', 'updated', 'finished')


def harvest_get(profile_id):
    with closing(connect()) as con:
        r = con.execute('SELECT * FROM harvest WHERE profile_id = ?', (int(profile_id),)).fetchone()
    return dict(r) if r else None


def harvest_set(profile_id, **fields):
    fields = {k: v for k, v in fields.items() if k in HARVEST_FIELDS}
    fields['updated'] = time.time()
    cols = ', '.join(fields)
    with closing(connect()) as con:
        con.execute(f'INSERT INTO harvest (profile_id, {cols}) VALUES ({",".join("?" * (len(fields) + 1))}) '
                    f'ON CONFLICT(profile_id) DO UPDATE SET {", ".join(f"{k} = excluded.{k}" for k in fields)}',
                    (int(profile_id), *fields.values()))


def harvest_all():
    with closing(connect()) as con:
        return [dict(r) for r in con.execute('SELECT * FROM harvest ORDER BY updated DESC')]


# ----------------------------------------------------------------------------- overview

# ----------------------------------------------------------------------------- official counters (kept for good)

def official_put_many(matches):
    """matches: {game_id: {'duration', 'matchtype_id', 'has_replay_urls', 'players': {profile_id: counters row}}}, as
    replays.official_history builds them. The official API only holds the 10 most recent matches per match type, so
    everything seen is kept for good; existing rows are left alone (a finished match's counters do not change).
    Returns the number of counters rows written."""
    if not matches:
        return 0
    now, n = time.time(), 0
    with closing(connect()) as con:
        con.execute('BEGIN')
        for gid, m in matches.items():
            try:
                gid = int(gid)
            except (TypeError, ValueError):
                continue
            con.execute('INSERT OR IGNORE INTO official_matches (game_id, matchtype_id, duration, has_replay_urls, fetched) VALUES (?,?,?,?,?)',
                        (gid, m.get('matchtype_id'), m.get('duration'), 1 if m.get('has_replay_urls') else 0, now))
            for pid, row in (m.get('players') or {}).items():
                n += con.execute('INSERT OR IGNORE INTO counters (game_id, profile_id, json) VALUES (?,?,?)', (gid, int(pid), json.dumps(row))).rowcount
        con.execute('COMMIT')
    return n


def official_match(game_id):
    """One stored official match in official_history's shape (plus 'stored': True), or None."""
    with closing(connect()) as con:
        m = con.execute('SELECT * FROM official_matches WHERE game_id = ?', (int(game_id),)).fetchone()
        if not m:
            return None
        players = {r['profile_id']: json.loads(r['json']) for r in con.execute('SELECT profile_id, json FROM counters WHERE game_id = ?', (int(game_id),))}
    return {'duration': m['duration'], 'matchtype_id': m['matchtype_id'], 'players': players, 'has_replay_urls': bool(m['has_replay_urls']), 'stored': True}


def official_ids(game_ids):
    """The subset of `game_ids` with stored official counters."""
    ids = {int(g) for g in game_ids}
    have = set()
    if not ids:
        return have
    with closing(connect()) as con:
        for chunk in _chunks(ids):
            have.update(r['game_id'] for r in con.execute(f"SELECT game_id FROM official_matches WHERE game_id IN ({','.join('?' * len(chunk))})", chunk))
    return have


def counters_for(profile_id):
    """Every stored counters row of one player: [(game_id, row)], newest game id first."""
    with closing(connect()) as con:
        return [(r['game_id'], json.loads(r['json'])) for r in con.execute('SELECT game_id, json FROM counters WHERE profile_id = ? ORDER BY game_id DESC', (int(profile_id),))]


def summary():
    with closing(connect()) as con:
        games = con.execute('SELECT COUNT(*) FROM games').fetchone()[0]
        official = con.execute('SELECT COUNT(*) FROM official_matches').fetchone()[0]
        players = con.execute('SELECT COUNT(DISTINCT profile_id) FROM game_players').fetchone()[0]
        stats = con.execute('SELECT COUNT(*) FROM player_stats').fetchone()[0]
        stats_players = con.execute('SELECT COUNT(DISTINCT profile_id) FROM player_stats').fetchone()[0]
        oldest = con.execute('SELECT MIN(started_at) FROM player_stats').fetchone()[0]
        size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    return {'path': str(DB_PATH), 'size_bytes': size, 'games': games, 'players_seen': players, 'player_game_stats': stats,
            'players_with_stats': stats_players, 'oldest_analysed': oldest, 'official_matches': official, 'replays': replays_status_counts(), 'harvests': harvest_all()}


# ----------------------------------------------------------------------------- one-time import of the JSON caches

def migrate_from_json(cache_dir=CACHE):
    """Load the pre-database caches (cache/data/games_*.json lists, cache/analysis/profile_*.json stores) once."""
    if meta_get('migrated_json') == '1':
        return None
    imported = {'games': 0, 'stats': 0, 'missing': 0}
    for f in sorted((cache_dir / 'data').glob('games_*.json')):
        try:
            games = json.loads(f.read_text(encoding='utf-8'))
            imported['games'] += upsert_games([g for g in games if g and g.get('game_id') and game(g['game_id']) is None])   # only games the store has not seen
        except Exception:  # noqa: BLE001
            pass
    for f in sorted((cache_dir / 'analysis').glob('profile_*.json')):
        try:
            pid = int(f.stem.split('_')[1])
            st = json.loads(f.read_text(encoding='utf-8'))
        except Exception:  # noqa: BLE001
            continue
        stats_put_many(((int(gid), pid, s) for gid, s in (st.get('analysed') or {}).items()), replace=False)   # never overwrite rows the store already has
        imported['stats'] += len(st.get('analysed') or {})
        for gid, m in (st.get('missing') or {}).items():
            status = m.get('status') or 'error'
            if status == 'not_found' and (replay_get(gid) or {}).get('status') not in ('local', 'cached', 'downloaded'):
                replay_set(gid, 'not_found')
                imported['missing'] += 1
    meta_set('migrated_json', '1')
    meta_set('migrated_at', time.time())
    return imported
