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
                self.by_id.setdefault(pb, {'name': it.get('name'), 'base': self.base_name(it.get('name') or ''), 'kind': kind, 'classes': sorted(classes), 'role': role, 'age': it.get('age'), 'age_target': age_target})

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
            if 'villager' in cl:
                return 'villager'
            if 'trade_cart' in cl or 'trader' in name.lower():
                return 'trader'
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


def fetch_official_replay(game_id):
    """Ask World's Edge for signed replay links for this match and download the first that works.
    Returns (path | None, status string)."""
    marker = CACHE / 'analysis' / f'{game_id}.fetch.json'
    if marker.exists():
        st = json.loads(marker.read_text())
        if st.get('status') == 'not_found' and time.time() - st.get('at', 0) < 86400:
            return None, 'not_found'
    dest = CACHE / 'replays' / f'M_{game_id}.gz'
    if dest.exists():
        return dest, 'cached'
    url = WE + 'leaderboard/getReplayFiles?' + urllib.parse.urlencode({'matchIDs': json.dumps([int(game_id)]), 'title': 'age4'})
    try:
        meta = json.loads(http_get(url, 30))
    except Exception as e:  # noqa: BLE001
        return None, f'list failed: {e}'
    code = (meta.get('result') or {}).get('code')
    files = [f for f in (meta.get('replayFiles') or []) if f.get('datatype') == 0 and f.get('url')]
    if code == 2 or not files:
        marker.write_text(json.dumps({'status': 'not_found', 'at': time.time()}))
        return None, 'not_found'
    last = None
    for f in files:
        try:
            data = http_get(f['url'], 120)
        except Exception as e:  # noqa: BLE001
            last = str(e)
            continue
        if aoe4rec.is_replay_bytes(data):
            if data[:2] != GZIP_MAGIC:
                data = gzip.compress(data)
            dest.write_bytes(data)
            marker.write_text(json.dumps({'status': 'ok', 'at': time.time(), 'perspective': f.get('profile_id')}))
            return dest, 'downloaded'
    return None, f'all perspectives failed ({last})'


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
    key = CACHE / 'analysis' / (re.sub(r'[^A-Za-z0-9_.-]', '_', path.name) + f'.{int(path.stat().st_mtime)}.v3.json')
    if key.exists():
        return json.loads(key.read_text(encoding='utf-8'))
    r = aoe4rec.load(path)
    out = {'file': path.name, 'build': r['version'], 'date': r['date'], 'duration': r['duration'], 'players': []}
    for p in r['players']:
        mine = [c for c in r['commands'] if c.pid == p.pid]
        trains, builds, techs = [], [], []
        for c in mine:
            b = bp.get(c.pbgid)
            if c.kind == 'train' and b and b['kind'] == 'unit':
                trains.append((c.time, b))
            elif c.kind == 'build' and b and b['kind'] == 'building':
                builds.append((c.time, b, c.pos))
            elif c.kind == 'research' and b and b['kind'] == 'tech':
                techs.append((c.time, b))
        mil = [(t, b) for t, b in trains if b['role'] in ('cavalry', 'ranged', 'infantry', 'siege', 'naval', 'other')]
        by_unit = Counter(b['base'] for _, b in trains)          # tiers (Veteran/Elite…) folded into the base unit
        by_unit_exact = Counter(b['name'] for _, b in trains)
        by_role = Counter(b['role'] for _, b in trains)
        timeline = defaultdict(Counter)
        for t, b in trains:
            timeline[int(t // 300)][b['role']] += 1   # 5-minute buckets
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
        civilian = {'Villager', 'Trader', 'Monk', 'Scout'}
        best = max(((n, k) for k, n in pl['by_unit'].items() if k not in civilian), default=(0, None))
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


def game_detail(cfg, game_id, fetch=False):
    me = cfg.get('me')
    game_id = int(game_id)
    game = api_game(me, game_id)
    friends = cfg.get('friends') or []
    local = local_replays(cfg)
    path, fetch_status = local.get(game_id), 'local' if game_id in local else None
    if path is None and fetch:
        path, fetch_status = fetch_official_replay(game_id)
    hist = {}
    try:
        hist = official_history(me)
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
        row['friend'] = any(f['profile_id'] == p['profile_id'] for f in friends)
        players.append(row)
    teams = []
    for t in game.get('teams') or []:
        ids = [(x.get('player', x))['profile_id'] for x in t]
        teams.append([pl for pl in players if pl['profile_id'] in ids])
    return {
        'game': {k: v for k, v in game.items() if k != 'teams'}, 'teams': teams,
        'tags': game_tags(game, me, friends, duration),
        'replay': {'available': analysis is not None, 'status': fetch_status, 'file': (analysis or {}).get('file'), 'build': (analysis or {}).get('build'), 'date': (analysis or {}).get('date')},
        'counters_available': bool(counters),
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
        d = game_detail(cfg, int(sys.argv[2]), fetch=True)
        print(json.dumps(d, indent=1, ensure_ascii=False)[:20000])
    elif cmd == 'scan':
        print(scan_and_analyze(cfg))
