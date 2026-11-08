"""Forge local companion: finds replays, fetches official ones, analyses games and applies tags.

Data sources merged per game:
  * AoE4 World API      — who played, civs, ratings, result, map (always available)
  * World's Edge API    — official per-player counters (units produced / killed / lost, buildings, upgrades,
                          commands, rating before/after) for the player's recent ~60 matches, and signed
                          replay download links via getReplayFiles
  * replay files        — the command log: every unit trained, building placed and technology researched,
                          with timestamps, for every player in the match

Everything cached under ./cache (gitignored). Usage from the CLI:
    py -3 -m tools.replays list                 # my games with data availability
    py -3 -m tools.replays analyze 254628514    # full detail for one game (fetching the replay if needed)
    py -3 -m tools.replays scan                 # (re)scan local replay folders and analyse them
"""
import gzip
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

try:
    from . import aoe4rec
except ImportError:  # run as a script
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import aoe4rec

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'cache'
for sub in ('data', 'replays', 'analysis'):
    (CACHE / sub).mkdir(parents=True, exist_ok=True)

UA = 'Forge-AoE4-prototype/0.1 (local companion)'
A4W = 'https://aoe4world.com/api/v0/'
WE = 'https://aoe-api.worldsedgelink.com/community/'
DATA = 'https://data.aoe4world.com/'
GZIP_MAGIC = bytes([0x1F, 0x8B])
_lock = threading.Lock()

# ----------------------------------------------------------------------------- config

DEFAULT_CONFIG = {
    'me': None,
    'friends': [],
    'replay_dirs': ['auto'],
    'max_game_pages': 20,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    p = ROOT / 'forge.local.json'
    if p.exists():
        try:
            cfg.update(json.loads(p.read_text(encoding='utf-8')))
        except Exception as e:  # noqa: BLE001
            cfg['config_error'] = str(e)
    return cfg


def replay_dirs(cfg):
    dirs = []
    for d in cfg.get('replay_dirs') or ['auto']:
        if d == 'auto':
            home = Path(os.environ.get('USERPROFILE') or Path.home())
            for base in (home / 'Documents' / 'My Games' / 'Age of Empires IV', home / 'OneDrive' / 'Documents' / 'My Games' / 'Age of Empires IV'):
                if base.exists():
                    dirs += [base / 'network', base / 'playback']
                    dirs += [p for p in (base / 'matchhistory').glob('*') if p.is_dir()]
        else:
            dirs.append(Path(d))
    return [d for d in dirs if d.exists()]


# ----------------------------------------------------------------------------- http + caches

def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def cached_json(name, url, ttl):
    p = CACHE / 'data' / f'{name}.json'
    if p.exists() and time.time() - p.stat().st_mtime < ttl:
        try:
            return json.loads(p.read_text(encoding='utf-8'))
        except Exception:  # noqa: BLE001
            pass
    data = json.loads(http_get(url))
    p.write_text(json.dumps(data), encoding='utf-8')
    return data


# ----------------------------------------------------------------------------- blueprints

class Blueprints:
    """pbgid -> {name, kind, role, classes} from aoe4world's static data."""

    def __init__(self):
        self.by_id = {}
        for kind, path in (('unit', 'units/all.json'), ('building', 'buildings/all.json'), ('tech', 'technologies/all.json')):
            data = cached_json(path.replace('/', '_').replace('.json', ''), DATA + path, 7 * 86400)
            for it in data.get('data', []):
                pb = it.get('pbgid')
                if not isinstance(pb, int):
                    continue
                classes = set(it.get('classes') or [])
                role = self._role(kind, it.get('name') or '', classes)
                age_target = None  # the age this building/tech takes its owner to
                if role == 'landmark':
                    age_target = {'wonder_dark_age': 2, 'wonder_feudal_age': 3, 'wonder_castle_age': 4}.get(next((c for c in classes if c.startswith('wonder_') and c.endswith('_age')), None))
                elif role == 'age_up' and isinstance(it.get('age'), int) and it['age'] < 4:
                    age_target = it['age'] + 1  # a wing researched in Imperial is not an age-up
                costs = it.get('costs') or {}
                self.by_id.setdefault(pb, {'name': it.get('name'), 'base': self.base_name(it.get('name') or ''), 'kind': kind, 'classes': sorted(classes), 'role': role, 'age': it.get('age'), 'age_target': age_target,
                                           'icon': it.get('icon'), 'costs': {k: int(costs.get(k) or 0) for k in ('food', 'wood', 'gold', 'stone')}})

    TIER_PREFIXES = ('Early ', 'Veteran ', 'Elite ', 'Hardened ')

    @classmethod
    def base_name(cls, name):
        for pre in cls.TIER_PREFIXES:
            if name.startswith(pre):
                return name[len(pre):]
        return name

    @staticmethod
    def _role(kind, name, cl):
        if kind == 'unit':
            if 'villager' in cl or 'instant_drop_off_unit' in cl:   # the latter: Viking Bondi, worker-warriors
                return 'villager'
            if 'trade_cart' in cl or 'trader' in name.lower():
                return 'trader'
            if 'non_aggressive' in cl:                                # fishing boats, trade ships, cattle
                return 'civilian'
            if 'monk' in cl or 'religious' in cl:
                return 'monk'
            if 'scout' in cl:
                return 'scout'
            if 'naval_unit' in cl or 'ship' in cl:
                return 'naval'
            if 'siege' in cl:
                return 'siege'
            if 'cavalry' in cl:
                return 'cavalry'
            if 'ranged' in cl:
                return 'ranged'
            if 'infantry' in cl or 'melee' in cl:
                return 'infantry'
            return 'other' if 'military' in cl else 'civilian'
        if kind == 'building':
            n = name.lower()
            if n == 'town center':
                return 'town_center'
            if 'age_up_producer' in cl:
                return 'age_up_base'  # e.g. House of Wisdom: built in the Dark Age, the wings (techs) are the age-ups
            if 'landmark' in cl and 'town_center_capital' not in cl:
                # real age-up landmarks declare the age they are built in; other "landmark" class buildings
                # (Knights Templar fortresses, Mongol Ovoo-style structures) are regular buildings
                return 'landmark' if any(c in cl for c in ('wonder_dark_age', 'wonder_feudal_age', 'wonder_castle_age')) else 'special'
            if 'wonder' in cl and 'landmark' not in cl:
                return 'wonder'
            if any(w in n for w in ('outpost', 'tower', 'keep', 'gate', 'wall')):
                return 'defense'
            if any(w in n for w in ('barracks', 'archery', 'stable', 'siege workshop', 'dock', 'military', 'school', 'camp', 'ger')) and 'mining' not in n and 'lumber' not in n:
                return 'military'
            return 'economy'
        n = name.lower()
        if n.endswith(' wing'):
            return 'age_up'
        return 'tech'

    def get(self, pbgid):
        return self.by_id.get(pbgid)


_bp = None


def blueprints():
    global _bp
    with _lock:
        if _bp is None:
            _bp = Blueprints()
    return _bp


# ----------------------------------------------------------------------------- replays: find + fetch

GID_RE = re.compile(r'M_(\d+)_')


def _is_replay_file(path):
    """True when the file (plain or gzipped) starts with the AoE4 replay signature."""
    try:
        with open(path, 'rb') as f:
            head = f.read(16)
        if head[:2] == GZIP_MAGIC:
            with gzip.open(path, 'rb') as g:
                head = g.read(16)
        return head[4:11] == b'AOE4_RE'
    except Exception:  # noqa: BLE001
        return False


def local_replays(cfg):
    """game_id -> path for every replay we can read: game folders + our download cache."""
    found = {}
    for d in replay_dirs(cfg):
        for p in list(d.glob('*.gz')) + list(d.glob('*.rec')):
            m = GID_RE.search(p.name)
            if m:
                gid = int(m.group(1))
                if gid in found or not _is_replay_file(p):
                    continue  # the game stores a stats file next to each replay under the same id
                found[gid] = p
            elif p.name == 'temp.rec' and _is_replay_file(p):
                found.setdefault('last', p)
    for p in (CACHE / 'replays').glob('M_*.gz'):
        m = re.match(r'M_(\d+)\.gz$', p.name)
        if m:
            found.setdefault(int(m.group(1)), p)
    return found


def fetch_official_replay(game_id, min_duration=None, force=False):
    """Ask World's Edge for signed replay links for this match and download the best one.
    The store keeps one upload per player *perspective*; a player who dropped early uploads a truncated file,
    so candidates are tried largest-first and, when `min_duration` is known, a file shorter than 70% of the
    game is skipped while a longer one may exist. Returns (path | None, status string)."""
    marker = CACHE / 'analysis' / f'{game_id}.fetch.json'
    st = {}
    if marker.exists():
        try:
            st = json.loads(marker.read_text())
        except Exception:  # noqa: BLE001
            st = {}
        if st.get('status') == 'not_found' and time.time() - st.get('at', 0) < 86400 and not force:
            return None, 'not_found'
    dest = CACHE / 'replays' / f'M_{game_id}.gz'
    if dest.exists() and not force:
        return dest, 'cached'
    url = WE + 'leaderboard/getReplayFiles?' + urllib.parse.urlencode({'matchIDs': json.dumps([int(game_id)]), 'title': 'age4'})
    try:
        meta = json.loads(http_get(url, 30))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            return None, 'rate_limited'
        return None, f'list failed: {e}'
    except Exception as e:  # noqa: BLE001
        return None, f'list failed: {e}'
    code = (meta.get('result') or {}).get('code')
    files = [f for f in (meta.get('replayFiles') or []) if f.get('datatype') == 0 and f.get('url') and (f.get('size') or 0) != -1]
    files.sort(key=lambda f: -(f.get('size') or 0))
    if code == 2 or not files:
        marker.write_text(json.dumps({'status': 'not_found', 'at': time.time()}))
        return None, 'not_found'
    last = None
    best = None  # (duration, data, profile_id)
    for f in files[:4]:
        try:
            data = http_get(f['url'], 120)
        except Exception as e:  # noqa: BLE001
            last = str(e)
            continue
        if not aoe4rec.is_replay_bytes(data):
            continue
        if data[:2] != GZIP_MAGIC:
            data = gzip.compress(data)
        dur = None
        if min_duration:
            try:
                dur = aoe4rec.load_bytes(data)['duration']
            except Exception:  # noqa: BLE001
                dur = None
        if best is None or (dur or 0) > (best[0] or 0):
            best = (dur, data, f.get('profile_id'))
        if not min_duration or (dur or 0) >= 0.7 * min_duration:
            break
    if best is None:
        return None, f'all perspectives failed ({last})'
    dest.write_bytes(best[1])
    marker.write_text(json.dumps({'status': 'ok', 'at': time.time(), 'perspective': best[2], 'duration': best[0], 'longest': bool(min_duration), 'perspectives': len(files)}))
    return dest, 'downloaded'


def ensure_full_replay(game_id, path, expected_duration):
    """If a cached store download is much shorter than the game, try the other perspectives once."""
    marker = CACHE / 'analysis' / f'{game_id}.fetch.json'
    if path is None or not expected_duration or path.parent != CACHE / 'replays':
        return path, None
    try:
        st = json.loads(marker.read_text()) if marker.exists() else {}
    except Exception:  # noqa: BLE001
        st = {}
    if st.get('longest'):
        return path, None
    try:
        dur = aoe4rec.load(path)['duration']
    except Exception:  # noqa: BLE001
        return path, None
    if dur >= 0.7 * expected_duration:
        st['longest'] = True
        marker.write_text(json.dumps(st))
        return path, None
    p2, status = fetch_official_replay(game_id, min_duration=expected_duration, force=True)
    return (p2 or path), status


# ----------------------------------------------------------------------------- API data

def my_games(cfg, refresh=False):
    me = cfg.get('me')
    if not me:
        return []
    p = CACHE / 'data' / f'games_{me}.json'
    if p.exists() and not refresh and time.time() - p.stat().st_mtime < 600:
        return json.loads(p.read_text(encoding='utf-8'))
    games, page = [], 1
    while page <= int(cfg.get('max_game_pages') or 20):
        d = json.loads(http_get(A4W + f'players/{me}/games?limit=50&page={page}'))
        games += d.get('games') or []
        if not d.get('next_page'):
            break
        page = d['next_page']
    p.write_text(json.dumps(games), encoding='utf-8')
    return games


def api_game(me, game_id):
    return cached_json(f'game_{game_id}', A4W + f'players/{me}/games/{game_id}', 30 * 86400)


def player_games(pid, pages=2, refresh=False):
    """Recent games of any player (newest first), cached 10 minutes."""
    p = CACHE / 'data' / f'games_{pid}_p{pages}.json'
    if p.exists() and not refresh and time.time() - p.stat().st_mtime < 600:
        return json.loads(p.read_text(encoding='utf-8'))
    games, page = [], 1
    while page <= pages:
        d = json.loads(http_get(A4W + f'players/{pid}/games?limit=50&page={page}'))
        games += d.get('games') or []
        if not d.get('next_page'):
            break
        page = d['next_page']
    p.write_text(json.dumps(games), encoding='utf-8')
    return games


def official_history(me, refresh=False):
    """match_id -> official match record with per-player counters (recent ~60 matches)."""
    d = cached_json(f'history_{me}', WE + 'leaderboard/getRecentMatchHistory?' + urllib.parse.urlencode({'title': 'age4', 'profile_ids': json.dumps([int(me)])}), 0 if refresh else 300)
    aliases = {p['profile_id']: p.get('alias') for p in d.get('profiles') or []}
    out = {}
    for m in d.get('matchHistoryStats') or []:
        members = {x['profile_id']: x for x in m.get('matchhistorymember') or []}
        dur = max(1, (m.get('completiontime') or 0) - (m.get('startgametime') or 0))
        rows = {}
        for r in m.get('matchhistoryreportresults') or []:
            try:
                c = json.loads(r.get('counters') or '{}')
            except Exception:  # noqa: BLE001
                c = {}
            mem = members.get(r['profile_id'], {})
            rows[r['profile_id']] = {
                'alias': aliases.get(r['profile_id']), 'team': r.get('teamid'), 'result': {1: 'win', 0: 'loss'}.get(r.get('resulttype'), 'other'),
                'units_produced': c.get('unitprod', c.get('sqprod')), 'kills': c.get('sqkill', c.get('ekills')), 'units_lost': c.get('sqlost'),
                'buildings_built': c.get('bprod'), 'buildings_lost': c.get('blost'), 'upgrades': c.get('upg'), 'commands': c.get('totalcmds'),
                'apm': round((c.get('totalcmds') or 0) / (dur / 60)) if c.get('totalcmds') else None,
                'rating_before': mem.get('oldrating'), 'rating_after': mem.get('newrating'), 'xp': r.get('xpgained'),
            }
        out[m['id']] = {'duration': dur, 'matchtype_id': m.get('matchtype_id'), 'players': rows, 'has_replay_urls': bool(m.get('matchurls'))}
    return out


# ----------------------------------------------------------------------------- analysis

def mmss(s):
    return f'{int(s // 60)}:{int(s % 60):02d}'


def analyze_replay(path, bp=None):
    bp = bp or blueprints()
    path = Path(path)
    key = CACHE / 'analysis' / (re.sub(r'[^A-Za-z0-9_.-]', '_', path.name) + f'.{int(path.stat().st_mtime)}.v5.json')
    if key.exists():
        return json.loads(key.read_text(encoding='utf-8'))
    r = aoe4rec.load(path)
    out = {'file': path.name, 'build': r['version'], 'date': r['date'], 'duration': r['duration'], 'players': [], 'blueprints': {}}
    used = out['blueprints']
    MIL_ROLES = ('cavalry', 'ranged', 'infantry', 'siege', 'naval', 'other')
    nmin = int(r['duration'] // 60) + 1
    for p in r['players']:
        mine = [c for c in r['commands'] if c.pid == p.pid]
        trains, builds, techs = [], [], []
        events = []                      # compact command stream: consecutive identical orders in one minute collapse
        counts = Counter()               # pbgid -> orders
        per_minute = [{'villagers': 0, 'military': 0, 'buildings': 0, 'techs': 0, 'food': 0, 'wood': 0, 'gold': 0, 'stone': 0, 'mil_spend': 0, 'eco_spend': 0} for _ in range(nmin)]
        for c in mine:
            b = bp.get(c.pbgid)
            if not b:
                continue
            if c.kind == 'train' and b['kind'] == 'unit':
                trains.append((c.time, b))
            elif c.kind == 'build' and b['kind'] == 'building':
                builds.append((c.time, b, c.pos))
            elif c.kind == 'research' and b['kind'] == 'tech':
                techs.append((c.time, b))
            else:
                continue
            used.setdefault(c.pbgid, {'name': b['name'], 'icon': b['icon'], 'kind': b['kind'], 'role': b['role'], 'age': b['age']})
            counts[c.pbgid] += 1
            m = min(nmin - 1, int(c.time // 60))
            pm = per_minute[m]
            cost = b.get('costs') or {}
            total = 0
            for k in ('food', 'wood', 'gold', 'stone'):
                pm[k] += cost.get(k, 0)
                total += cost.get(k, 0)
            if b['kind'] == 'unit':
                if b['role'] == 'villager':
                    pm['villagers'] += 1
                    pm['eco_spend'] += total
                elif b['role'] in MIL_ROLES:
                    pm['military'] += 1
                    pm['mil_spend'] += total
                else:
                    pm['eco_spend'] += total
            elif b['kind'] == 'building':
                pm['buildings'] += 1
                pm['mil_spend' if b['role'] in ('military', 'defense') else 'eco_spend'] += total
            else:
                pm['techs'] += 1
                pm['eco_spend'] += total
            if events and events[-1]['id'] == c.pbgid and events[-1]['k'] == c.kind and int(events[-1]['t'] // 60) == m:
                events[-1]['n'] += 1
            else:
                events.append({'t': round(c.time, 1), 'k': c.kind, 'id': c.pbgid, 'n': 1})
        mil = [(t, b) for t, b in trains if b['role'] in MIL_ROLES]
        by_unit = Counter(b['base'] for _, b in trains)          # tiers (Veteran/Elite…) folded into the base unit
        by_unit_exact = Counter(b['name'] for _, b in trains)
        by_role = Counter(b['role'] for _, b in trains)
        timeline = defaultdict(Counter)
        for t, b in trains:
            timeline[int(t // 300)][b['role']] += 1   # 5-minute buckets
        vill_times = [t for t, b in trains if b['role'] == 'villager']
        gap, gap_at = 0.0, None
        for a, z in zip(vill_times, vill_times[1:]):
            if a < 900 and z - a > gap:
                gap, gap_at = z - a, a
        if vill_times and vill_times[0] > gap and vill_times[0] < 900:
            gap, gap_at = vill_times[0], 0.0
        landmarks = [(t, b['name']) for t, b, _ in builds if b['role'] == 'landmark']
        # age-ups: earliest placement/research that targets each age (landmarks declare their age; Abbasid wings are techs)
        by_target = {}
        for t, b, _ in builds:
            if b['role'] == 'landmark' and b.get('age_target') and (b['age_target'] not in by_target or t < by_target[b['age_target']][0]):
                by_target[b['age_target']] = (t, b['name'])
        for t, b in techs:
            if b['role'] == 'age_up' and b.get('age_target') and (b['age_target'] not in by_target or t < by_target[b['age_target']][0]):
                by_target[b['age_target']] = (t, b['name'])
        ages = [(a, by_target[a][0], by_target[a][1]) for a in sorted(by_target)]
        tcs = [t for t, b, _ in builds if b['role'] == 'town_center']
        defense = [(t, b['name']) for t, b, _ in builds if b['role'] == 'defense']
        first_mil = mil[0] if mil else None

        def before(secs, items):
            return sum(1 for item in items if item[0] < secs)

        out['players'].append({
            'slot': p.slot, 'name': p.name, 'civ': p.civ, 'team': p.team,
            'commands': r['total_commands'].get(p.pid, 0),
            'apm_replay': round(r['total_commands'].get(p.pid, 0) / max(1, r['duration'] / 60)),
            'villagers': by_role.get('villager', 0), 'traders': by_role.get('trader', 0), 'monks': by_role.get('monk', 0), 'scouts': by_role.get('scout', 0),
            'military': len(mil), 'by_role': dict(by_role), 'by_unit': dict(by_unit.most_common()), 'by_unit_exact': dict(by_unit_exact.most_common()),
            'military_by_unit': dict(Counter(b['base'] for _, b in mil).most_common()),
            'first_military': {'time': first_mil[0], 'name': first_mil[1]['name']} if first_mil else None,
            'military_by_6': before(360, mil), 'military_by_8': before(480, mil), 'military_by_10': before(600, mil),
            'cavalry_by_6': before(360, [x for x in mil if x[1]['role'] == 'cavalry']),
            'ranged_by_6': before(360, [x for x in mil if x[1]['role'] == 'ranged']),
            'infantry_by_6': before(360, [x for x in mil if x[1]['role'] == 'infantry']),
            'villagers_by_10': before(600, [x for x in trains if x[1]['role'] == 'villager']),
            'town_centers': tcs, 'landmarks': [{'time': t, 'name': n} for t, n in landmarks],
            'ages': [{'age': a, 'time': t, 'via': n} for a, t, n in ages],
            'defense_by_12': before(720, defense), 'defense_total': len(defense),
            'buildings_by_name': dict(Counter(b['name'] for _, b, _ in builds).most_common()),
            'research': [{'time': t, 'name': b['name']} for t, b in techs],
            'build_order': [{'time': t, 'kind': 'build', 'name': b['name']} for t, b, _ in builds][:80],
            'timeline': {str(k * 5): dict(v) for k, v in sorted(timeline.items())},
            # phase 2: minute buckets, compact event stream, counts per blueprint, villager-production rhythm
            'per_minute': per_minute,
            'events': events[:900],
            'counts': {str(k): v for k, v in counts.most_common()},
            'villager_gap': {'gap': round(gap, 1), 'at': gap_at} if gap_at is not None else None,
            'last_villager': vill_times[-1] if vill_times else None,
            'spend_total': sum(pm['food'] + pm['wood'] + pm['gold'] + pm['stone'] for pm in per_minute),
            'spend_military': sum(pm['mil_spend'] for pm in per_minute),
            'spend_by_15': {'military': sum(pm['mil_spend'] for pm in per_minute[:15]), 'total': sum(pm['mil_spend'] + pm['eco_spend'] for pm in per_minute[:15])},
            'military_by_12': before(720, mil), 'military_by_15': before(900, mil),
        })
    key.write_text(json.dumps(out), encoding='utf-8')
    return out


# ----------------------------------------------------------------------------- tags

def tag(code, label, why):
    return {'tag': code, 'label': label, 'why': why}


def player_tags(pl, duration, game_players):
    """Replay-based tags for one player. `game_players` = all analysed players (for game-relative tags)."""
    tags = []
    if duration >= 480:
        if pl['military_by_8'] == 0:
            first = f"{mmss(pl['first_military']['time'])} {pl['first_military']['name']}" if pl['first_military'] else 'never'
            tags.append(tag('boomer', 'Boomer', f"no military unit queued before 8:00 (first: {first})"))
        if pl['cavalry_by_6'] >= 3:
            tags.append(tag('cavalry_raider', 'Cavalry raider', f"{pl['cavalry_by_6']} cavalry queued before 6:00"))
        if pl['ranged_by_6'] >= 5:
            tags.append(tag('archer_opener', 'Archer opener', f"{pl['ranged_by_6']} ranged units queued before 6:00"))
        if pl['infantry_by_6'] >= 5:
            tags.append(tag('infantry_rush', 'Infantry rush', f"{pl['infantry_by_6']} melee infantry queued before 6:00"))
        if pl['town_centers'] and pl['town_centers'][0] < 600:
            tags.append(tag('fast_2tc', 'Fast 2nd TC', f"second Town Center placed at {mmss(pl['town_centers'][0])}"))
        if len(pl['town_centers']) >= 2:
            tags.append(tag('tc_boom', 'TC boom', f"{len(pl['town_centers']) + 1} Town Centers in total"))
        if pl['defense_by_12'] >= 4:
            tags.append(tag('turtle', 'Turtle', f"{pl['defense_by_12']} towers/outposts/keeps/gates placed before 12:00"))
    if pl['military'] >= 20:
        best = max(((n, k) for k, n in (pl.get('military_by_unit') or {}).items()), default=(0, None))
        if best[1] and best[0] / pl['military'] >= 0.7:
            tags.append(tag('mono_comp', f'Mono-comp: {best[1]}', f"{best[0]} of {pl['military']} military units were {best[1]} ({100 * best[0] / pl['military']:.0f}%)"))
        siege = pl['by_role'].get('siege', 0)
        if siege >= 5 and siege / pl['military'] >= 0.15:
            tags.append(tag('siege_heavy', 'Siege heavy', f"{siege} siege units ({100 * siege / pl['military']:.0f}% of military)"))
    if pl['by_role'].get('naval', 0) >= 5:
        tags.append(tag('navy', 'Navy', f"{pl['by_role']['naval']} ships built"))
    if pl['traders'] >= 5:
        tags.append(tag('trader', 'Trader', f"{pl['traders']} traders built"))
    if pl['monks'] >= 3:
        tags.append(tag('monk_play', 'Monk play', f"{pl['monks']} religious units"))
    # game-relative
    others = [q for q in game_players if q is not pl]
    if others and duration >= 480:
        if pl['ages'] and all((not q['ages']) or q['ages'][0]['time'] > pl['ages'][0]['time'] for q in others):
            tags.append(tag('fastest_feudal', 'Fastest age-up', f"first age-up at {mmss(pl['ages'][0]['time'])} via {pl['ages'][0]['via']}, earliest in the game"))
        if pl['villagers'] and all(q['villagers'] < pl['villagers'] for q in others):
            tags.append(tag('most_villagers', 'Most villagers', f"{pl['villagers']} villagers queued, most in the game"))
        if pl['military'] >= 10 and all(q['military'] < pl['military'] for q in others):
            tags.append(tag('biggest_army', 'Biggest army', f"{pl['military']} military units queued, most in the game"))
    return tags


def counter_tags(pid, row, all_rows):
    tags = []
    others = [r for k, r in all_rows.items() if k != pid]
    k = row.get('kills') or 0
    if k >= 10 and all((r.get('kills') or 0) < k for r in others):
        tags.append(tag('top_fragger', 'Top fragger', f"{k} kills, most in the game"))
    lost = row.get('units_lost') or 0
    if k >= 20 and lost and all(((r.get('kills') or 0) / max(1, r.get('units_lost') or 0)) < k / lost for r in others if (r.get('kills') or 0) >= 20):
        tags.append(tag('best_kd', 'Best K/D', f"{k} kills for {lost} lost ({k / lost:.2f})"))
    apm = row.get('apm') or 0
    if apm and all((r.get('apm') or 0) < apm for r in others):
        tags.append(tag('highest_apm', 'Highest APM', f"{apm} commands per minute, highest in the game"))
    b = row.get('buildings_built') or 0
    if b >= 10 and all((r.get('buildings_built') or 0) < b for r in others):
        tags.append(tag('most_buildings', 'Most buildings', f"{b} buildings built, most in the game"))
    if lost >= 20 and k and k / lost < 0.5 and all((r.get('units_lost') or 0) <= lost for r in others):
        tags.append(tag('fed', 'Fed', f"lost {lost} units for {k} kills, most losses in the game"))
    return tags


def game_tags(game, me, friends, duration):
    tags = []
    fmap = {f['profile_id']: f.get('name') for f in friends}
    my_team = next((t for t in game.get('teams') or [] if any((x.get('player', x))['profile_id'] == me for x in t)), None)
    if my_team:
        mates = [(x.get('player', x)) for x in my_team if (x.get('player', x))['profile_id'] != me]
        fr = [m for m in mates if m['profile_id'] in fmap]
        for m in fr:
            tags.append(tag(f"with:{m['profile_id']}", f"with {m['name']}", f"{m['name']} was on your team"))
        n = len(fr) + 1
        if n >= 4:
            tags.append(tag('four_stack', '4-stack', f"you and {len(fr)} friends on one team"))
        elif n == 3:
            tags.append(tag('three_stack', '3-stack', f"you and {len(fr)} friends on one team"))
        elif n == 2:
            tags.append(tag('duo', 'Duo', f"you and {fr[0]['name']} queued together"))
    if duration is not None:
        if duration < 300:
            tags.append(tag('early_end', 'Early end', f"game lasted {mmss(duration)} — a drop, disconnect or instant surrender"))
        elif duration > 2100:
            tags.append(tag('long_game', 'Long game', f"game lasted {mmss(duration)}"))
    return tags


# ----------------------------------------------------------------------------- merged views

def _players_of(game):
    return [x.get('player', x) for t in (game.get('teams') or []) for x in t]


def list_games(cfg, refresh=False):
    me = cfg.get('me')
    games = my_games(cfg, refresh)
    local = local_replays(cfg)
    hist = {}
    try:
        hist = official_history(me, refresh)
    except Exception:  # noqa: BLE001
        pass
    friends = {f['profile_id']: f for f in cfg.get('friends') or []}
    analysed = set()
    for p in (CACHE / 'analysis').glob('M_*.json'):
        m = GID_RE.search(p.name)
        if m:
            analysed.add(int(m.group(1)))
    rows = []
    for g in games:
        ps = _players_of(g)
        mine = next((p for p in ps if p['profile_id'] == me), None)
        my_team = next((t for t in g['teams'] if any((x.get('player', x))['profile_id'] == me for x in t)), [])
        team_players = [(x.get('player', x)) for x in my_team]
        mates = [m for m in team_players if m['profile_id'] != me]
        opps = [p for p in ps if p not in team_players]
        rows.append({
            'game_id': g['game_id'], 'started_at': g['started_at'], 'kind': g['kind'], 'leaderboard': g.get('leaderboard'), 'map': g['map'], 'duration': g['duration'],
            'server': g.get('server'), 'players': len(ps), 'result': mine.get('result') if mine else None,
            'my_civ': mine.get('civilization') if mine else None, 'rating': mine.get('rating') if mine else None, 'rating_diff': mine.get('rating_diff') if mine else None,
            'teammates': [{'profile_id': m['profile_id'], 'name': m['name'], 'civ': m['civilization'], 'friend': m['profile_id'] in friends} for m in mates],
            'opponents': [{'profile_id': o['profile_id'], 'name': o['name'], 'civ': o['civilization']} for o in opps],
            'has_replay': g['game_id'] in local, 'has_counters': g['game_id'] in hist, 'analysed': g['game_id'] in analysed,
            'tags': game_tags(g, me, cfg.get('friends') or [], g.get('duration')),
        })
    return {'me': me, 'count': len(rows), 'replays_available': sum(r['has_replay'] for r in rows), 'counters_available': sum(r['has_counters'] for r in rows), 'games': rows}


AGE_NAMES = {2: 'Feudal', 3: 'Castle', 4: 'Imperial'}
AUTO_WORKER_CIVS = {'vikings'}   # workers appear without a train order, so replay villager counts are not comparable


def _age_time(rp, age):
    return next((a['time'] for a in rp.get('ages') or [] if a['age'] == age), None)


def key_insights(teams, duration, focus_id):
    """Rule-based sentences about the focus player's game, each with a tone and the numbers behind it.
    Only uses replay-derived facts (orders), so wording says 'queued' / 'placed', never 'had'."""
    rows = [p for t in teams for p in t]
    me = next((p for p in rows if p['profile_id'] == focus_id), None)
    if not me or not me.get('replay'):
        return []
    my_team = next(t for t in teams if me in t)
    opps = [p for t in teams if t is not my_team for p in t if p.get('replay')]
    mates = [p for p in my_team if p is not me and p.get('replay')]
    R = me['replay']
    name = me['name']
    out = []

    def add(tone, text, **nums):
        out.append({'tone': tone, 'text': text, 'numbers': nums})

    # 1. age-up timing vs the fastest opponent
    for age in (2, 3, 4):
        t = _age_time(R, age)
        if t is None:
            continue
        theirs = [(_age_time(o['replay'], age), o) for o in opps]
        theirs = [(x, o) for x, o in theirs if x is not None]
        if not theirs:
            if opps and duration and t < duration:
                add('good', f"{name} was the only player to reach {AGE_NAMES[age]} ({mmss(t)}).", time=t)
            continue
        ft, fo = min(theirs, key=lambda x: x[0])
        diff = ft - t
        if diff >= 20:
            add('good', f"{name} reached {AGE_NAMES[age]} at {mmss(t)}, {mmss(diff)} before the fastest opponent ({fo['name']} at {mmss(ft)}).", time=t, opp=ft)
        elif diff <= -20:
            add('bad', f"{name} reached {AGE_NAMES[age]} at {mmss(t)}, {mmss(-diff)} after {fo['name']} ({mmss(ft)}).", time=t, opp=ft)
        else:
            add('neutral', f"{name} and {fo['name']} reached {AGE_NAMES[age]} within {mmss(abs(diff))} of each other ({mmss(t)} vs {mmss(ft)}).", time=t, opp=ft)
    # 2. villagers by 10:00 (skip civs whose workers spawn without a queue order, e.g. Viking Bondi from Longhouses)
    vopps = [o for o in opps if o.get('civilization') not in AUTO_WORKER_CIVS]
    if duration and duration >= 600 and vopps and me.get('civilization') not in AUTO_WORKER_CIVS:
        opps_v = vopps
        mine = R['villagers_by_10']
        avg = sum(o['replay']['villagers_by_10'] for o in opps_v) / len(opps_v)
        best = max(opps_v, key=lambda o: o['replay']['villagers_by_10'])
        if mine - avg >= 3:
            add('good', f"{name} queued {mine} villagers by 10:00; opponents averaged {avg:.0f}.", mine=mine, avg=avg)
        elif avg - mine >= 3:
            add('bad', f"{name} queued {mine} villagers by 10:00; opponents averaged {avg:.0f} ({best['name']}: {best['replay']['villagers_by_10']}).", mine=mine, avg=avg)
        else:
            add('neutral', f"Villager production was even by 10:00: {mine} for {name}, {avg:.0f} on average for the opponents.", mine=mine, avg=avg)
    # 3. villager production stopped early
    lv = R.get('last_villager')
    if lv is not None and duration and R['villagers'] >= 20 and duration - lv > 240:
        add('bad' if duration - lv > 480 else 'neutral', f"{name} queued the last villager at {mmss(lv)} ({R['villagers']} in total); the game ran another {mmss(duration - lv)}.", last=lv, total=R['villagers'])
    # 4. longest pause in villager production (first 15 minutes)
    vg = R.get('villager_gap')
    if vg and vg['gap'] >= 75 and (duration or 0) >= 600:
        add('bad' if vg['gap'] >= 120 else 'neutral', f"Longest pause in {name}'s villager production before 15:00: {mmss(vg['gap'])}, starting at {mmss(vg['at'])}.", gap=vg['gap'], at=vg['at'])
    # 5. early military
    if (duration or 0) >= 480 and opps:
        mine8 = R['military_by_8']
        fast = max(opps, key=lambda o: o['replay']['military_by_8'])
        theirs8 = fast['replay']['military_by_8']
        if mine8 == 0 and theirs8 >= 5:
            add('neutral' if me.get('result') == 'win' else 'bad', f"{name} queued no military before 8:00 while {fast['name']} queued {theirs8} units — a boom that was open to pressure.", mine=mine8, opp=theirs8)
        elif mine8 >= 6 and mine8 >= 2 * max(1, theirs8):
            add('good', f"{name} out-produced every opponent early: {mine8} military units queued by 8:00 against {theirs8} for {fast['name']}.", mine=mine8, opp=theirs8)
    # 6. expansion
    if (duration or 0) >= 600:
        my_tc = R['town_centers'][0] if R['town_centers'] else None
        their = [(o['replay']['town_centers'][0], o) for o in opps if o['replay']['town_centers']]
        if my_tc is not None and not their and opps:
            add('good', f"{name} placed a second Town Center at {mmss(my_tc)}; no opponent expanded.", tc=my_tc)
        elif my_tc is not None and their:
            ft, fo = min(their, key=lambda x: x[0])
            if ft - my_tc >= 60:
                add('good', f"{name} expanded first: second Town Center at {mmss(my_tc)} vs {mmss(ft)} for {fo['name']}.", tc=my_tc, opp=ft)
            elif my_tc - ft >= 60:
                add('neutral', f"{fo['name']} expanded first ({mmss(ft)}); {name} followed at {mmss(my_tc)}.", tc=my_tc, opp=ft)
        elif my_tc is None and their and duration >= 900:
            ft, fo = min(their, key=lambda x: x[0])
            add('neutral', f"{name} stayed on one Town Center; {fo['name']} expanded at {mmss(ft)}.", opp=ft)
    # 7. where the resources went (first 15 minutes)
    sb = R.get('spend_by_15') or {}
    if sb.get('total', 0) >= 3000 and (duration or 0) >= 900:
        share = 100 * sb['military'] / sb['total']
        opp_share = None
        tot = [(o['replay'].get('spend_by_15') or {}) for o in opps]
        tot = [x for x in tot if x.get('total')]
        if tot:
            opp_share = 100 * sum(x['military'] for x in tot) / sum(x['total'] for x in tot)
        txt = f"{name} put {share:.0f}% of resources into military units and buildings in the first 15 minutes"
        txt += f" (opponents: {opp_share:.0f}%)." if opp_share is not None else '.'
        add('neutral', txt, share=share, opp=opp_share)
    # 8. team production by 12:00
    if mates and opps and (duration or 0) >= 720:
        ours = sum(p['replay']['military_by_12'] for p in my_team if p.get('replay'))
        theirs = sum(o['replay']['military_by_12'] for o in opps)
        if theirs and ours / theirs >= 1.3:
            add('good', f"{name}'s team queued {ours / theirs:.1f}× the military of the opposing team by 12:00 ({ours} vs {theirs} units).", ours=ours, theirs=theirs)
        elif ours and theirs / ours >= 1.3:
            add('bad', f"The opposing team queued {theirs / ours:.1f}× the military of {name}'s team by 12:00 ({theirs} vs {ours} units).", ours=ours, theirs=theirs)
    # 9. team carry: share of the team's military
    if mates and R['military'] >= 20:
        team_mil = sum(p['replay']['military'] for p in my_team if p.get('replay'))
        share = 100 * R['military'] / max(1, team_mil)
        if share >= 45 and len(my_team) >= 3:
            add('good', f"{name} queued {share:.0f}% of the team's military units ({R['military']} of {team_mil}).", share=share)
    # 10. composition
    mbu = R.get('military_by_unit') or {}
    if R['military'] >= 20 and mbu:
        unit, n = max(mbu.items(), key=lambda kv: kv[1])
        if n / R['military'] >= 0.6:
            add('neutral', f"{name}'s army was {100 * n / R['military']:.0f}% {unit} ({n} of {R['military']} military units).", unit=unit, share=100 * n / R['military'])
    return out[:8]


def game_detail(cfg, game_id, fetch=False, profile=None):
    """Everything we know about one game, from the perspective of `profile` (defaults to the configured 'me').
    Works for any player's game: the API record comes from aoe4world, counters from the official recent-match
    history of that profile, and unit-level detail from a replay (local file or the official store)."""
    me = cfg.get('me')
    focus = int(profile) if profile else me
    game_id = int(game_id)
    game = api_game(focus, game_id)
    friends = cfg.get('friends') or []
    local = local_replays(cfg)
    path = local.get(game_id)
    fetch_status = None if path is None else ('cached' if path.parent == CACHE / 'replays' else 'local')
    if path is None and fetch:
        path, fetch_status = fetch_official_replay(game_id, min_duration=game.get('duration'))
    elif path is not None:
        path, st2 = ensure_full_replay(game_id, path, game.get('duration'))
        fetch_status = st2 or fetch_status
    hist = {}
    try:
        hist = official_history(focus)
    except Exception:  # noqa: BLE001
        pass
    counters = (hist.get(game_id) or {}).get('players', {})
    analysis = None
    if path is not None:
        try:
            analysis = analyze_replay(path)
        except Exception as e:  # noqa: BLE001
            fetch_status = f'replay unreadable: {e}'
    ps = _players_of(game)
    duration = game.get('duration') or (analysis or {}).get('duration')
    # join replay players to API players by name (replays carry display names, not profile ids)
    by_name = {p['name']: p for p in (analysis or {}).get('players', [])}
    players = []
    for p in ps:
        rp = by_name.get(p['name'])
        row = {**p, 'counters': counters.get(p['profile_id']), 'replay': rp, 'tags': []}
        if rp:
            row['tags'] += player_tags(rp, duration or 0, (analysis or {}).get('players', []))
        if counters.get(p['profile_id']):
            row['tags'] += counter_tags(p['profile_id'], counters[p['profile_id']], counters)
        row['is_me'] = p['profile_id'] == me
        row['is_focus'] = p['profile_id'] == focus
        row['friend'] = any(f['profile_id'] == p['profile_id'] for f in friends)
        players.append(row)
    teams = []
    for t in game.get('teams') or []:
        ids = [(x.get('player', x))['profile_id'] for x in t]
        teams.append([pl for pl in players if pl['profile_id'] in ids])
    return {
        'game': {k: v for k, v in game.items() if k != 'teams'}, 'teams': teams, 'focus': focus,
        'tags': game_tags(game, focus, friends, duration),
        'insights': key_insights(teams, duration, focus) if analysis else [],
        'blueprints': (analysis or {}).get('blueprints') or {},
        'replay': {'available': analysis is not None, 'status': fetch_status, 'file': (analysis or {}).get('file'), 'build': (analysis or {}).get('build'), 'date': (analysis or {}).get('date')},
        'counters_available': bool(counters),
    }


# ----------------------------------------------------------------------------- playstyle profile (any player)

PROFILE_FIELDS = ('villagers', 'villagers_by_10', 'military', 'military_by_6', 'military_by_8', 'military_by_10', 'military_by_12', 'town_centers', 'ages',
                  'apm_replay', 'commands', 'first_military', 'spend_total', 'spend_military', 'defense_total', 'by_role', 'military_by_unit', 'last_villager', 'villager_gap')


def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    m = len(xs) // 2
    return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2


MIL_BUILDINGS = ('barracks', 'archery range', 'stable', 'siege workshop', 'dock', 'military school', 'mercenary', 'camel', 'horse ranch')


def _summarize(rp, g, me, a, status):
    """Per-game summary of one player's replay data kept in the profile store (small, serialisable)."""
    dur = g.get('duration') or a['duration']
    tags = player_tags(rp, dur, a['players'])
    opening = sorted([{'t': round(x['time'], 1), 'k': 'build', 'name': x['name']} for x in rp.get('build_order') or []] +
                     [{'t': round(x['time'], 1), 'k': 'research', 'name': x['name']} for x in rp.get('research') or []], key=lambda x: x['t'])[:18]
    early = Counter(x['name'] for x in rp.get('build_order') or [] if x['time'] < 300)
    first_mil_b = next((x for x in rp.get('build_order') or [] if any(w in x['name'].lower() for w in MIL_BUILDINGS)), None)
    s = {k: rp.get(k) for k in PROFILE_FIELDS}
    s.update({'game_id': g['game_id'], 'started_at': g['started_at'], 'kind': g['kind'], 'map': g['map'], 'duration': dur,
              'civ': me.get('civilization'), 'result': me.get('result'), 'rating_diff': me.get('rating_diff'), 'source': status,
              'tags': [t['tag'] for t in tags], 'tag_labels': {t['tag']: t['label'] for t in tags},
              'opening': opening, 'early_buildings': dict(early), 'landmarks': rp.get('landmarks') or [],
              'first_military_building': {'time': first_mil_b['time'], 'name': first_mil_b['name']} if first_mil_b else None})
    return s


def playstyle_profile(cfg, pid, want=10, budget=20.0, refresh=False, civ=None):
    """Aggregate replay-derived tags, medians and records over a player's recent games.
    Fetches replays from the official store as needed, a few per call (time budget), and caches everything.
    Returns a partial result with `pending` > 0 when more games could still be analysed."""
    pid = int(pid)
    store = CACHE / 'analysis' / f'profile_{pid}.json'
    state = {'analysed': {}, 'missing': {}}
    if store.exists():
        try:
            state = json.loads(store.read_text(encoding='utf-8'))
        except Exception:  # noqa: BLE001
            pass
    games = player_games(pid, pages=4 if civ else 2, refresh=refresh)   # a specific civ may be rare: look further back
    def me_in(g):
        return next((p for t in g.get('teams') or [] for x in t for p in [x.get('player', x)] if p['profile_id'] == pid), None)
    finished = [g for g in games if not g.get('ongoing') and (g.get('duration') or 0) >= 480 and (not civ or (me_in(g) or {}).get('civilization') == civ)]
    local = local_replays(cfg)
    matches_civ = lambda s: not civ or s.get('civ') == civ  # noqa: E731
    # stored summaries written before newer fields existed are rebuilt from the (cached) analysis
    by_id = {str(g['game_id']): g for g in games}
    for gid, s in list(state['analysed'].items()):
        if 'opening' in s or gid not in by_id or not local.get(int(gid)):
            continue
        try:
            a = analyze_replay(local[int(gid)])
            me_ = me_in(by_id[gid])
            rp = next((p for p in a['players'] if me_ and p['name'] == me_['name']), None)
            if rp:
                state['analysed'][gid] = _summarize(rp, by_id[gid], me_, a, s.get('source', 'cached'))
        except Exception:  # noqa: BLE001
            pass
    deadline = time.time() + budget
    rate_limited = False
    for g in finished:
        gid = str(g['game_id'])
        if sum(1 for s in state['analysed'].values() if matches_civ(s)) >= want:
            break
        if gid in state['analysed']:
            continue
        miss = state['missing'].get(gid)
        if miss and (miss.get('status') == 'not_found' or time.time() - miss.get('at', 0) < 600):
            continue
        if time.time() > deadline:
            break
        path = local.get(int(gid))
        status = 'local'
        if path is None:
            path, status = fetch_official_replay(int(gid), min_duration=g.get('duration'))
            time.sleep(1.0)  # the store rate-limits bursts
        else:
            path, st2 = ensure_full_replay(int(gid), path, g.get('duration'))
            status = st2 or status
        if path is None:
            if status == 'rate_limited':
                rate_limited = True
                break
            state['missing'][gid] = {'status': status, 'at': time.time()}
            continue
        try:
            a = analyze_replay(path)
        except Exception as e:  # noqa: BLE001
            state['missing'][gid] = {'status': f'unreadable: {e}', 'at': time.time()}
            continue
        me = next((p for t in g.get('teams') or [] for x in t for p in [x.get('player', x)] if p['profile_id'] == pid), None)
        rp = next((p for p in a['players'] if me and p['name'] == me['name']), None)
        if rp is None:
            state['missing'][gid] = {'status': 'name mismatch', 'at': time.time()}
            continue
        state['analysed'][gid] = _summarize(rp, g, me, a, status)
    store.write_text(json.dumps(state), encoding='utf-8')

    rows = sorted([s for s in state['analysed'].values() if matches_civ(s)], key=lambda s: s['started_at'], reverse=True)
    n = len(rows)
    tag_counts, labels = Counter(), {}
    for s in rows:
        for t in s['tags']:
            tag_counts[t] += 1
            labels[t] = s['tag_labels'].get(t, t)
    tags = [{'tag': t, 'label': labels[t], 'count': c, 'pct': round(100 * c / n)} for t, c in tag_counts.most_common() if not t.startswith('with:')]
    feudal = [_age_time(s, 2) for s in rows]
    castle = [_age_time(s, 3) for s in rows]
    imperial = [_age_time(s, 4) for s in rows]
    vrows = [s for s in rows if s.get('civ') not in AUTO_WORKER_CIVS]   # Viking Bondi spawn without orders
    medians = {
        'villagers_by_10': _median([s['villagers_by_10'] for s in vrows]),
        'villagers': _median([s['villagers'] for s in vrows]),
        'feudal': _median(feudal), 'castle': _median(castle), 'imperial': _median(imperial),
        'military_by_8': _median([s['military_by_8'] for s in rows]), 'military_by_12': _median([s['military_by_12'] for s in rows]),
        'military': _median([s['military'] for s in rows]),
        'tcs': _median([len(s['town_centers'] or []) + 1 for s in rows]),
        'apm': _median([s['apm_replay'] for s in rows]),
        'mil_share': _median([100 * s['spend_military'] / s['spend_total'] for s in rows if s.get('spend_total')]),
        'duration': _median([s['duration'] for s in rows]),
    }
    comp = Counter()
    for s in rows:
        for role, c in (s.get('by_role') or {}).items():
            if role in ('cavalry', 'ranged', 'infantry', 'siege', 'naval'):
                comp[role] += c
    total_mil = sum(comp.values()) or 1
    composition = {k: round(100 * v / total_mil) for k, v in comp.most_common()}

    def best(key, items, reverse=False):
        items = [(v, s) for v, s in items if v is not None]
        if not items:
            return None
        v, s = (max if reverse else min)(items, key=lambda x: x[0])
        return {'value': v, 'game_id': s['game_id'], 'civ': s['civ'], 'map': s['map'], 'started_at': s['started_at'], 'result': s['result']}
    records = {
        'fastest_feudal': best('feudal', [(_age_time(s, 2), s) for s in rows]),
        'fastest_castle': best('castle', [(_age_time(s, 3), s) for s in rows]),
        'fastest_imperial': best('imperial', [(_age_time(s, 4), s) for s in rows]),
        'earliest_2nd_tc': best('tc', [((s['town_centers'] or [None])[0], s) for s in rows]),
        'most_villagers': best('v', [(s['villagers'], s) for s in vrows], reverse=True),
        'most_villagers_by_10': best('v10', [(s['villagers_by_10'], s) for s in vrows], reverse=True),
        'biggest_army': best('m', [(s['military'], s) for s in rows], reverse=True),
        'highest_apm': best('apm', [(s['apm_replay'], s) for s in rows], reverse=True),
    }
    # records that only need the API game list
    api_rows = [(g, next((p for t in g.get('teams') or [] for x in t for p in [x.get('player', x)] if p['profile_id'] == pid), None)) for g in games if not g.get('ongoing')]
    api_rows = [(g, p) for g, p in api_rows if p and p.get('result')]
    longest = max(api_rows, key=lambda gp: gp[0].get('duration') or 0, default=None)
    streak, best_streak, best_end = 0, 0, None
    for g, p in reversed(api_rows):  # oldest first
        if p['result'] == 'win':
            streak += 1
            if streak > best_streak:
                best_streak, best_end = streak, g
        else:
            streak = 0
    upset = None
    for g, p in api_rows:
        if p['result'] != 'win' or not p.get('rating'):
            continue
        teams_ = [[x.get('player', x) for x in t] for t in g.get('teams') or []]
        opps = [q for t in teams_ if not any(q['profile_id'] == pid for q in t) for q in t]
        gap = max((q.get('rating') or 0) for q in opps) - p['rating'] if opps else 0
        if gap > 0 and (upset is None or gap > upset[0]):
            upset = (gap, g)
    api_records = {
        'longest_game': {'value': longest[0]['duration'], 'game_id': longest[0]['game_id'], 'map': longest[0]['map'], 'started_at': longest[0]['started_at'], 'civ': longest[1].get('civilization'), 'result': longest[1]['result']} if longest else None,
        'longest_win_streak': {'value': best_streak, 'game_id': best_end['game_id'] if best_end else None, 'started_at': best_end['started_at'] if best_end else None} if best_streak else None,
        'biggest_upset': {'value': upset[0], 'game_id': upset[1]['game_id'], 'map': upset[1]['map'], 'started_at': upset[1]['started_at']} if upset else None,
    }
    remaining = [g for g in finished if str(g['game_id']) not in state['analysed'] and (state['missing'].get(str(g['game_id'])) or {}).get('status') != 'not_found']
    pending = min(max(0, want - n), len(remaining))
    # scouting aggregates: what this player builds (optionally as one civ)
    unit_tot = Counter()
    for s in rows:
        unit_tot.update(s.get('military_by_unit') or {})
    mil_all = sum(unit_tot.values()) or 1
    unit_mix = [{'unit': u, 'count': c, 'pct': round(100 * c / mil_all)} for u, c in unit_tot.most_common(8)]
    early_tot = Counter()
    for s in rows:
        early_tot.update(s.get('early_buildings') or {})
    early_buildings = [{'name': b, 'per_game': round(c / n, 1), 'games': sum(1 for s in rows if b in (s.get('early_buildings') or {}))} for b, c in early_tot.most_common(10)] if n else []
    feudal_via = Counter(next((a_['via'] for a_ in s.get('ages') or [] if a_['age'] == 2), None) for s in rows)
    castle_via = Counter(next((a_['via'] for a_ in s.get('ages') or [] if a_['age'] == 3), None) for s in rows)
    first_units = Counter((s.get('first_military') or {}).get('name') for s in rows)
    first_bld = Counter((s.get('first_military_building') or {}).get('name') for s in rows)
    openings = {
        'feudal_landmark': [{'name': k, 'games': v} for k, v in feudal_via.most_common() if k],
        'castle_landmark': [{'name': k, 'games': v} for k, v in castle_via.most_common() if k],
        'first_military_unit': [{'name': k, 'games': v} for k, v in first_units.most_common() if k],
        'first_military_time': _median([(s.get('first_military') or {}).get('time') for s in rows]),
        'first_military_building': [{'name': k, 'games': v} for k, v in first_bld.most_common() if k],
        'first_military_building_time': _median([(s.get('first_military_building') or {}).get('time') for s in rows]),
        'second_tc_rate': round(100 * sum(1 for s in rows if s.get('town_centers')) / n) if n else None,
        'second_tc_time': _median([(s.get('town_centers') or [None])[0] for s in rows]),
    }
    wins = sum(1 for s in rows if s.get('result') == 'win')
    return {
        'profile_id': pid, 'civ': civ, 'analysed': n, 'wins': wins, 'losses': sum(1 for s in rows if s.get('result') == 'loss'), 'candidates': len(finished), 'games_scanned': len(games), 'missing': len(state['missing']), 'want': want, 'pending': pending, 'rate_limited': rate_limited,
        'tags': tags, 'medians': medians, 'composition': composition, 'unit_mix': unit_mix, 'early_buildings': early_buildings, 'openings': openings, 'records': records, 'api_records': api_records,
        'games': [{k: s.get(k) for k in ('game_id', 'started_at', 'kind', 'map', 'duration', 'civ', 'result', 'rating_diff', 'villagers_by_10', 'military_by_8', 'apm_replay', 'tags', 'source', 'opening', 'first_military', 'military_by_unit')} | {'feudal': _age_time(s, 2), 'castle': _age_time(s, 3), 'tcs': len(s['town_centers'] or []) + 1} for s in rows],
        'updated': time.time(),
    }


def scan_and_analyze(cfg):
    local = local_replays(cfg)
    bp = blueprints()
    ok, failed = 0, 0
    for gid, path in local.items():
        try:
            analyze_replay(path, bp)
            ok += 1
        except Exception:  # noqa: BLE001
            failed += 1
    return {'replays': len(local), 'analysed': ok, 'failed': failed}


# ----------------------------------------------------------------------------- CLI

if __name__ == '__main__':
    cfg = load_config()
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'list'
    if cmd == 'list':
        d = list_games(cfg)
        print(f"{d['count']} games · {d['replays_available']} with replays · {d['counters_available']} with official counters")
        for r in d['games'][:30]:
            print(r['game_id'], r['started_at'][:16], r['kind'], r['map'], r['result'], mmss(r['duration'] or 0), 'R' if r['has_replay'] else '-', 'C' if r['has_counters'] else '-', [t['label'] for t in r['tags']])
    elif cmd == 'analyze':
        d = game_detail(cfg, int(sys.argv[2]), fetch=True, profile=sys.argv[3] if len(sys.argv) > 3 else None)
        print(json.dumps(d, indent=1, ensure_ascii=False)[:20000])
    elif cmd == 'insights':
        d = game_detail(cfg, int(sys.argv[2]), fetch=True, profile=sys.argv[3] if len(sys.argv) > 3 else None)
        for i in d['insights']:
            print(f"[{i['tone']}] {i['text']}")
    elif cmd == 'profile':
        d = playstyle_profile(cfg, int(sys.argv[2]), want=int(sys.argv[3]) if len(sys.argv) > 3 else 10)
        print(json.dumps({k: v for k, v in d.items() if k != 'games'}, indent=1, ensure_ascii=False))
        for g in d['games']:
            print(g['game_id'], g['started_at'][:10], g['kind'], g['civ'], g['result'], g['tags'])
    elif cmd == 'scan':
        print(scan_and_analyze(cfg))
