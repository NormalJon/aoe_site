#!/usr/bin/env python3
"""
Forge dev server.

Serves the static prototype and proxies a small allow-list of the official
World's Edge (Relic) community API under /relic/… so the browser can read it
(that API does not send CORS headers). Responses are cached for 60 seconds.

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
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8000"))
ROOT = os.path.dirname(os.path.abspath(__file__))
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

# Windows' registry can map .js to text/plain, which breaks ES modules.
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
        # Keep dev iterations fresh.
        if not self.path.startswith("/relic/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/relic/"):
            return self.proxy()
        return super().do_GET()

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
        except Exception as e:  # network error, timeout, TLS
            return self.send_json(502, {"error": f"upstream failure: {e}"})

        with _lock:
            _cache[upstream] = (now, status, body)
        return self.send_bytes(status, body)

    def send_bytes(self, status, body, cached=False):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", f"public, max-age={int(CACHE_TTL)}")
        self.send_header("X-Forge-Cache", "hit" if cached else "miss")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, obj):
        self.send_bytes(status, json.dumps(obj).encode())

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
        except Exception:
            pass
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Forge dev server -> http://127.0.0.1:{PORT}/  (Relic proxy at /relic/...)")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
