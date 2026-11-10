"""Closing out leads: how often a player turns a resource lead into a win, mirrored against what opponents do with the
same lead against them, and what changes in the games where a lead is lost. Standard library only; reads the store.

Definitions (everything comes from replay order totals, net of cancelled orders; see README "Replays record orders"):
  lead(k)      resources this player ordered minus what the opponent ordered, cumulative to the end of minute k
  a lead       lead(k) >= L for two consecutive minutes; it is "taken" at the first such k (L defaults to 500)
  peak, gone   the largest lead from then on, and the first later minute at which lead(k) <= 0
  checkpoint   among games that ran at least MARGIN minutes past minute m, the win rate when lead(m) falls in a bin;
               the mirror is the opponent's win rate when -lead(m) falls in the same bin (the same games, other side)
  the window   the WINDOW minutes after a lead is taken, compared between leads that were converted and leads lost
  the collapse the minutes from the peak of a lost lead until it was gone (capped), against the five minutes before

    py -3 tools/closing.py 6520235                          # text report for one player
    py -3 tools/closing.py 6520235 --lead 1000 --at 20 --kind rm_1v1 --civ french --vs mongols --since 2026-09-01
"""
import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from tools import store  # noqa: E402

ONE_V_ONE = ('rm_1v1', 'qm_1v1')
LEAD = 500             # resources; a lead of at least this much, held two minutes running
WINDOW = 5             # minutes examined after a lead is taken
MARGIN = 2             # a checkpoint counts only when the game ran this many more minutes
CAP = 10               # minutes after the peak examined when a lead is lost
MIN_N = 10             # fewer games than this and a per-minute median is not drawn ...
MIN_SHARE = 0.2        # ... nor when fewer than this share of the group is still playing (late minutes describe only long games)
CHECKPOINTS = (10, 15, 20)
LENGTH_BINS = ((0, 20, 'under 20 min'), (20, 30, '20–30 min'), (30, 45, '30–45 min'), (45, 10 ** 6, '45 min or longer'))
BOOT = 600             # bootstrap resamples behind every interval on a median
TRAJECTORY_MINUTES = 60

# ----------------------------------------------------------------------------- small statistics, no numpy


def wilson(k, n, z=1.96):
    """A proportion with its 95% Wilson score interval."""
    k = int(k)
    if not n:
        return {'k': k, 'n': n, 'rate': None, 'lo': None, 'hi': None}
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return {'k': k, 'n': n, 'rate': p, 'lo': (c - r) / d, 'hi': (c + r) / d}


def newcombe(a, b):
    """95% interval for the difference of two proportions a - b (dicts from wilson), Newcombe's hybrid score method."""
    if not a or not b or not a['n'] or not b['n']:
        return None
    d = a['rate'] - b['rate']
    return {'value': d, 'lo': d - math.sqrt((a['rate'] - a['lo']) ** 2 + (b['hi'] - b['rate']) ** 2),
            'hi': d + math.sqrt((a['hi'] - a['rate']) ** 2 + (b['rate'] - b['lo']) ** 2)}


def quantile(xs, q):
    s = sorted(x for x in xs if x is not None)
    if not s:
        return None
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def median(xs):
    return quantile(xs, 0.5)


def boot(fn, *samples, B=BOOT, seed=7):
    """Percentile bootstrap 95% interval of fn(*samples), resampling every sample with replacement (fixed seed)."""
    if any(not s for s in samples):
        return None, None
    rng = random.Random(seed)
    vals = []
    for _ in range(B):
        v = fn(*[rng.choices(s, k=len(s)) for s in samples])
        if v is not None:
            vals.append(v)
    return (quantile(vals, .025), quantile(vals, .975)) if vals else (None, None)


def rank_auc(a, b):
    """P(a random value of `a` exceeds a random value of `b`), ties counted half; 0.5 means no difference."""
    if not a or not b:
        return None
    allv = sorted([(v, 0) for v in a] + [(v, 1) for v in b], key=lambda x: x[0])
    rank_sum, i = 0.0, 0
    while i < len(allv):
        j = i
        while j + 1 < len(allv) and allv[j + 1][0] == allv[i][0]:
            j += 1
        r = (i + j) / 2 + 1
        rank_sum += r * sum(1 for t in range(i, j + 1) if allv[t][1] == 0)
        i = j + 1
    return (rank_sum - len(a) * (len(a) + 1) / 2) / (len(a) * len(b))


# ----------------------------------------------------------------------------- the games


def _opp_of(s):
    o = s.get('opponents') or []
    return o[0] if len(o) == 1 else None


def load_games(pid, kinds=None, civ=None, vs=None, since=None, until=None):
    """Every 1v1 of this player with a stored summary for both sides and per-minute series in both.
    Returns (games, skipped) where each game carries the cumulative lead series `gap` (end of minute 1, 2, ...)."""
    pid = int(pid)
    kinds = list(kinds or ONE_V_ONE)
    mine = [s for s in store.stats_for(pid, civ=civ or None, kinds=kinds)
            if s.get('result') in ('win', 'loss') and _opp_of(s)
            and (not vs or _opp_of(s).get('civilization') == vs)
            and (not since or (s.get('started_at') or '') >= since)
            and (not until or (s.get('started_at') or '')[:10] <= until)]
    ids = [s['game_id'] for s in mine]
    others = store.stats_for_games(ids, exclude_profile=pid)
    players = store.players_for_games(ids)
    games, skipped = [], {'no_opponent_summary': 0, 'no_series': 0}
    for s in mine:
        opp = _opp_of(s)
        o = (others.get(s['game_id']) or {}).get(opp.get('profile_id'))
        if o is None:
            skipped['no_opponent_summary'] += 1
            continue
        mm, om = s.get('minutes') or {}, o.get('minutes') or {}
        if not mm.get('spend') or not om.get('spend'):
            skipped['no_series'] += 1
            continue
        n = min(len(mm['spend']), len(om['spend']))
        gap, acc = [], 0
        for i in range(n):
            acc += mm['spend'][i] - om['spend'][i]
            gap.append(acc)
        duration = int(s.get('duration') or n * 60)
        pl = players.get(s['game_id']) or {}
        me_p, op_p = pl.get(pid) or {}, pl.get(opp.get('profile_id')) or {}
        games.append({
            'game_id': s['game_id'], 'started_at': s.get('started_at'), 'map': s.get('map'), 'kind': s.get('kind'), 'duration': duration,
            'full': min(n, duration // 60), 'win': s['result'] == 'win', 'civ': s.get('civ'), 'opp_civ': opp.get('civilization'),
            'opp_name': opp.get('name') or op_p.get('name'), 'opp_id': opp.get('profile_id'), 'my_name': me_p.get('name'),
            'my_rating': me_p.get('rating'), 'opp_rating': op_p.get('rating') if op_p.get('rating') is not None else opp.get('rating'),
            'rating_diff': s.get('rating_diff'), 'gap': gap, 'me': mm, 'opp': om,
            'ages_me': s.get('ages') or [], 'ages_opp': o.get('ages') or [], 'tcs_me': s.get('town_centers') or [], 'tcs_opp': o.get('town_centers') or [],
        })
    games.sort(key=lambda g: g.get('started_at') or '', reverse=True)
    return games, skipped


def lead_events(gap, L):
    """When a lead of L was taken (two consecutive minutes at or above L), its peak, and when it was gone; or None."""
    n = len(gap)
    k0 = next((k for k in range(1, n) if gap[k - 1] >= L and gap[k] >= L), None)
    if k0 is None:
        return None
    peak_at = max(range(k0, n + 1), key=lambda k: gap[k - 1])
    gone = next((k for k in range(peak_at + 1, n + 1) if gap[k - 1] <= 0), None)
    return {'lead_at': k0, 'peak': gap[peak_at - 1], 'peak_at': peak_at, 'gone_at': gone, 'end': gap[-1]}


def _zero_run(xs):
    best = cur = 0
    for v in xs:
        cur = cur + 1 if not v else 0
        best = max(best, cur)
    return best


def window(m, a, b, ages=(), tcs=()):
    """One player's order rates over minute buckets [a, b) and what happened in that span."""
    k = b - a
    if k <= 0:
        return None
    mil, spend = sum(m['mil_spend'][a:b]), sum(m['spend'][a:b])
    lo, hi = a * 60, b * 60
    return {'mil_pm': mil / k, 'eco_pm': (spend - mil) / k, 'spend_pm': spend / k, 'vil_pm': sum(m['villagers'][a:b]) / k,
            'units_pm': sum(m['military'][a:b]) / k, 'techs': sum(m['techs'][a:b]), 'cancels': sum(m['cancels'][a:b]),
            'vil_gap': _zero_run(m['villagers'][a:b]),
            'aged_up': any(lo <= (x.get('time') if isinstance(x, dict) else -1) < hi for x in ages),
            'tc': any(lo <= t < hi for t in tcs if t is not None)}


# ----------------------------------------------------------------------------- the report

AFTER_ROWS = [
    ('me', 'mil_pm', 'Military spend per minute', 'median'),
    ('me', 'eco_pm', 'Economy and technology spend per minute', 'median'),
    ('me', 'vil_pm', 'Villagers queued per minute', 'median'),
    ('me', 'units_pm', 'Military units queued per minute', 'median'),
    ('me', 'techs', 'Technologies researched', 'median'),
    ('me', 'cancels', 'Orders cancelled', 'median'),
    ('me', 'vil_gap', 'Longest gap in villager production (minutes)', 'median'),
    ('me', 'aged_up', 'Aged up in the window', 'share'),
    ('me', 'tc', 'Placed a Town Center in the window', 'share'),
    ('opp', 'mil_pm', 'Opponent: military spend per minute', 'median'),
    ('opp', 'eco_pm', 'Opponent: economy and technology spend per minute', 'median'),
    ('opp', 'vil_pm', 'Opponent: villagers queued per minute', 'median'),
    ('opp', 'units_pm', 'Opponent: military units queued per minute', 'median'),
    ('opp', 'aged_up', 'Opponent aged up in the window', 'share'),
    ('opp', 'tc', 'Opponent placed a Town Center in the window', 'share'),
]
COLLAPSE_ROWS = [
    ('me', 'mil_pm', 'My military spend per minute'), ('opp', 'mil_pm', "Opponent's military spend per minute"),
    ('me', 'units_pm', 'My military units queued per minute'), ('opp', 'units_pm', "Opponent's military units queued per minute"),
    ('me', 'eco_pm', 'My economy and technology spend per minute'), ('opp', 'eco_pm', "Opponent's economy and technology spend per minute"),
    ('me', 'vil_pm', 'My villagers queued per minute'), ('opp', 'vil_pm', "Opponent's villagers queued per minute"),
]


def _bins(L):
    return [{'key': 'even', 'label': f'within ±{L:,}', 'lo': 0, 'hi': L},
            {'key': 'b1', 'label': f'{L:,}–{2 * L:,}', 'lo': L, 'hi': 2 * L},
            {'key': 'b2', 'label': f'{2 * L:,}–{4 * L:,}', 'lo': 2 * L, 'hi': 4 * L},
            {'key': 'b3', 'label': f'{4 * L:,} or more', 'lo': 4 * L, 'hi': math.inf}]


def checkpoint(games, at, L):
    """Conversion at minute `at`: my win rate by lead bin, the opponent's by the mirrored bin, overall and by game length."""
    rows = [(g, g['gap'][at - 1]) for g in games if g['duration'] >= (at + MARGIN) * 60 and len(g['gap']) >= at]
    out = {'at': at, 'n': len(rows), 'bins': [], 'by_length': [],
           'median_spend': median([sum(g['me']['spend'][:at]) for g, _ in rows])}
    for b in _bins(L):
        if b['key'] == 'even':
            me, op = [g for g, v in rows if abs(v) < L], None
        else:
            me = [g for g, v in rows if b['lo'] <= v < b['hi']]
            op = [g for g, v in rows if b['lo'] <= -v < b['hi']]
        out['bins'].append({'key': b['key'], 'label': b['label'], 'lo': b['lo'], 'hi': None if b['hi'] == math.inf else b['hi'],
                            'me': wilson(sum(g['win'] for g in me), len(me)),
                            'opp': wilson(sum(not g['win'] for g in op), len(op)) if op is not None else None})
    ahead = [g for g, v in rows if v >= L]
    behind = [g for g, v in rows if -v >= L]
    me_all = wilson(sum(g['win'] for g in ahead), len(ahead))
    op_all = wilson(sum(not g['win'] for g in behind), len(behind))
    out['overall'] = {'me': me_all, 'opp': op_all, 'diff': newcombe(op_all, me_all)}
    for lo, hi, label in LENGTH_BINS:
        a = [g for g in ahead if lo * 60 <= g['duration'] < hi * 60]
        b = [g for g in behind if lo * 60 <= g['duration'] < hi * 60]
        out['by_length'].append({'label': label, 'me': wilson(sum(g['win'] for g in a), len(a)), 'opp': wilson(sum(not g['win'] for g in b), len(b))})
    return out


def trajectory(groups):
    """Median lead by minute (with quartiles) for each group of games; minutes with fewer than MIN_N games are None."""
    out = {'minutes': list(range(1, TRAJECTORY_MINUTES + 1))}
    last = 0
    for name, gs in groups.items():
        ns, med, q1, q3 = [], [], [], []
        need = max(MIN_N, math.ceil(MIN_SHARE * len(gs)))
        for k in range(1, TRAJECTORY_MINUTES + 1):
            vals = [g['gap'][k - 1] for g in gs if g['full'] >= k]
            ns.append(len(vals))
            if len(vals) >= need:
                med.append(median(vals))
                q1.append(quantile(vals, .25))
                q3.append(quantile(vals, .75))
                last = max(last, k)
            else:
                med.append(None)
                q1.append(None)
                q3.append(None)
        out[name] = {'n': ns, 'median': med, 'q1': q1, 'q3': q3}
    for name in list(groups) + ['minutes']:   # trim the tail nothing is drawn for
        if name == 'minutes':
            out['minutes'] = out['minutes'][:last]
        else:
            out[name] = {k: v[:last] for k, v in out[name].items()}
    return out


def compare_after(conv, lost):
    """The window after taking a lead: converted leads against lost leads, metric by metric, with intervals."""
    rows = []
    for who, key, label, kind in AFTER_ROWS:
        a = [g['after'][who][key] for g in conv if g.get('after')]
        b = [g['after'][who][key] for g in lost if g.get('after')]
        row = {'who': who, 'key': key, 'label': label, 'kind': kind, 'n_converted': len(a), 'n_lost': len(b)}
        if not a or not b:
            continue
        if kind == 'median':
            lo, hi = boot(lambda x, y: median(y) - median(x), a, b)
            row.update({'converted': median(a), 'lost': median(b), 'diff': median(b) - median(a), 'lo': lo, 'hi': hi, 'auc': rank_auc(b, a)})
        else:
            wa, wb = wilson(sum(a), len(a)), wilson(sum(b), len(b))
            d = newcombe(wb, wa)
            row.update({'converted': wa['rate'], 'lost': wb['rate'], 'diff': d['value'] if d else None, 'lo': d['lo'] if d else None, 'hi': d['hi'] if d else None, 'auc': None})
        rows.append(row)
    return rows


def collapse(lost):
    """Lost leads: the minutes from the peak until the lead was gone (capped at CAP), against the five minutes before the peak."""
    with_window = []
    for g in lost:
        ev = g['lead']
        p = ev['peak_at']
        end_b = min(ev['gone_at'] if ev['gone_at'] else g['full'], p + CAP)
        if end_b - p < 2:
            continue
        a0 = max(0, p - 5)
        g['collapse'] = {'before': {'me': window(g['me'], a0, p, g['ages_me'], g['tcs_me']), 'opp': window(g['opp'], a0, p, g['ages_opp'], g['tcs_opp'])},
                         'after': {'me': window(g['me'], p, end_b, g['ages_me'], g['tcs_me']), 'opp': window(g['opp'], p, end_b, g['ages_opp'], g['tcs_opp'])},
                         'minutes': end_b - p}
        with_window.append(g)
    rows = []
    for who, key, label in COLLAPSE_ROWS:
        before = [g['collapse']['before'][who][key] for g in with_window]
        after = [g['collapse']['after'][who][key] for g in with_window]
        deltas = [x - y for x, y in zip(after, before)]
        if not deltas:
            continue
        lo, hi = boot(median, deltas)
        rows.append({'who': who, 'key': key, 'label': label, 'before': median(before), 'after': median(after), 'delta': median(deltas), 'lo': lo, 'hi': hi, 'n': len(deltas)})

    def share(key, label, pred):
        hits = [bool(pred(g['collapse'])) for g in with_window]
        return {'key': key, 'label': label, **wilson(sum(hits), len(hits))}
    shares = [
        share('me_mil_down', 'My military spend fell by 30% or more', lambda c: c['before']['me']['mil_pm'] > 0 and c['after']['me']['mil_pm'] <= 0.7 * c['before']['me']['mil_pm']),
        share('opp_mil_up', "The opponent's military spend rose by 30% or more", lambda c: (c['before']['opp']['mil_pm'] > 0 and c['after']['opp']['mil_pm'] >= 1.3 * c['before']['opp']['mil_pm']) or (c['before']['opp']['mil_pm'] == 0 and c['after']['opp']['mil_pm'] > 0)),
        share('me_vil_stop', 'I queued no villager for 3 minutes or more', lambda c: c['after']['me']['vil_gap'] >= 3),
        share('me_aged', 'I aged up during the collapse', lambda c: c['after']['me']['aged_up']),
        share('opp_aged', 'The opponent aged up during the collapse', lambda c: c['after']['opp']['aged_up']),
        share('me_tc', 'I placed a Town Center during the collapse', lambda c: c['after']['me']['tc']),
        share('me_cancels', 'I cancelled 3 or more orders', lambda c: c['after']['me']['cancels'] >= 3),
    ]
    collapsed = [g for g in lost if g['lead']['gone_at'] is not None]
    return {'n': len(lost), 'n_with_window': len(with_window), 'collapsed': len(collapsed), 'held': len(lost) - len(collapsed),
            'median_peak': median([g['lead']['peak'] for g in lost]), 'median_peak_at': median([g['lead']['peak_at'] for g in lost]),
            'median_minutes_to_gone': median([g['lead']['gone_at'] - g['lead']['peak_at'] for g in collapsed]),
            'median_end_when_held': median([g['lead']['end'] for g in lost if g['lead']['gone_at'] is None]),
            'rows': rows, 'shares': shares}


def _note(g):
    ev, c, bits = g['lead'], g.get('collapse'), []
    if ev['gone_at'] is None:
        bits.append(f"still +{ev['end']:,.0f} in orders at the end")
    else:
        bits.append(f"lead gone by {ev['gone_at']}:00, {ev['gone_at'] - ev['peak_at']} min after the peak")
    if c:
        b, a, ob, oa = c['before']['me'], c['after']['me'], c['before']['opp'], c['after']['opp']
        if b['mil_pm'] > 0 and a['mil_pm'] <= 0.7 * b['mil_pm']:
            bits.append(f"my military spend fell from {b['mil_pm']:,.0f} to {a['mil_pm']:,.0f} a minute after the peak")
        if oa['mil_pm'] >= 1.3 * ob['mil_pm'] and oa['mil_pm'] - ob['mil_pm'] >= 100:
            bits.append(f"the opponent's rose from {ob['mil_pm']:,.0f} to {oa['mil_pm']:,.0f}")
        if b['eco_pm'] > 0 and a['eco_pm'] <= 0.5 * b['eco_pm']:
            bits.append(f"my economy and technology spend fell from {b['eco_pm']:,.0f} to {a['eco_pm']:,.0f}")
        if a['vil_gap'] >= 3:
            bits.append(f"no villager queued for {a['vil_gap']} min")
        if a['aged_up'] and not oa['aged_up']:
            bits.append('I aged up during the collapse')
        if oa['aged_up'] and not a['aged_up']:
            bits.append('the opponent aged up during the collapse')
        if a['cancels'] >= 3:
            bits.append(f"{a['cancels']} orders cancelled")
    return '; '.join(bits)


def report(pid, kinds=None, civ=None, vs=None, since=None, until=None, lead=LEAD):
    pid, L = int(pid), int(lead)
    games, skipped = load_games(pid, kinds, civ, vs, since, until)
    for g in games:
        g['lead'] = lead_events(g['gap'], L)
        g['opp_lead'] = lead_events([-x for x in g['gap']], L)
        if g['lead'] and g['duration'] >= (g['lead']['lead_at'] + WINDOW) * 60:
            k0 = g['lead']['lead_at']
            g['after'] = {'me': window(g['me'], k0, k0 + WINDOW, g['ages_me'], g['tcs_me']), 'opp': window(g['opp'], k0, k0 + WINDOW, g['ages_opp'], g['tcs_opp'])}
    mine = [g for g in games if g['lead']]
    theirs = [g for g in games if g['opp_lead']]
    conv, lost = [g for g in mine if g['win']], [g for g in mine if not g['win']]
    their_conv = [g for g in theirs if not g['win']]
    coll = collapse(lost)
    counters = store.counters_for_games([g['game_id'] for g in lost])
    review = []
    for g in sorted(lost, key=lambda x: -x['lead']['peak']):
        ev = g['lead']
        cs = counters.get(g['game_id']) or {}
        review.append({'game_id': g['game_id'], 'started_at': g['started_at'], 'map': g['map'], 'kind': g['kind'], 'duration': g['duration'],
                       'civ': g['civ'], 'opp_civ': g['opp_civ'], 'opp_name': g['opp_name'], 'opp_id': g['opp_id'],
                       'my_rating': g['my_rating'], 'opp_rating': g['opp_rating'], 'rating_diff': g['rating_diff'],
                       'lead_at': ev['lead_at'], 'peak': ev['peak'], 'peak_at': ev['peak_at'], 'gone_at': ev['gone_at'], 'end': ev['end'],
                       'held': ev['gone_at'] is None, 'note': _note(g),
                       'counters': {'me': {k: (cs.get(pid) or {}).get(k) for k in ('kills', 'units_lost')}, 'opp': {k: (cs.get(g['opp_id']) or {}).get(k) for k in ('kills', 'units_lost')}} if cs else None})
    name = next((g['my_name'] for g in games if g.get('my_name')), None)
    return {
        'profile_id': pid, 'name': name,
        'params': {'lead': L, 'window': WINDOW, 'margin': MARGIN, 'cap': CAP, 'min_n': MIN_N, 'min_share': MIN_SHARE, 'boot': BOOT, 'kinds': list(kinds or ONE_V_ONE), 'civ': civ or None, 'vs': vs or None, 'since': since or None, 'until': until or None},
        'counts': {'games': len(games), 'wins': sum(g['win'] for g in games), 'losses': sum(not g['win'] for g in games), 'skipped': skipped,
                   'median_duration': median([g['duration'] for g in games])},
        'leads': {
            'me': {**wilson(len(conv), len(mine)), 'lost': len(lost), 'lost_collapsed': coll['collapsed'], 'lost_held': coll['held'],
                   'median_peak': median([g['lead']['peak'] for g in mine]), 'median_lead_at': median([g['lead']['lead_at'] for g in mine]),
                   'median_peak_converted': median([g['lead']['peak'] for g in conv]), 'median_peak_lost': median([g['lead']['peak'] for g in lost])},
            'opp': {**wilson(len(their_conv), len(theirs)), 'lost': len(theirs) - len(their_conv),
                    'median_peak': median([g['opp_lead']['peak'] for g in theirs]), 'median_lead_at': median([g['opp_lead']['lead_at'] for g in theirs])},
        },
        'checkpoints': {str(at): checkpoint(games, at, L) for at in CHECKPOINTS},
        'trajectory': trajectory({'converted': conv, 'lost': lost}),
        'after_lead': {'n_converted': sum(1 for g in conv if g.get('after')), 'n_lost': sum(1 for g in lost if g.get('after')), 'rows': compare_after(conv, lost)},
        'collapse': coll,
        'review': review,
    }


# ----------------------------------------------------------------------------- text report


def _pct(w):
    return '—' if not w or w['rate'] is None else f"{w['rate'] * 100:.0f}% [{w['lo'] * 100:.0f}–{w['hi'] * 100:.0f}] n={w['n']}"


def _n(v, f='{:,.0f}'):
    return '—' if v is None else f.format(v)


def print_report(r, at=15):
    p, c, L = r['params'], r['counts'], r['params']['lead']
    print(f"Closing out leads · {r['name'] or r['profile_id']} · {c['games']} 1v1 games with both replay sides ({c['wins']} W / {c['losses']} L) · lead = {L:,} resources for 2 min")
    if any(c['skipped'].values()):
        print(f"  left out: {c['skipped']['no_opponent_summary']} without the opponent's summary, {c['skipped']['no_series']} without per-minute series")
    me, op = r['leads']['me'], r['leads']['opp']
    print(f"\nLeads taken: me {me['n']} (converted {_pct(me)}; lost {me['lost']}: {me['lost_collapsed']} collapsed, {me['lost_held']} still ahead at the end)")
    print(f"             opponents {op['n']} (converted {_pct(op)}; I came back in {op['lost']})")
    cp = r['checkpoints'][str(at)]
    print(f"\nAt {at}:00 (games that ran past {at + p['margin']}:00, n={cp['n']}; typical total ordered by then {_n(cp['median_spend'])}):")
    for b in cp['bins']:
        print(f"  {b['label']:<16} me ahead → I win {_pct(b['me'])}" + (f"   opponent ahead → they win {_pct(b['opp'])}" if b['opp'] else ''))
    o = cp['overall']
    d = o['diff']
    print(f"  ahead by {L:,}+     me {_pct(o['me'])}   opponents {_pct(o['opp'])}" + (f"   gap {d['value'] * 100:+.0f} pts [{d['lo'] * 100:+.0f}, {d['hi'] * 100:+.0f}]" if d else ''))
    print('  by final length (ahead by {:,}+ at {}:00):'.format(L, at))
    for row in cp['by_length']:
        print(f"    {row['label']:<18} me {_pct(row['me']):<24} opponents {_pct(row['opp'])}")
    al = r['after_lead']
    print(f"\nThe {p['window']} minutes after taking a lead · converted n={al['n_converted']} vs lost n={al['n_lost']} (median; difference lost − converted with 95% bootstrap interval; AUC = P(lost > converted))")
    for row in al['rows']:
        if row['kind'] == 'median':
            print(f"  {row['label']:<52} {row['converted']:>7.1f} {row['lost']:>7.1f}   Δ {row['diff']:+.1f} [{row['lo']:+.1f}, {row['hi']:+.1f}]   AUC {row['auc']:.2f}")
        else:
            print(f"  {row['label']:<52} {row['converted'] * 100:>6.0f}% {row['lost'] * 100:>6.0f}%   Δ {row['diff'] * 100:+.0f} pts [{row['lo'] * 100:+.0f}, {row['hi'] * 100:+.0f}]")
    co = r['collapse']
    print(f"\nLost leads: {co['n']} · peak median {_n(co['median_peak'])} at {_n(co['median_peak_at'])}:00 · {co['collapsed']} collapsed (median {_n(co['median_minutes_to_gone'])} min from peak to gone), {co['held']} still ahead at the end")
    print(f"  from the 5 min before the peak to the collapse (≤{p['cap']} min), n={co['n_with_window']}:")
    for row in co['rows']:
        print(f"    {row['label']:<48} {_n(row['before'], '{:>7.1f}')} → {_n(row['after'], '{:>7.1f}')}   Δ {_n(row['delta'], '{:+.1f}')} [{_n(row['lo'], '{:+.1f}')}, {_n(row['hi'], '{:+.1f}')}]")
    for s in co['shares']:
        print(f"    {s['label']:<48} {_pct(s)}")
    print('\nGames to review (largest lead lost first):')
    for g in r['review'][:12]:
        print(f"  {g['game_id']}  {(g['started_at'] or '')[:10]}  {g['civ']} vs {g['opp_civ']} ({g['opp_name']})  {g['map']}  {g['duration'] // 60} min  "
              f"lead at {g['lead_at']}:00, peak +{g['peak']:,.0f} at {g['peak_at']}:00 · {g['note']}")


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    opts = {argv[i][2:]: argv[i + 1] for i in range(len(argv) - 1) if argv[i].startswith('--')}
    if not args or not args[0].isdigit():
        print(__doc__)
        return 1
    r = report(int(args[0]), kinds=opts.get('kind', '').split(',') if opts.get('kind') else None, civ=opts.get('civ'), vs=opts.get('vs'),
               since=opts.get('since'), until=opts.get('until'), lead=int(opts.get('lead') or LEAD))
    if 'json' in opts or '--json' in argv:
        print(json.dumps(r, ensure_ascii=False, indent=1))
    else:
        print_report(r, at=int(opts.get('at') or 15))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
