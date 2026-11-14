"""Shared state for the Draft tab (#/draft): one action log per draft code, stored in cache/drafts.json.

The companion does not know the draft rules; js/draft.js derives the state from the log in every browser. The server
only (1) keeps the log in order with a compare-and-set on its length, so two players clicking at once cannot both win,
(2) gives each side a seat token so only the browser that joined as Player 1 can act for Player 1, and (3) bounds sizes.
"""
import json
import re
import secrets
import threading
import time

from . import replays

STORE = replays.CACHE / 'drafts.json'
_lock = threading.Lock()
CODE_RE = re.compile(r'^[A-Z2-9]{6,12}$')
MAX_DRAFTS, MAX_ACTIONS, MAX_CONFIG, MAX_ACTION = 300, 500, 20000, 2000
KEEP_DAYS = 30
SIDES = ('a', 'b')


class Conflict(Exception):
    """The log moved on since the client computed its action; carries the current state."""

    def __init__(self, state):
        super().__init__('the draft changed under you — refreshed')
        self.state = state


class Forbidden(Exception):
    pass


def _load():
    if STORE.exists():
        try:
            return json.loads(STORE.read_text(encoding='utf-8'))
        except Exception:  # noqa: BLE001
            pass
    return {}


def _save(drafts):
    STORE.parent.mkdir(parents=True, exist_ok=True)
    if len(drafts) > MAX_DRAFTS:   # forget the oldest untouched drafts first
        cutoff = time.time() - KEEP_DAYS * 86400
        for code in sorted(drafts, key=lambda c: drafts[c]['updated']):
            if len(drafts) <= MAX_DRAFTS:
                break
            if drafts[code]['updated'] < cutoff or len(drafts) > MAX_DRAFTS * 2:
                drafts.pop(code)
    STORE.write_text(json.dumps(drafts, ensure_ascii=False), encoding='utf-8')


def public(code, d):
    return {'code': code, 'config': d['config'], 'actions': d['actions'], 'version': len(d['actions']),
            'seats': {s: bool(d['seats'].get(s)) for s in SIDES}, 'created': d['created'], 'updated': d['updated']}


def _get(drafts, code):
    if not isinstance(code, str) or not CODE_RE.match(code):
        raise ValueError('a draft code is 6–12 letters and digits')
    d = drafts.get(code)
    if not d:
        raise KeyError(code)
    return d


def _check_action(action):
    if not isinstance(action, dict) or action.get('side') not in SIDES or not isinstance(action.get('t'), str):
        raise ValueError('an action is {t, side, value}')
    if len(json.dumps(action)) > MAX_ACTION:
        raise ValueError('action too large')


def create(body):
    config = body.get('config')
    if not isinstance(config, dict) or len(json.dumps(config)) > MAX_CONFIG:
        raise ValueError('config missing or too large')
    with _lock:
        drafts = _load()
        code = body.get('code') or ''
        if code and (not CODE_RE.match(str(code)) or code in drafts):
            code = ''
        while not code or code in drafts:
            code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(10))
        config['seed'] = code    # the code is the seed: coin flips are reproducible from it
        now = time.time()
        d = {'config': config, 'actions': [], 'seats': {'a': None, 'b': None}, 'created': now, 'updated': now}
        token = None
        claim = body.get('claim')
        if claim in SIDES:
            token = secrets.token_urlsafe(12)
            d['seats'][claim] = token
        drafts[code] = d
        _save(drafts)
        out = public(code, d)
        out['token'], out['side'] = token, claim if token else None
        return out


def get(code):
    with _lock:
        drafts = _load()
        return public(code, _get(drafts, code))


def join(code, body):
    side = body.get('side')
    if side not in SIDES:
        raise ValueError('side must be a or b')
    with _lock:
        drafts = _load()
        d = _get(drafts, code)
        held = d['seats'].get(side)
        token = body.get('token')
        if held and held != token:
            raise ValueError('that seat is already taken — join as the other player, or spectate')
        if not held:
            token = secrets.token_urlsafe(12)
            d['seats'][side] = token
            d['updated'] = time.time()
            _save(drafts)
        out = public(code, d)
        out['token'], out['side'] = token, side
        return out


def leave(code, body):
    token = body.get('token')
    with _lock:
        drafts = _load()
        d = _get(drafts, code)
        for s in SIDES:
            if token and d['seats'].get(s) == token:
                d['seats'][s] = None
        d['updated'] = time.time()
        _save(drafts)
        return public(code, d)


def act(code, body):
    action = body.get('action')
    _check_action(action)
    token = body.get('token')
    with _lock:
        drafts = _load()
        d = _get(drafts, code)
        if not token or d['seats'].get(action['side']) != token:
            raise Forbidden(f"you do not hold the seat of player {'1' if action['side'] == 'a' else '2'}")
        expect = body.get('expect')
        if isinstance(expect, int) and expect != len(d['actions']):
            raise Conflict(public(code, d))
        if len(d['actions']) >= MAX_ACTIONS:
            raise ValueError('this draft has too many actions')
        d['actions'].append({'t': action['t'], 'side': action['side'], 'value': action.get('value'), 'at': time.time()})
        d['updated'] = time.time()
        _save(drafts)
        return public(code, d)


def undo(code, body):
    """Take back the last action, if it was by the side the caller holds."""
    token = body.get('token')
    with _lock:
        drafts = _load()
        d = _get(drafts, code)
        if not d['actions']:
            raise ValueError('nothing to undo')
        last = d['actions'][-1]
        if not token or d['seats'].get(last['side']) != token:
            raise Forbidden('only the player who made the last action can take it back')
        d['actions'].pop()
        d['updated'] = time.time()
        _save(drafts)
        return public(code, d)
