"""Background harvester: lists a player's whole game history on AoE4 World, then fetches and analyses every replay the
official store still has, one at a time, backing off on HTTP 429, and keeps every player's perspective of each game in
the store (tools/store.py). One worker thread serves a queue of players, so the replay store is never hit from two
places at once and a profile page never has to wait for it.

    GET /local/harvest/<pid>?start=1&pages=20   queue a player (pages × 50 games of history, max 40 pages)
    GET /local/harvest/<pid>                    progress
    GET /local/harvest/<pid>?stop=1             stop after the current replay
"""
import json
import queue
import threading
import time
import traceback

try:
    from . import replays, store
except ImportError:  # run as a script
    import replays
    import store

MIN_DURATION = 480          # seconds; shorter games are early quits with nothing to learn
PAUSE = 1.2                 # seconds between store downloads
BACKOFF_START, BACKOFF_MAX = 20, 120

_q = queue.Queue()
_worker = None
_lock = threading.Lock()          # serialises request(): row + queue entry
_worker_lock = threading.Lock()   # worker thread creation
_stop = set()
_current = None
ACTIVE = ('queued', 'running')


def _queued(pid):
    return any(item[0] == pid for item in list(_q.queue))


def request(cfg, pid, pages=20):
    """Queue a harvest for `pid` unless one is already queued or running."""
    pid = int(pid)
    with _lock:   # one request at a time: the queued row and the queue entry appear together
        h = status(pid)   # also clears a state left behind by a server restart
        if h.get('state') in ACTIVE:
            return h
        _stop.discard(pid)   # a stop pressed while nothing was running must not abort this run
        store.harvest_set(pid, state='queued', message='waiting for the harvester', pages=0, games=0, candidates=0, done=0, not_found=0, errors=0,
                          started=time.time(), finished=None)
        _q.put((pid, max(1, min(40, int(pages or 20))), cfg))
    _ensure_worker()
    return status(pid)


def stop(pid):
    pid = int(pid)
    if _current == pid or _queued(pid):   # only a live or queued run can be stopped
        _stop.add(pid)
    return status(pid)


def status(pid):
    pid = int(pid)
    h = store.harvest_get(pid) or {'profile_id': pid, 'state': 'idle', 'message': None}
    # A row still marked active while the worker neither runs nor queues it belongs to a process that died (server
    # restart). The 5-second grace covers the instants between writing the row and queueing it, and between popping
    # the queue and becoming current; a live run also resets `finished` when it starts.
    if h.get('state') in ACTIVE and _current != pid and not _queued(pid) and time.time() - (h.get('updated') or 0) > 5:
        store.harvest_set(pid, state='stopped', message=f'interrupted by a server restart after {h.get("done") or 0} replays', finished=time.time())
        h = store.harvest_get(pid)
    h['stored_stats'] = store.stats_count(pid)
    h['stored_games'] = store.games_count(pid)
    h['queued_players'] = _q.qsize()
    h['running_now'] = _current
    return h


def _ensure_worker():
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_loop, name='forge-harvest', daemon=True)
            _worker.start()


def _loop():
    global _current
    while True:
        pid, pages, cfg = _q.get()
        _current = pid
        try:
            _run(cfg, pid, pages)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            store.harvest_set(pid, state='error', message=str(e)[:200], finished=time.time())
        finally:
            _current = None
            _stop.discard(pid)
            _q.task_done()


def _list_all(pid, max_pages, progress):
    games, page = [], 1
    while page <= max_pages:
        d = json.loads(replays.http_get(replays.A4W + f'players/{pid}/games?limit=50&page={page}'))
        batch = d.get('games') or []
        games += batch
        store.upsert_games(batch)
        progress(pages=page, games=len(games))
        if not d.get('next_page'):
            break
        page = d['next_page']
        time.sleep(0.4)
    return games


def _pause(pid, seconds):
    for _ in range(int(seconds)):
        if pid in _stop:
            return False
        time.sleep(1)
    return pid not in _stop


def _run(cfg, pid, pages):
    def progress(**f):
        store.harvest_set(pid, **f)
    progress(state='running', message='listing games on AoE4 World', finished=None)
    games = _list_all(pid, pages, progress)
    try:
        replays.official_history(pid)        # also stores the counters and seed / biome / layout of the official window (10 matches per match type)
    except Exception:  # noqa: BLE001
        pass
    local = replays.local_replays(cfg)
    have = store.stats_ids(pid)
    skip = store.unmatched_ids(pid)          # replays that twice failed to match this player's name, civ and team
    cands = [g for g in games if not g.get('ongoing') and (g.get('duration') or 0) >= MIN_DURATION and g['game_id'] not in have]
    statuses = store.replays_for(g['game_id'] for g in cands)
    progress(candidates=len(cands), message=f'{len(cands)} games to fetch')
    done = nf = err = 0
    backoff = BACKOFF_START
    for g in cands:
        if pid in _stop:
            progress(state='stopped', message=f'stopped after {done} replays', finished=time.time())
            return
        gid = g['game_id']
        if gid in skip:
            err += 1
            progress(errors=err)
            continue
        r = statuses.get(gid)
        if r and r['status'] == 'not_found' and time.time() - (r['last_attempt'] or 0) < 86400:
            nf += 1
            progress(not_found=nf)
            continue
        if r and str(r['status']).startswith('unreadable') and (r['attempts'] or 0) >= 2:
            err += 1
            progress(errors=err)
            continue
        path, st = local.get(gid), 'local'
        if path is None:
            while True:
                path, st = replays.fetch_official_replay(gid, min_duration=g.get('duration'))
                if st != 'rate_limited':
                    break
                progress(message=f'replay store rate-limited · pausing {backoff} s')
                if not _pause(pid, backoff):
                    progress(state='stopped', message=f'stopped after {done} replays', finished=time.time())
                    return
                backoff = min(BACKOFF_MAX, backoff * 2)
            backoff = BACKOFF_START
            time.sleep(PAUSE)
        else:
            path, st2 = replays.ensure_full_replay(gid, path, g.get('duration'))
            st = st2 or st
        if path is None:
            if st == 'not_found':
                nf += 1
            else:
                err += 1
            store.replay_set(gid, st)
            progress(not_found=nf, errors=err)
            continue
        try:
            a = replays.analyze_replay(path)
        except Exception as e:  # noqa: BLE001
            err += 1
            store.replay_set(gid, f'unreadable: {e}'[:120])
            progress(errors=err)
            continue
        pids = replays.store_perspectives(g, a, st)   # records the players it could not match, per player
        store.replay_set(gid, st, path=path, duration=a.get('duration'))
        if pid in pids:
            done += 1
        else:
            err += 1
        progress(done=done, errors=err, message=f'{g.get("map")} · {str(g.get("started_at"))[:10]}')
    progress(state='done', message=f'{done} replays analysed · {nf} not in the store · {err} unreadable or unmatched', finished=time.time())


# ----------------------------------------------------------------------------- official counters poller

POLL_EVERY = 600   # seconds; the official API keeps 10 matches per match type, a 1v1 session produces one every ~25 min


def start_counters_poll(cfg, every=POLL_EVERY):
    """Keep the configured player's (and friends') official counters flowing into the store while the companion runs:
    import the cached history responses once, then fetch each profile's recent-match history every `every` seconds.
    Returns the daemon thread, or None when the config names nobody."""
    pids = [p for p in [cfg.get('me')] + [f.get('profile_id') for f in cfg.get('friends') or []] if p]
    if not pids:
        return None

    def loop():
        try:
            replays.import_cached_histories()
        except Exception:  # noqa: BLE001
            pass
        while True:
            for pid in pids:
                try:
                    replays.official_history(pid, refresh=True)
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(2)
            time.sleep(every)

    t = threading.Thread(target=loop, name='counters-poll', daemon=True)
    t.start()
    return t
