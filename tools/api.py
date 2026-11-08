#!/usr/bin/env python3
"""
Query every data source behind Forge from a terminal, or open an interactive session.

    py -3 tools/api.py SOURCE PATH [key=value ...] [-p PATH] [-t] [-o FILE] [--post JSON] [--raw]
    py -3 tools/api.py shell

Sources
    aoe4world   https://aoe4world.com/api/v0            community API
    data        https://data.aoe4world.com              static game data (units, buildings, civs)
    official    https://aoe-api.worldsedgelink.com/community/   World's Edge backend (title=age4 added)
    local       http://127.0.0.1:8000/local/            the Forge companion (server.py must be running;
                                                        set FORGE_URL to point elsewhere)

Examples
    py -3 tools/api.py aoe4world /players/6520235
    py -3 tools/api.py aoe4world /players/6520235/games leaderboard=rm_solo limit=5 -p "games[*].map"
    py -3 tools/api.py aoe4world /leaderboards/rm_solo -t -p players
    py -3 tools/api.py official leaderboard/getPersonalStat "profile_ids=[6520235]"
    py -3 tools/api.py data /civilizations/english.json -p "overview[*].title"
    py -3 tools/api.py data /units/all.json -p "data[*].name"
    py -3 tools/api.py local profile/6520235 n=4 budget=6 -p tags
    py -3 tools/api.py local tournament/state as=6520235
    py -3 tools/api.py local tournament/signup as=6520235 --post '{"slot_id": "sat_18", "civs": ["english","french","rus"]}'

Paths use dots and brackets; `*` maps over an array: players[*].name, games[0].teams.
The shell pre-loads get(), aoe4world(), data(), official(), local(), pick() and show().
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

SOURCES = {
    'aoe4world': 'https://aoe4world.com/api/v0',
    'data': 'https://data.aoe4world.com',
    'official': 'https://aoe-api.worldsedgelink.com/community/',
    'local': os.environ.get('FORGE_URL', 'http://127.0.0.1:8000').rstrip('/') + '/local/',
}
UA = 'Forge-AoE4-prototype/0.1 (tools/api.py; personal use)'


def build_url(source, path, params=None):
    if source not in SOURCES:
        raise SystemExit(f"unknown source {source!r}; choose from {', '.join(SOURCES)}")
    base = SOURCES[source].rstrip('/')
    path, _, inline = str(path).partition('?')
    query = dict(urllib.parse.parse_qsl(inline, keep_blank_values=True))
    query.update({k: v for k, v in (params or {}).items() if v is not None and v != ''})
    if source == 'official':
        query.setdefault('title', 'age4')
    url = f"{base}/{path.lstrip('/')}"
    return url + ('?' + urllib.parse.urlencode(query) if query else '')


def get(source, path, params=None, post=None, timeout=60):
    """GET (or POST `post`, a dict or JSON string) and return the parsed JSON."""
    url = build_url(source, path, params)
    body = None
    headers = {'User-Agent': UA, 'Accept': 'application/json'}
    if post is not None:
        body = (post if isinstance(post, str) else json.dumps(post)).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=body, headers=headers, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            err = json.loads(raw)
        except Exception:  # noqa: BLE001
            err = raw[:400].decode('utf-8', 'replace')
        raise RuntimeError(f"HTTP {e.code} for {url}: {err}") from None
    except urllib.error.URLError as e:
        hint = ' (is server.py running? py -3 server.py)' if source == 'local' else ''
        raise RuntimeError(f"cannot reach {url}: {e.reason}{hint}") from None
    try:
        return json.loads(raw)
    except ValueError:
        return raw.decode('utf-8', 'replace')


def aoe4world(path, **params): return get('aoe4world', path, params)
def data(path, **params): return get('data', path, params)
def official(path, **params): return get('official', path, params)
def local(path, post=None, **params): return get('local', path, params, post=post)


def pick(obj, path):
    """Walk a dotted path (a.b[0].c); `*` maps over arrays or object values."""
    parts = [p for p in str(path or '').replace(']', '').replace('[', '.').split('.') if p]

    def walk(cur, i):
        while i < len(parts):
            if cur is None:
                return None
            p = parts[i]
            if p == '*':
                seq = cur if isinstance(cur, list) else list(cur.values()) if isinstance(cur, dict) else []
                return [walk(x, i + 1) for x in seq]
            if isinstance(cur, list):
                try:
                    cur = cur[int(p)]
                except (ValueError, IndexError):
                    return None
            elif isinstance(cur, dict):
                cur = cur.get(p)
            else:
                return None
            i += 1
        return cur
    return walk(obj, 0)


def table(rows, max_cols=12, max_rows=60):
    """Render a list of dicts (or scalars) as aligned columns."""
    if not isinstance(rows, list) or not rows:
        return json.dumps(rows, indent=1, ensure_ascii=False)
    if not all(isinstance(r, dict) for r in rows):
        return '\n'.join(str(r) for r in rows[:max_rows]) + (f"\n… {len(rows) - max_rows} more" if len(rows) > max_rows else '')
    cols = []
    for r in rows[:200]:
        for k, v in r.items():
            if k not in cols and not isinstance(v, (dict, list)):
                cols.append(k)
    cols = cols[:max_cols]
    cell = lambda v: '—' if v is None else str(v)  # noqa: E731
    width = {c: min(28, max(len(c), *(len(cell(r.get(c))) for r in rows[:max_rows]))) for c in cols}
    fmt_row = lambda vals: '  '.join(cell(v)[:width[c]].ljust(width[c]) for c, v in zip(cols, vals))  # noqa: E731
    out = [fmt_row(cols), fmt_row(['-' * width[c] for c in cols])]
    out += [fmt_row([r.get(c) for c in cols]) for r in rows[:max_rows]]
    if len(rows) > max_rows:
        out.append(f"… {len(rows) - max_rows} more rows")
    return '\n'.join(out)


def show(obj, path=None, as_table=False, limit=None):
    """Print a value (optionally picked by path) as JSON or as a table."""
    v = pick(obj, path) if path else obj
    text = table(v) if as_table else json.dumps(v, indent=1, ensure_ascii=False)
    print(text if limit is None or len(text) <= limit else text[:limit] + f"\n… {len(text) - limit} more characters (use -o FILE for all)")


def shell():
    import code
    banner = ("Forge API shell. Helpers: get(source, path, params), aoe4world(path, **q), data(path), "
              "official(path, **q), local(path, post=None, **q), pick(obj, 'a.b[0]'), show(obj, path, as_table=False).\n"
              "Example: p = aoe4world('/players/6520235'); show(p, 'modes.rm_solo')\n"
              "         show(aoe4world('/leaderboards/rm_solo'), 'players', as_table=True)")
    code.interact(banner=banner, local={**globals(), 'json': json}, exitmsg='')


def main(argv):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:  # noqa: BLE001
            pass
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__.strip())
        return 0
    if argv[0] == 'shell':
        shell()
        return 0
    if len(argv) < 2:
        print(__doc__.strip())
        return 2
    source, path, rest = argv[0], argv[1], argv[2:]
    params, sel, as_table, out, post, raw, limit = {}, None, False, None, None, False, 20000
    i = 0
    while i < len(rest):
        a = rest[i]
        if a in ('-p', '--path'):
            sel = rest[i + 1]; i += 1
        elif a in ('-t', '--table'):
            as_table = True
        elif a in ('-o', '--out'):
            out = rest[i + 1]; i += 1
        elif a == '--post':
            post = rest[i + 1]; i += 1
        elif a == '--raw':
            raw = True
        elif a == '--all':
            limit = None
        elif '=' in a and not a.startswith('-'):
            k, _, v = a.partition('=')
            params[k] = v
        else:
            print(f"unrecognised argument {a!r}", file=sys.stderr)
            return 2
        i += 1
    try:
        result = get(source, path, params, post=post)
    except RuntimeError as e:
        print(e, file=sys.stderr)
        return 1
    if out:
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=1, ensure_ascii=False)
        print(f"saved {out}")
        return 0
    if raw:
        print(json.dumps(result, ensure_ascii=False))
        return 0
    show(result, sel, as_table, limit)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
