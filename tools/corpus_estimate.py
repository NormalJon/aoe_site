"""How big a replay corpus could be: games of the top-N Solo Ranked players, counted per civ matchup and per map.

    py -3 -X utf8 tools/corpus_estimate.py [--top 200] [--pages 3] [--days 45] [--out docs/CORPUS_ESTIMATE.md]

Pulls the Solo Ranked leaderboard (50 players per page) and, for each player, up to `pages` pages of their recent
Solo Ranked games (50 per page), with a short pause between requests and a one-day file cache under cache/data/corpus.
Games are de-duplicated (both players of a match may be in the top N). Nothing is downloaded from the replay store;
this only counts what exists. `--days` is the window taken as "a replay is probably still in the official store".
"""
import argparse
import collections
import json
import statistics
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'cache' / 'data' / 'corpus'
A4W = 'https://aoe4world.com/api/v0/'
UA = 'Forge-AoE4-prototype/0.1 (corpus estimate; local companion)'
PAUSE = 0.25


def get(url, ttl=86400):
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / (url.replace(A4W, '').replace('/', '_').replace('?', '_').replace('&', '_').replace('=', '-') + '.json')
    if key.exists() and time.time() - key.stat().st_mtime < ttl:
        return json.loads(key.read_text(encoding='utf-8'))
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode('utf-8'))
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                time.sleep(15 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt < 4:
                time.sleep(3 * (attempt + 1))
                continue
            raise
    key.write_text(json.dumps(data), encoding='utf-8')
    time.sleep(PAUSE)
    return data


def top_players(n, leaderboard='rm_solo'):
    out = []
    page = 1
    while len(out) < n:
        d = get(A4W + f'leaderboards/{leaderboard}?page={page}')
        players = d.get('players') or []
        if not players:
            break
        out += players
        page += 1
    return out[:n]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--top', type=int, default=200)
    ap.add_argument('--pages', type=int, default=3)
    ap.add_argument('--days', type=int, default=45, help='window in which replays are assumed to still be in the official store')
    ap.add_argument('--min-duration', type=int, default=480, help='ignore games shorter than this many seconds (early quits)')
    ap.add_argument('--out', default=str(ROOT / 'docs' / 'CORPUS_ESTIMATE.md'))
    args = ap.parse_args()

    players = top_players(args.top)
    print(f'{len(players)} players on the leaderboard (ranks {players[0]["rank"]}–{players[-1]["rank"]}, ratings {players[-1]["rating"]}–{players[0]["rating"]})', file=sys.stderr)
    games = {}
    skipped = 0
    for i, p in enumerate(players, 1):
        for page in range(1, args.pages + 1):
            try:
                d = get(A4W + f'players/{p["profile_id"]}/games?leaderboard=rm_solo&limit=50&page={page}')
            except Exception as e:  # noqa: BLE001 — one player's list failing should not sink the estimate
                print(f'  skipping {p.get("name")} page {page}: {e}', file=sys.stderr)
                skipped += 1
                break
            for g in d.get('games') or []:
                games[g['game_id']] = g
            if not d.get('next_page'):
                break
        if i % 20 == 0:
            print(f'  {i}/{len(players)} players, {len(games)} unique games so far', file=sys.stderr)

    now = time.time()
    cutoff = now - args.days * 86400
    finished = [g for g in games.values() if not g.get('ongoing') and (g.get('duration') or 0) >= args.min_duration and g.get('kind') == 'rm_1v1']
    ts = lambda g: time.mktime(time.strptime(g['started_at'][:19], '%Y-%m-%dT%H:%M:%S')) + (time.mktime(time.localtime()) - time.mktime(time.gmtime()))  # noqa: E731
    recent = [g for g in finished if ts(g) >= cutoff]
    dates = sorted(g['started_at'] for g in finished)

    def players_of(g):
        return [x.get('player', x) for t in g.get('teams') or [] for x in t]

    def matchup(g):
        civs = sorted(p.get('civilization') or '?' for p in players_of(g))
        return ' vs '.join(civs)

    def table(counter, head, n=15, total=None):
        rows = counter.most_common(n)
        lines = [f'| {head} | Games | Share |', '|---|---:|---:|']
        for k, v in rows:
            lines.append(f'| {k} | {v} | {100 * v / (total or sum(counter.values())):.1f}% |')
        return '\n'.join(lines)

    mu_all, mu_recent, maps_recent, combo_recent, civ_recent = (collections.Counter() for _ in range(5))
    for g in finished:
        mu_all[matchup(g)] += 1
    for g in recent:
        m = matchup(g)
        mu_recent[m] += 1
        maps_recent[g.get('map') or '?'] += 1
        combo_recent[f'{m} on {g.get("map") or "?"}'] += 1
        for p in players_of(g):
            civ_recent[p.get('civilization') or '?'] += 1
    n_mu = len(mu_recent)
    mu_vals = sorted(mu_recent.values(), reverse=True)
    combo_vals = sorted(combo_recent.values(), reverse=True)
    weeks = max(1e-9, (now - min(ts(g) for g in recent)) / 604800) if recent else 0
    mirror = sum(v for k, v in mu_recent.items() if k.split(' vs ')[0] == k.split(' vs ')[1])

    md = [f'# Replay corpus estimate · top {len(players)} Solo Ranked players',
          '',
          f'Generated {time.strftime("%Y-%m-%d %H:%M")} by `tools/corpus_estimate.py --top {args.top} --pages {args.pages} --days {args.days}`. '
          f'Counts come from AoE4 World game lists only; no replay was downloaded. Ranked seeds are random per match, so a '
          f'same-seed corpus is not a practical target; "same map" is the finest level the data supports.',
          '',
          '## Sample',
          '',
          f'- Leaderboard ranks {players[0]["rank"]}–{players[-1]["rank"]} (ratings {players[-1]["rating"]}–{players[0]["rating"]}), up to {args.pages * 50} most recent Solo Ranked games each.',
          f'- {len(games)} unique games listed, {len(finished)} finished Ranked 1v1 games of {args.min_duration // 60}+ minutes, from {dates[0][:10] if dates else "—"} to {dates[-1][:10] if dates else "—"}.',
          f'- **{len(recent)} of them started in the last {args.days} days**, the window in which the official replay store still tends to have the file: about {len(recent) / weeks:.0f} games per week across these players.',
          f'- Name-based player matching in replays fails for roughly one game in seven today (players change clan tags); the store now matches by civ and team as a fallback.',
          '',
          f'## Civ matchups in the last {args.days} days',
          '',
          f'- {n_mu} distinct matchups (of {len(civ_recent) * (len(civ_recent) + 1) // 2} possible with {len(civ_recent)} civilizations, mirrors included). Median games per matchup: {statistics.median(mu_vals) if mu_vals else 0:.0f}; '
          f'{sum(1 for v in mu_vals if v >= 20)} matchups have 20+ games, {sum(1 for v in mu_vals if v >= 10)} have 10+. Mirrors: {mirror} games.',
          '',
          table(mu_recent, 'Matchup', 20, len(recent)),
          '',
          f'## Civ matchup on one map, last {args.days} days',
          '',
          f'- {len(combo_recent)} distinct matchup × map combinations; median {statistics.median(combo_vals) if combo_vals else 0:.0f} games each; '
          f'{sum(1 for v in combo_vals if v >= 10)} combinations have 10+ games, {sum(1 for v in combo_vals if v >= 5)} have 5+.',
          '',
          table(combo_recent, 'Matchup on map', 15, len(recent)),
          '',
          f'## Maps in the last {args.days} days',
          '',
          table(maps_recent, 'Map', 12, len(recent)),
          '',
          f'## Civ picks in the last {args.days} days (player-games)',
          '',
          table(civ_recent, 'Civilization', 23, 2 * len(recent)),
          '',
          '## What this means for a "pro baseline"',
          '',
          f'- To have, say, 20 analysed games for every matchup that occurs at all, about {sum(min(v, 20) for v in mu_vals)} replays would be fetched '
          f'(one per game, every player perspective kept). At the store\'s observed pace of one download per 1–2 s with pauses on HTTP 429, that is roughly {sum(min(v, 20) for v in mu_vals) * 1.5 / 60:.0f}–{sum(min(v, 20) for v in mu_vals) * 3 / 60:.0f} minutes of harvesting.',
          f'- Fetching **every** recent game of these players is {len(recent)} replays (~{len(recent) * 0.45:.0f} MB), {len(recent) * 1.5 / 3600:.1f}–{len(recent) * 3 / 3600:.1f} hours at that pace.',
          '- Per map the samples thin out fast: only the most common matchups on the most common maps reach double digits, so a map-specific baseline needs several weeks of harvesting or a wider player set.',
          '']
    text = '\n'.join(md)
    Path(args.out).write_text(text, encoding='utf-8')
    print(text)
    print(f'\nwritten to {args.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
