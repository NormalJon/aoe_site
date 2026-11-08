#!/usr/bin/env python3
"""
Forge dev server + local companion.

* Serves the static prototype with correct MIME types.
* Proxies a small allow-list of the official World's Edge (Relic) community API under /relic/… so the browser
  can read it (that API sends no CORS headers). Responses are cached for 60 seconds.
* Exposes the local companion under /local/… : your games merged with official counters and replay analysis
  (see tools/replays.py). Configure yourself and your friends in forge.local.json.

Usage:
    py -3 server.py            # http://127.0.0.1:8000 (or $PORT if set)
    py -3 server.py 8080       # custom port
"""
import json
import mimetypes
import os
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8000"))
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from tools import replays  # noqa: E402

RELIC_BASE = "https://aoe-api.worldsedgelink.com/community/"
ALLOWED = {
    "leaderboard/getAvailableLeaderboards",
    "leaderboard/getLeaderBoard2",
    "leaderboard/getPersonalStat",
    "leaderboard/getRecentMatchHistory",
}
USER_AGENT = "Forge-AoE4-prototype/0.1 (local development server)"
CACHE_TTL = 60.0

_cache: dict[str, tuple[float, int, bytes]] = {}
_lock = threading.Lock()

for ext, mt in {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png",
                ".html": "text/html", ".md": "text/markdown"}.items():
    mimetypes.add_type(mt, ext, strict=True)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                      ".svg": "image/svg+xml", ".json": "application/json"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        if not self.path.startswith(("/relic/", "/local/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/relic/"):
            return self.proxy()
        if self.path.startswith("/local/"):
            return self.local()
        return super().do_GET()

    # ------------------------------------------------------------------ local companion
    def local(self):
        parsed = urllib.parse.urlsplit(self.path)
        parts = [p for p in parsed.path.split("/") if p][1:]
        q = dict(urllib.parse.parse_qsl(parsed.query))
        cfg = replays.load_config()
        try:
            if parts == ["config"]:
                dirs = [str(d) for d in replays.replay_dirs(cfg)]
                local = replays.local_replays(cfg)
                return self.send_json(200, {"me": cfg.get("me"), "friends": cfg.get("friends") or [], "replay_dirs": dirs,
                                            "local_replays": len(local), "config_error": cfg.get("config_error"),
                                            "configured": bool(cfg.get("me")), "companion": True})
            # --- endpoints that work for any player (no 'me' needed) ---
            if len(parts) == 2 and parts[0] == "game" and parts[1].isdigit():
                prof = q.get("profile")
                if not (prof and prof.isdigit()) and not cfg.get("me"):
                    return self.send_json(400, {"error": "profile query parameter required"})
                return self.send_json(200, replays.game_detail(cfg, int(parts[1]), fetch=q.get("fetch") == "1", profile=int(prof) if prof and prof.isdigit() else None))
            if len(parts) == 2 and parts[0] == "profile" and parts[1].isdigit():
                want = max(1, min(40, int(q.get("n") or 10)))
                budget = max(2.0, min(45.0, float(q.get("budget") or 20)))
                return self.send_json(200, replays.playstyle_profile(cfg, int(parts[1]), want=want, budget=budget, refresh=q.get("refresh") == "1"))
            # --- endpoints about the configured player ---
            if not cfg.get("me"):
                return self.send_json(400, {"error": "forge.local.json has no 'me' profile id"})
            if parts == ["games"]:
                return self.send_json(200, replays.list_games(cfg, refresh=q.get("refresh") == "1"))
            if len(parts) == 2 and parts[0] == "games" and parts[1].isdigit():
                return self.send_json(200, replays.game_detail(cfg, int(parts[1]), fetch=q.get("fetch") == "1"))
            if parts == ["scan"]:
                return self.send_json(200, replays.scan_and_analyze(cfg))
            return self.send_json(404, {"error": "unknown local endpoint"})
        except urllib.error.HTTPError as e:
            return self.send_json(502, {"error": f"upstream {e.code}: {e.reason}"})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self.send_json(500, {"error": str(e)})

    # ------------------------------------------------------------------ Relic proxy
    def proxy(self):
        parsed = urllib.parse.urlsplit(self.path)
        rel = parsed.path[len("/relic/"):]
        if rel not in ALLOWED:
            return self.send_json(403, {"error": "endpoint not allowed", "allowed": sorted(ALLOWED)})
        query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
        query["title"] = "age4"
        upstream = RELIC_BASE + rel + "?" + urllib.parse.urlencode(query)

        now = time.time()
        with _lock:
            hit = _cache.get(upstream)
        if hit and now - hit[0] < CACHE_TTL:
            return self.send_bytes(hit[1], hit[2], cached=True)

        req = urllib.request.Request(upstream, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            body = e.read() or json.dumps({"error": str(e)}).encode()
            status = e.code
        except Exception as e:  # noqa: BLE001
            return self.send_json(502, {"error": f"upstream failure: {e}"})

        with _lock:
            _cache[upstream] = (now, status, body)
        return self.send_bytes(status, body)

    # ------------------------------------------------------------------ helpers
    def send_bytes(self, status, body, cached=False):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/local/") else f"public, max-age={int(CACHE_TTL)}")
        self.send_header("X-Forge-Cache", "hit" if cached else "miss")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, obj):
        self.send_bytes(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def log_message(self, fmt, *args):
        msg = fmt % args
        if "/assets/" in msg or ".css" in msg or ".js" in msg:
            return
        sys.stdout.write(f"{time.strftime('%H:%M:%S')} {msg}\n")
        sys.stdout.flush()


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    cfg = replays.load_config()
    print(f"Forge dev server -> http://127.0.0.1:{PORT}/  (Relic proxy at /relic/..., local companion at /local/...)")
    print(f"Local companion: me={cfg.get('me')} friends={len(cfg.get('friends') or [])} replay dirs={len(replays.replay_dirs(cfg))}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
