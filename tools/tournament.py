"""Forge Cup: a monthly, Clash-style tournament prototype.

Format (1v1, best-of-3 series, 8-player single-elimination brackets grouped by rating):
  * one event per month on the third weekend, six start slots across the two days (UTC, shown local)
  * sign up any time until 24 h before your slot: connect a profile, pick a slot, declare a civ pool of 3-5
  * lock in between 60 and 10 minutes before the slot; anyone not locked in is dropped
  * at lock-in close the locked-in players of a slot are sorted by rating and cut into brackets of 8
    (seeded 1-8, byes fill a short bracket); brackets are revealed and drafting opens
  * mini draft per series from a 7-map pool: map bans (hi, lo, hi, lo) -> 3 maps; the lower seed picks the
    game-1 map, the higher seed game 2, the rest is game 3; each player bans one civ from the opponent's
    declared pool; each game both pick a civ from their remaining pool (blind, revealed together); a civ you
    WIN a game with is locked for the rest of the series, so a pool of three is always enough
  * results are reported by the players and, when possible, verified against AoE4 World match history

This is a prototype: identity is a claimed profile id (production would use Steam sign-in), everything is
stored in cache/tournament.json on the machine running the companion, and a demo clock lets you fast-forward.
"""
import json
import math
import random
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

from . import replays

STORE = replays.CACHE / 'tournament.json'
_lock = threading.Lock()

CIVS = ['abbasid_dynasty', 'ayyubids', 'byzantines', 'chinese', 'delhi_sultanate', 'english', 'french', 'golden_horde', 'holy_roman_empire',
        'house_of_lancaster', 'japanese', 'jeanne_darc', 'jin_dynasty', 'knights_templar', 'macedonian_dynasty', 'malians', 'mongols',
        'order_of_the_dragon', 'ottomans', 'rus', 'scots', 'sengoku_daimyo', 'tughlaq_dynasty', 'vikings', 'zhu_xis_legacy']
FALLBACK_MAPS = ['Dry Arabia', 'Gorge', 'Flankwoods', 'Himeyama', 'West Lake', 'King of the Hill', 'Atacama']
SLOT_DEFS = [  # (day offset from Saturday, hour UTC, label)
    (0, 13, 'Saturday · Europe afternoon'), (0, 19, 'Saturday · Europe evening / Americas afternoon'), (1, 1, 'Saturday night · Americas evening'),
    (1, 13, 'Sunday · Europe afternoon'), (1, 19, 'Sunday · Europe evening / Americas afternoon'), (2, 1, 'Sunday night · Americas evening'),
]
REG_CLOSE_H, LOCKIN_OPEN_MIN, LOCKIN_CLOSE_MIN, LIVE_H = 24, 60, 10, 4
ROUND_NAMES = {1: 'Quarterfinal', 2: 'Semifinal', 3: 'Final'}
BO = 3


# ----------------------------------------------------------------------------- store

def _default():
    return {'clock_offset': 0, 'entrants': {}, 'brackets': [], 'matches': {}, 'log': []}


def load():
    if STORE.exists():
        try:
            d = json.loads(STORE.read_text(encoding='utf-8'))
            for k, v in _default().items():
                d.setdefault(k, v)
            return d
        except Exception:  # noqa: BLE001
            pass
    return _default()


def save(st):
    STORE.write_text(json.dumps(st, ensure_ascii=False), encoding='utf-8')


def log(st, text):
    st['log'].append({'at': now_iso(st), 'text': text})
    st['log'] = st['log'][-60:]


# ----------------------------------------------------------------------------- clock + schedule

def now(st=None):
    off = (st or {}).get('clock_offset', 0)
    return datetime.now(timezone.utc) + timedelta(seconds=off)


def now_iso(st=None):
    return now(st).isoformat()


def third_saturday(y, m):
    first = datetime(y, m, 1, tzinfo=timezone.utc)
    return first + timedelta(days=(5 - first.weekday()) % 7 + 14)


def event_for(t):
    """The event whose weekend has not fully passed at time t."""
    y, m = t.year, t.month
    for _ in range(3):
        sat = third_saturday(y, m)
        last = sat + timedelta(days=SLOT_DEFS[-1][0], hours=SLOT_DEFS[-1][1] + LIVE_H)
        if t < last:
            break
        m += 1
        if m > 12:
            m, y = 1, y + 1
    slots = []
    for i, (d, h, label) in enumerate(SLOT_DEFS):
        start = sat + timedelta(days=d, hours=h)
        slots.append({'id': f's{i + 1}', 'start': start.isoformat(), 'label': label,
                      'registration_closes': (start - timedelta(hours=REG_CLOSE_H)).isoformat(),
                      'lockin_opens': (start - timedelta(minutes=LOCKIN_OPEN_MIN)).isoformat(),
                      'lockin_closes': (start - timedelta(minutes=LOCKIN_CLOSE_MIN)).isoformat(),
                      'ends': (start + timedelta(hours=LIVE_H)).isoformat()})
    name = sat.strftime('%B %Y')
    return {'id': sat.strftime('%Y-%m'), 'name': f'Forge Cup · {name}', 'weekend': sat.date().isoformat(), 'slots': slots, 'best_of': BO, 'bracket_size': 8}


def slot_phase(slot, t):
    p = lambda k: datetime.fromisoformat(slot[k])  # noqa: E731
    if t < p('registration_closes'):
        return 'registration'
    if t < p('lockin_opens'):
        return 'closed'
    if t < p('lockin_closes'):
        return 'lockin'
    if t < p('start'):
        return 'draft'
    if t < p('ends'):
        return 'live'
    return 'done'


def map_pool():
    try:
        d = replays.cached_json('stats_rm_solo_maps', replays.A4W + 'stats/rm_solo/maps', 86400)
        maps = [x['map'] for x in sorted(d.get('data') or [], key=lambda x: -(x.get('games_count') or 0))][:7]
        if len(maps) == 7:
            return maps
    except Exception:  # noqa: BLE001
        pass
    return FALLBACK_MAPS


# ----------------------------------------------------------------------------- entrants

def fetch_profile(pid, ladder='rm_solo'):
    p = json.loads(replays.http_get(replays.A4W + f'players/{pid}'))
    mode = (p.get('modes') or {}).get(ladder) or {}
    rating = mode.get('rating')
    provisional = False
    if rating is None:  # fall back to any ladder so unranked players can still enter (flagged)
        for k in ('rm_1v1_elo', 'rm_team', 'qm_1v1', 'qm_2v2'):
            r = ((p.get('modes') or {}).get(k) or {}).get('rating')
            if r:
                rating, provisional = r, True
                break
    civs = sorted(mode.get('civilizations') or [], key=lambda c: -(c.get('games_count') or 0))
    return {'profile_id': p['profile_id'], 'name': p.get('name'), 'country': p.get('country'), 'avatar': ((p.get('avatars') or {}).get('small') or ''),
            'rating': rating or 1000, 'rank_level': mode.get('rank_level'), 'rank': mode.get('rank'), 'games': mode.get('games_count'), 'win_rate': mode.get('win_rate'),
            'provisional': provisional or rating is None, 'top_civs': [c['civilization'] for c in civs[:5]], 'ladder': ladder}


def public_entrant(e):
    keys = ('profile_id', 'name', 'country', 'avatar', 'rating', 'rank_level', 'provisional', 'civs', 'slot', 'locked', 'demo', 'signed_up_at', 'ladder')
    return {k: e.get(k) for k in keys}


def signup(st, pid, slot_id, civs, ladder='rm_solo'):
    ev = event_for(now(st))
    slot = next((s for s in ev['slots'] if s['id'] == slot_id), None)
    if not slot:
        raise ValueError('unknown slot')
    if slot_phase(slot, now(st)) != 'registration':
        raise ValueError('registration for this slot is closed')
    civs = [c for c in dict.fromkeys(civs) if c in CIVS]
    if not 3 <= len(civs) <= 5:
        raise ValueError('declare between 3 and 5 civilizations')
    prof = fetch_profile(pid, ladder)
    e = st['entrants'].get(str(pid)) or {}
    e.update(prof)
    e.update({'civs': civs, 'slot': slot_id, 'locked': False, 'demo': e.get('demo', False), 'signed_up_at': now_iso(st)})
    st['entrants'][str(pid)] = e
    log(st, f"{e['name']} signed up for {slot['label']} with {', '.join(civs)}")
    return e


def withdraw(st, pid):
    e = st['entrants'].pop(str(pid), None)
    if e:
        log(st, f"{e['name']} withdrew")
    return e


def lockin(st, pid):
    e = st['entrants'].get(str(pid))
    if not e:
        raise ValueError('not signed up')
    ev = event_for(now(st))
    slot = next(s for s in ev['slots'] if s['id'] == e['slot'])
    if slot_phase(slot, now(st)) != 'lockin':
        raise ValueError('the lock-in window is not open for this slot')
    e['locked'] = True
    e['locked_at'] = now_iso(st)
    log(st, f"{e['name']} locked in")
    return e


def seed_demo(st, around_pid, n=7, ladder='rm_solo'):
    """Add n demo entrants with ratings close to `around_pid` from the live ladder (their real civ pools as declared civs)."""
    me = st['entrants'].get(str(around_pid))
    if not me:
        raise ValueError('sign up first, then add demo entrants around your rating')
    rank = me.get('rank') or 1
    page = max(1, math.ceil(rank / 50))
    cands = []
    for pg in (page, page + 1 if rank % 50 > 25 else page - 1):
        if pg < 1:
            continue
        try:
            d = json.loads(replays.http_get(replays.A4W + f'leaderboards/{ladder}?page={pg}'))
            cands += d.get('players') or []
        except Exception:  # noqa: BLE001
            pass
    cands = [c for c in cands if str(c['profile_id']) not in st['entrants'] and c.get('rating')]
    cands.sort(key=lambda c: abs((c['rating'] or 0) - me['rating']))
    added = []
    for c in cands[:n]:
        try:
            prof = fetch_profile(c['profile_id'], ladder)
        except Exception:  # noqa: BLE001
            continue
        civs = prof['top_civs'][:4] or random.sample(CIVS, 3)
        while len(civs) < 3:
            extra = random.choice(CIVS)
            if extra not in civs:
                civs.append(extra)
        e = {**prof, 'civs': civs, 'slot': me['slot'], 'locked': False, 'demo': True, 'signed_up_at': now_iso(st)}
        st['entrants'][str(c['profile_id'])] = e
        added.append(e)
    log(st, f"added {len(added)} demo entrants around {me['rating']} rating")
    return added


# ----------------------------------------------------------------------------- brackets + matches

SEED_PAIRS = [(1, 8), (4, 5), (2, 7), (3, 6)]


def form_brackets(st, slot_id, force=False):
    ev = event_for(now(st))
    slot = next(s for s in ev['slots'] if s['id'] == slot_id)
    if any(b['slot'] == slot_id for b in st['brackets']) and not force:
        return [b for b in st['brackets'] if b['slot'] == slot_id]
    if force:
        ids = [b['id'] for b in st['brackets'] if b['slot'] == slot_id]
        st['brackets'] = [b for b in st['brackets'] if b['slot'] != slot_id]
        st['matches'] = {k: v for k, v in st['matches'].items() if v['bracket'] not in ids}
    players = [e for e in st['entrants'].values() if e['slot'] == slot_id and (e['locked'] or e.get('demo'))]
    for e in players:
        e['locked'] = True
    players.sort(key=lambda e: -(e['rating'] or 0))
    groups = [players[i:i + 8] for i in range(0, len(players), 8)]
    if len(groups) > 1 and len(groups[-1]) < 4:   # a tiny tail bracket is worse than one slightly uneven bracket
        tail = groups.pop()
        groups[-1] += tail
        groups[-1].sort(key=lambda e: -(e['rating'] or 0))
    out = []
    for gi, grp in enumerate(groups):
        bid = f"{slot_id}-{chr(65 + gi)}"
        size = 8 if len(grp) <= 8 else 16
        seeds = {i + 1: e['profile_id'] for i, e in enumerate(grp)}
        ratings = [e['rating'] for e in grp]
        b = {'id': bid, 'slot': slot_id, 'label': f"Bracket {chr(65 + gi)}", 'band': [min(ratings), max(ratings)], 'size': size,
             'players': [{'seed': s, 'profile_id': pid} for s, pid in seeds.items()], 'matches': [], 'champion': None, 'formed_at': now_iso(st)}
        pairs = SEED_PAIRS if size == 8 else [(1, 16), (8, 9), (4, 13), (5, 12), (2, 15), (7, 10), (3, 14), (6, 11)]
        rounds = 3 if size == 8 else 4
        mid = 0
        prev = []
        for hi, lo in pairs:
            mid += 1
            m = new_match(st, bid, 1, mid, seeds.get(hi), seeds.get(lo), hi, lo, slot)
            prev.append(m['id'])
        b['matches'] += prev
        for r in range(2, rounds + 1):
            cur = []
            for i in range(0, len(prev), 2):
                mid += 1
                m = new_match(st, bid, r, mid, None, None, None, None, slot)
                m['feeds_from'] = [prev[i], prev[i + 1]]
                st['matches'][prev[i]]['feeds'] = m['id']
                st['matches'][prev[i + 1]]['feeds'] = m['id']
                cur.append(m['id'])
            b['matches'] += cur
            prev = cur
        st['brackets'].append(b)
        out.append(b)
        for mid_ in b['matches']:
            settle_byes(st, st['matches'][mid_])
    log(st, f"brackets formed for {slot['label']}: {len(out)} bracket(s), {len(players)} players")
    return out


def new_match(st, bid, rnd, pos, a, b, seed_a, seed_b, slot):
    start = datetime.fromisoformat(slot['start']) + timedelta(minutes=45 * (rnd - 1))
    mid = f"{bid}-r{rnd}m{pos}"
    m = {'id': mid, 'bracket': bid, 'round': rnd, 'pos': pos, 'a': a, 'b': b, 'seed_a': seed_a, 'seed_b': seed_b, 'scheduled': start.isoformat(),
         'winner': None, 'games': [], 'draft': None, 'feeds': None, 'feeds_from': None}
    st['matches'][mid] = m
    return m


def settle_byes(st, m):
    """A match with one empty side is a bye: the present player advances immediately."""
    if m['winner'] or m['round'] != 1:
        return
    if m['a'] and not m['b']:
        finish(st, m, m['a'], bye=True)
    elif m['b'] and not m['a']:
        finish(st, m, m['b'], bye=True)


def finish(st, m, winner, bye=False):
    m['winner'] = winner
    m['bye'] = bye
    b = next(x for x in st['brackets'] if x['id'] == m['bracket'])
    if m['feeds']:
        nxt = st['matches'][m['feeds']]
        side = 'a' if nxt['feeds_from'][0] == m['id'] else 'b'
        nxt[side] = winner
        nxt[f'seed_{side}'] = seed_of(b, winner)
        if nxt['a'] and nxt['b'] and not nxt['draft']:
            nxt['draft'] = new_draft(nxt, st)
    else:
        b['champion'] = winner
        log(st, f"{name_of(st, winner)} wins {b['label']}")
    if not bye:
        log(st, f"{name_of(st, winner)} wins {ROUND_NAMES.get(m['round'], 'round ' + str(m['round']))} {m['id']}")


def seed_of(b, pid):
    return next((p['seed'] for p in b['players'] if p['profile_id'] == pid), None)


def name_of(st, pid):
    e = st['entrants'].get(str(pid))
    return e['name'] if e else f'#{pid}'


# ----------------------------------------------------------------------------- draft

def new_draft(m, st):
    hi, lo = ('a', 'b') if (m['seed_a'] or 99) <= (m['seed_b'] or 99) else ('b', 'a')
    steps = [{'type': 'ban_map', 'by': hi}, {'type': 'ban_map', 'by': lo}, {'type': 'ban_map', 'by': hi}, {'type': 'ban_map', 'by': lo},
             {'type': 'pick_map', 'by': lo, 'game': 1}, {'type': 'pick_map', 'by': hi, 'game': 2},
             {'type': 'ban_civ', 'by': hi}, {'type': 'ban_civ', 'by': lo},
             {'type': 'pick_civ', 'game': 1}, {'type': 'result', 'game': 1}]
    return {'hi': hi, 'lo': lo, 'map_pool': map_pool(), 'steps': steps, 'index': 0, 'map_bans': {'a': [], 'b': []}, 'maps': {},
            'civ_bans': {'a': None, 'b': None}, 'picks': {}, 'locked': {'a': [], 'b': []}, 'started_at': now_iso(st)}


def ensure_drafts(st):
    for m in st['matches'].values():
        if m['a'] and m['b'] and not m['draft'] and not m['winner']:
            m['draft'] = new_draft(m, st)


def available_civs(st, m, side):
    e = st['entrants'].get(str(m[side])) or {}
    d = m['draft']
    banned = d['civ_bans'][side]
    return [c for c in e.get('civs', []) if c != banned and c not in d['locked'][side]]


def draft_action(st, mid, actor_pid, value, side_override=None):
    m = st['matches'].get(mid)
    if not m or not m['draft']:
        raise ValueError('no draft for this match')
    d = m['draft']
    if d['index'] >= len(d['steps']):
        raise ValueError('draft is complete')
    step = d['steps'][d['index']]
    side = side_override or ('a' if m['a'] == actor_pid else 'b' if m['b'] == actor_pid else None)
    if side is None:
        raise ValueError('you are not in this match')
    t = step['type']
    if t in ('ban_map', 'pick_map', 'ban_civ', 'result') and step.get('by', side) != side and t != 'result':
        raise ValueError(f"it is {('the higher' if step['by'] == d['hi'] else 'the lower')} seed's turn")
    if t == 'ban_map':
        remaining = [x for x in d['map_pool'] if x not in d['map_bans']['a'] + d['map_bans']['b']]
        if value not in remaining:
            raise ValueError('that map is not available')
        d['map_bans'][side].append(value)
        d['index'] += 1
    elif t == 'pick_map':
        remaining = [x for x in d['map_pool'] if x not in d['map_bans']['a'] + d['map_bans']['b'] and x not in d['maps'].values()]
        if value not in remaining:
            raise ValueError('that map is not available')
        d['maps'][str(step['game'])] = value
        d['index'] += 1
        if step['game'] == 2:
            left = [x for x in remaining if x != value]
            d['maps']['3'] = left[0]
    elif t == 'ban_civ':
        other = 'b' if side == 'a' else 'a'
        pool = (st['entrants'].get(str(m[other])) or {}).get('civs', [])
        if value not in pool:
            raise ValueError("that civilization is not in the opponent's pool")
        d['civ_bans'][other] = value
        d['index'] += 1
    elif t == 'pick_civ':
        g = str(step['game'])
        if value not in available_civs(st, m, side):
            raise ValueError('that civilization is not available to you in this game')
        d['picks'].setdefault(g, {})[side] = value
        if 'a' in d['picks'][g] and 'b' in d['picks'][g]:
            d['index'] += 1
    elif t == 'result':
        raise ValueError('use report to record a result')
    return m


def report(st, mid, game, winner_pid, source='manual'):
    m = st['matches'].get(mid)
    if not m or not m['draft']:
        raise ValueError('no draft for this match')
    d = m['draft']
    step = d['steps'][d['index']] if d['index'] < len(d['steps']) else None
    if not step or step['type'] != 'result' or step['game'] != game:
        raise ValueError('this game is not ready for a result')
    if winner_pid not in (m['a'], m['b']):
        raise ValueError('winner must be one of the two players')
    g = str(game)
    wside = 'a' if winner_pid == m['a'] else 'b'
    picks = d['picks'].get(g, {})
    m['games'].append({'game': game, 'map': d['maps'].get(g), 'civ_a': picks.get('a'), 'civ_b': picks.get('b'), 'winner': winner_pid, 'source': source})
    if picks.get(wside):
        d['locked'][wside].append(picks[wside])   # winner's civ lock
    d['index'] += 1
    wins = {'a': sum(1 for x in m['games'] if x['winner'] == m['a']), 'b': sum(1 for x in m['games'] if x['winner'] == m['b'])}
    need = BO // 2 + 1
    if wins['a'] >= need or wins['b'] >= need:
        finish(st, m, m['a'] if wins['a'] >= need else m['b'])
    else:
        nxt = game + 1
        d['steps'] += [{'type': 'pick_civ', 'game': nxt}, {'type': 'result', 'game': nxt}]
    return m


def verify(st, mid):
    """Look for finished AoE4 World games between the two players since the scheduled time and record them in order."""
    m = st['matches'].get(mid)
    if not m or not (m['a'] and m['b']):
        raise ValueError('match has no two players yet')
    since = int(datetime.fromisoformat(m['scheduled']).timestamp()) - 15 * 60
    url = replays.A4W + f"players/{m['a']}/games?" + urllib.parse.urlencode({'opponent_profile_id': m['b'], 'since': since, 'limit': 20})
    d = json.loads(replays.http_get(url))
    games = [g for g in (d.get('games') or []) if not g.get('ongoing') and g.get('kind') in ('custom', 'rm_1v1', 'qm_1v1')]
    games.sort(key=lambda g: g['started_at'])
    recorded = 0
    for g in games:
        if m['winner']:
            break
        dd = m['draft']
        step = dd['steps'][dd['index']] if dd and dd['index'] < len(dd['steps']) else None
        if not step or step['type'] != 'result':
            break
        players = [x.get('player', x) for t in g.get('teams') or [] for x in t]
        winner = next((p['profile_id'] for p in players if p.get('result') == 'win'), None)
        if winner not in (m['a'], m['b']):
            continue
        report(st, mid, step['game'], winner, source='aoe4world')
        m['games'][-1]['game_id'] = g['game_id']
        m['games'][-1]['actual_map'] = g.get('map')
        recorded += 1
    return {'checked': len(games), 'recorded': recorded}


# ----------------------------------------------------------------------------- state for the client

def state(st, as_pid=None):
    t = now(st)
    ev = event_for(t)
    for s in ev['slots']:
        s['phase'] = slot_phase(s, t)
        s['entrants'] = sum(1 for e in st['entrants'].values() if e['slot'] == s['id'])
        s['locked'] = sum(1 for e in st['entrants'].values() if e['slot'] == s['id'] and e['locked'])
        if s['phase'] in ('draft', 'live', 'done') and not any(b['slot'] == s['id'] for b in st['brackets']) and s['entrants']:
            form_brackets(st, s['id'])
    ensure_drafts(st)
    me = st['entrants'].get(str(as_pid)) if as_pid else None
    my_matches = [m['id'] for m in st['matches'].values() if as_pid in (m['a'], m['b'])] if as_pid else []
    return {
        'now': t.isoformat(), 'clock_offset': st.get('clock_offset', 0), 'event': ev, 'map_pool': map_pool(), 'civs': CIVS,
        'entrants': [public_entrant(e) for e in sorted(st['entrants'].values(), key=lambda e: -(e['rating'] or 0))],
        'brackets': st['brackets'], 'matches': st['matches'], 'me': public_entrant(me) if me else None, 'my_matches': my_matches,
        'log': st['log'][-20:],
        'rules': {'best_of': BO, 'bracket_size': 8, 'civ_pool': [3, 5], 'map_bans_each': 2, 'civ_bans_each': 1, 'winner_civ_lock': True,
                  'registration_closes_hours_before': REG_CLOSE_H, 'lockin_window_minutes': [LOCKIN_OPEN_MIN, LOCKIN_CLOSE_MIN]},
    }


def jump_clock(st, target, slot_id=None, as_pid=None):
    """Demo clock: move 'now' relative to a slot (the caller's slot when not given)."""
    if target == 'reset':
        st['clock_offset'] = 0
        log(st, 'demo clock reset')
        return
    real = datetime.now(timezone.utc)
    ev = event_for(real)
    me = st['entrants'].get(str(as_pid)) if as_pid else None
    sid = slot_id or (me or {}).get('slot') or ev['slots'][0]['id']
    slot = next(s for s in ev['slots'] if s['id'] == sid)
    start = datetime.fromisoformat(slot['start'])
    targets = {'lockin': start - timedelta(minutes=LOCKIN_OPEN_MIN - 5), 'draft': start - timedelta(minutes=LOCKIN_CLOSE_MIN - 3), 'live': start + timedelta(minutes=2), 'done': start + timedelta(hours=LIVE_H + 1)}
    if target not in targets:
        raise ValueError('unknown clock target')
    st['clock_offset'] = int((targets[target] - real).total_seconds())
    log(st, f"demo clock moved to {target} for {slot['label']}")


def action(cfg, name, body, as_pid=None):
    with _lock:
        st = load()
        res = None
        if name == 'signup':
            res = signup(st, int(body['profile_id']), body['slot'], body.get('civs') or [], body.get('ladder') or 'rm_solo')
        elif name == 'withdraw':
            res = withdraw(st, int(body['profile_id']))
        elif name == 'lockin':
            res = lockin(st, int(body['profile_id']))
        elif name == 'seed_demo':
            res = seed_demo(st, int(body['profile_id']), int(body.get('n') or 7))
        elif name == 'form_brackets':
            res = form_brackets(st, body['slot'], force=bool(body.get('force')))
        elif name == 'draft':
            res = draft_action(st, body['match'], int(body['profile_id']), body['value'], body.get('side'))
        elif name == 'report':
            res = report(st, body['match'], int(body['game']), int(body['winner']))
        elif name == 'verify':
            res = verify(st, body['match'])
        elif name == 'clock':
            jump_clock(st, body['target'], body.get('slot'), as_pid)
        elif name == 'reset':
            st = _default()
            log(st, 'tournament state reset')
        else:
            raise ValueError('unknown action')
        save(st)
        out = state(st, as_pid)
        save(st)   # state() may have formed brackets / drafts lazily
        out['result'] = res if isinstance(res, (dict, list)) else None
        return out


def get_state(cfg, as_pid=None):
    with _lock:
        st = load()
        out = state(st, as_pid)
        save(st)
        return out
