"""Re-analyse every replay the store has a file for with the current parser, and rewrite every player's summary.

Run after a change to tools/aoe4rec.py or to analyze_replay (bump ANALYSIS_V in tools/replays.py first, so the
cached analyses are rebuilt rather than reused):

    py -3 tools/reanalyze.py            # re-parse and rewrite the summaries of every matched player
    py -3 tools/reanalyze.py --clean    # also delete cached analyses of older versions

Restart the companion afterwards so it serves the new analyses.
"""
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools import replays, store  # noqa: E402


def main():
    rows = store.replay_paths()
    bp = replays.blueprints()
    t0, done, missing, failed, players = time.time(), 0, 0, 0, 0
    for i, (gid, status, path) in enumerate(rows, 1):
        g = store.game(gid)
        if g is None or not os.path.exists(path):
            missing += 1
            continue
        try:
            a = replays.analyze_replay(path, bp)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f'  {gid}: {e}')
            continue
        players += len(replays.store_perspectives(g, a, status))
        done += 1
        if i % 50 == 0 or i == len(rows):
            print(f'{i}/{len(rows)} replays · {done} analysed · {players} player summaries · {missing} without file or game record · '
                  f'{failed} unreadable · {time.time() - t0:.0f}s', flush=True)
    if '--clean' in sys.argv:
        removed = 0
        for f in (replays.CACHE / 'analysis').glob('*.json'):
            if not f.name.endswith(f'.{replays.ANALYSIS_V}.json'):
                f.unlink()
                removed += 1
        print(f'removed {removed} cached analyses of older versions')


if __name__ == '__main__':
    main()
