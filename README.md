# Forge — an Age of Empires IV stats site prototype

A working, data-driven prototype of what a new AoE IV stats site could look like, focused on the two
things existing sites do poorly: **looking up a player** and **comparing players' game statistics**.
Every number on every page is fetched live from public APIs; nothing is mocked.

## Run it

Requirements: Python 3.10+ (the machine this was built on has 3.14 via the `py` launcher). No Node, no build step.

```bash
py -3 server.py
```

Then open <http://127.0.0.1:8000/>. The server does two things: serves the static files with correct
MIME types (Windows otherwise maps `.js` to `text/plain`, which breaks ES modules), and proxies four
read-only endpoints of the official World's Edge API under `/relic/…` so the **Official data** tab on
player profiles works (that API sends no CORS headers, so a browser cannot call it directly).

Any other static server works too (`py -3 -m http.server`, nginx, GitHub Pages…); the whole site runs
without the proxy, only the Official data tab degrades to an explanatory notice. `PORT` is honoured
when set; the Claude desktop launch config in `.claude/launch.json` uses it.

## What's in the prototype

| Route | Page | Highlights |
|---|---|---|
| `#/` | Home | Big player search with autocomplete, top-10 solo & team ladders, civ win-rate snapshot, live feed snapshot |
| `#/player/:id` | Player profile | Header with country/socials/Steam; mode tabs (Solo RM, Team RM, QM 1v1–4v4, hidden all-time ELO); stat tiles with 7-day delta and sparkline; rating-history chart with range + season/ELO toggle; tabs: **Matches** (filterable, paginated), **Civilizations**, **Seasons**, **Insights** (computed client-side from up to 150 games: maps, vs-civ, as-civ, rivals, by length, by server), **Official data** (account level/XP, every official ladder, per-match telemetry: units built/killed/lost, buildings, upgrades, APM) |
| `#/compare` · `#/compare/:a/:b` | Compare | Two-player picker; side-by-side metric table with "better" markers; overlaid rating curves; civ-pool dumbbells; full head-to-head record by map and by civ matchup with every meeting listed |
| `#/leaderboard/:key` | Leaderboards | Six ladders, name filter, country filter, jump-to-page, pick-two-to-compare |
| `#/civs` | Civilizations | Win/pick rates by ladder, rank bracket and rating; per-civ detail with matchups; 23×23 matchup heatmap; team compositions for QM 2v2/3v3 |
| `#/maps` · `#/maps/:id` | Maps | Map pool share, lengths, best civ per map; per-map civ win rates |
| `#/live` | Live | In-progress games (auto-refresh), busiest mode/server, just-finished results |
| `#/data` | Data & sources | Live reachability check, full endpoint inventory, terms, and the official-API situation |

Dark and light themes (toggle in the header, follows the OS by default). Responsive down to phone width.

## Architecture

```
index.html            shell: header, nav, search mount, <main>, footer, tooltip host
css/styles.css        design tokens (light/dark), components, charts
js/app.js             hash router, theme, header search
js/api.js             aoe4world client with memory + sessionStorage cache; Relic proxy client
js/constants.js       civilizations, ladders, rank tiers, official ladder ids
js/util.js            DOM builder (text-safe), formatting, routing helpers, colour maths
js/components.js      player chips, flags, rank badges, tables, pagination, game rows, search box, tooltip
js/charts.js          SVG line chart (crosshair tooltip, direct end labels, keyboard), sparkline, heatmap
js/pages/*.js         one module per route
server.py             static server + World's Edge proxy (allow-list, 60 s cache)
assets/flags/*.png    civilization flags
docs/API_FINDINGS.md  research notes on every data source
```

Design rules followed: all API text is inserted with `textContent` (never `innerHTML`); one colour role
per job (categorical for identities, diverging red↔blue around 50% for win rates, status colours only
for win/loss); every chart has a hover/keyboard tooltip and a table twin; charts read colours from CSS
variables so themes just work.

## Data sources (short version — see `docs/API_FINDINGS.md`)

- **There is no official, documented developer API for AoE IV.** The developers have never published one
  and have not responded to community requests since 2021.
- **AoE4 World public API** (`https://aoe4world.com/api/v0`) — community-run, free, no key, CORS-enabled.
  Players, games, leaderboards, aggregate civ/map/matchup stats. This powers ~95% of the prototype.
- **World's Edge community API** (`https://aoe-api.worldsedgelink.com/community/…`) — the game's own
  backend. Undocumented, public reads, no CORS. Leaderboards, personal stats, match history with
  per-player telemetry and replay URLs. Used through `server.py`.
- **aoe4world/data** — static unit/building/tech/civ JSON and icons.

## Known limitations / next steps

- Insights and head-to-head are computed from the most recent 100–150 games the API returns per request
  window; a production backend would ingest full histories and precompute these.
- Official ladder ids are reverse-engineered; names in `constants.js` cover the common ones.
- Not yet used: `games/last?include_stats` (per-game economy stats), esports Elo, replay download links,
  AoE4 World bulk dumps.
- Obvious additions: rating distribution per ladder (needs ingestion), clan/team pages, player notes and
  favourites (local storage), build-order/timeline from replays.

This is an unofficial fan prototype. Age of Empires IV is a trademark of Microsoft; game assets are used
under Microsoft's Game Content Usage Rules. Data courtesy of AoE4 World.
