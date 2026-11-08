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
| `#/live` | Live | In-progress games (auto-refresh), busiest mode/server, just-finished results; **Scout ›** on every live game |
| `#/scout` | Scout | Paste two teams (up to 4 names each) or open a live lobby: ratings, rank, form, streak, top civs with pick/win rates, team averages, Elo-based "favoured" call, and each player's playstyle tags from replays (companion) |
| `#/game/:id?p=:profile` | Game summary (any player) | Opened from **Summary ›** on any match row. Key insights (rule-based sentences about the viewed player), team scoreboards, **minute-aligned build orders for every player side by side** with unit/building/technology icon strips and a resources-spent-per-minute line per player, timelines (villagers, military, spend, buildings) with age-up and TC markers, unit matrix, team production, tag explanations. Replay fetched from the official store on demand |
| `#/tournament` | Forge Cup (prototype) | Monthly Clash-style 1v1 cup: connect a profile, pick one of six weekend start times, declare a 3–5 civ pool; lock in 60–10 min before the slot; locked-in players are sorted by rating into brackets of 8; per series a mini draft (alternating map bans from a 7-map pool, one civ ban from the opponent's pool, blind civ picks revealed together, a civ you win with is locked); best-of-3 with reported results and verification against AoE4 World match history. Demo controls add real ladder players near your rating as entrants and fast-forward the clock |
| `#/data` | Data & sources | Live reachability check, full endpoint inventory, terms, and the official-API situation |
| `#/mygames` | My games (local companion) | Every game on your record with official counters and replay analysis: filter by mode, friend, tag, result, data availability; rows open the game summary from your perspective |

Profiles also carry replay-derived **Playstyle** (identity tags with frequencies, medians for villagers by 10:00,
age-up times, early military, Town Centers, military spend share, APM, army composition) and **Records**
(fastest Feudal/Castle/Imperial, earliest 2nd TC, most villagers, biggest army, highest APM, longest game, longest
win streak, biggest upset) cards, and Compare has a **skill radar** (Economy, Tempo, Aggression, Army, Expansion,
Macro on fixed ladder-wide scales). These work for *any* player: the companion pulls that player's recent replays
from the official store a few at a time (`/local/profile/:id?n=10`), so the first visit shows a partial result
with an "Analyse more" button.

Dark and light themes (toggle in the header, follows the OS by default). Responsive down to phone width.

## My games — the local companion

The public pages work from any static host. **My games** needs `server.py`, because it reads replay files from
your own Age of Empires IV folder and calls the official backend. Set it up once:

1. Copy `forge.local.example.json` to `forge.local.json` and fill in your AoE4 World profile id (`me`) and the
   friends you want tagged (profile id + display name). The file is gitignored.
2. Run `py -3 server.py` and open `http://127.0.0.1:8000/#/mygames`.
3. Click **Analyse local replays** once; later games are analysed on demand when you open them.

Where the data comes from, per game:

| Source | What it adds | Availability |
|---|---|---|
| AoE4 World API | players, civs, ratings and rating change, result, map, duration | every game |
| World's Edge community API (`getRecentMatchHistory`) | per-player **official counters**: units produced / killed / lost, buildings built / lost, upgrades, total commands (APM), rating before → after | your most recent ~60 matches (rolling window; cached under `cache/`) |
| Replay files | the full **command log** for every player: each unit queued, building placed and technology researched, with timestamps | games the game client kept under `Documents\My Games\Age of Empires IV\network`, plus anything fetched from the official store with **Fetch replay** (`getReplayFiles` → signed download; retention there is spotty) |

Replays record *orders*, not outcomes: a queued unit may be cancelled, a placed building may be destroyed or
never finished. Kills, losses and APM therefore come from the official counters, never from the replay.

### Tags

Rules live in [tools/replays.py](tools/replays.py) and every tag carries a plain-language `why`. Thresholds are
deliberately simple so they are easy to reason about and tune:

- **Replay-based, per player** — Boomer (no military queued before 8:00), Cavalry raider (3+ cavalry before 6:00),
  Archer opener (5+ ranged before 6:00), Infantry rush (5+ melee infantry before 6:00), Fast 2nd TC (before 10:00),
  TC boom (3+ Town Centers), Turtle (4+ towers/outposts/keeps/gates before 12:00), Mono-comp (one unit ≥ 70 % of
  military, min. 20 units), Siege heavy (≥ 15 % siege), Navy, Trader, Monk play.
- **Game-relative, per player** — Fastest age-up, Most villagers, Biggest army (replay); Top fragger, Best K/D,
  Highest APM, Most buildings, Fed (official counters).
- **Per game** — with *friend* (one per configured friend on your team), Duo / 3-stack / 4-stack, Early end
  (< 5 min), Long game (> 35 min).

Known gaps: age-up detection relies on landmark classes, so civilizations with unusual age-up mechanics (Knights
Templar, Golden Horde) show no age-up times; unit tiers (Veteran/Elite) are folded into their base unit; the
official store rate-limits bursts of replay fetches (HTTP 429) — wait a minute and retry.

## Forge Cup — the tournament prototype

`#/tournament` mirrors the League of Legends Clash loop for AoE IV 1v1. Everything is implemented in
[tools/tournament.py](tools/tournament.py) and stored in `cache/tournament.json` by the companion:

- **Schedule.** One event a month on the third weekend, six start slots (UTC, shown in local time). Registration
  closes 24 h before a slot; the lock-in window runs from 60 to 10 minutes before; brackets form at lock-in close.
- **Entry.** Connect a profile (prototype: claimed id; production: Steam sign-in), pick a slot, declare 3–5 civs.
  The rating on the chosen ladder is fetched from AoE4 World and decides the bracket.
- **Brackets.** Locked-in players of a slot sorted by rating and cut into groups of 8 (seeds 1–8, byes fill a
  short group, a tail group under 4 merges into the previous one, 9–16 players make a 16-bracket).
- **Draft.** Map bans hi/lo/hi/lo from a 7-map pool taken from the current ranked rotation; lower seed picks the
  game-1 map, higher seed game 2, remainder decides. Each player bans one civ from the opponent's declared pool;
  every game both pick blind from their remaining pool; a civ you win a game with is locked for the series, so a
  pool of three always leaves a legal pick.
- **Results.** Best-of-3; players report, and *Verify from match history* records finished AoE4 World games
  between the two players since the scheduled time.
- **Demo controls.** Add 7 real ladder profiles near your rating as entrants (with their actual most-played civs
  as pools), fast-forward the clock to lock-in / bracket reveal / live, act for both players in a series, reset.

Missing for a real launch: Steam sign-in, no-show timers and forfeits, anti-smurf checks, a lobby/host handshake,
prizes and a hosted store with notifications.

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
- Not yet used: `games/last?include_stats` (per-game economy stats), esports Elo, AoE4 World bulk dumps.
- Replays are *orders*: "villagers queued" over-counts cancelled units, and civilizations whose workers spawn
  without an order (Viking Bondi from Longhouses) are excluded from villager comparisons. The official store keeps
  one upload per player perspective; a player who dropped early uploads a truncated file, so the fetcher takes the
  largest file and re-fetches when a cached copy is shorter than 70 % of the game. It also rate-limits bursts
  (HTTP 429): profile analysis stops at the first 429 and offers a retry.
- Skill-radar scales are fixed ladder-wide ranges, not adjusted per civilization or mode; bracket benchmarks need
  a replay corpus (roadmap M4).
- Obvious additions: rating distribution per ladder (needs ingestion), clan/team pages, player notes and
  favourites (local storage). See `docs/ROADMAP_IDEAS.md` for the full backlog.

This is an unofficial fan prototype. Age of Empires IV is a trademark of Microsoft; game assets are used
under Microsoft's Game Content Usage Rules. Data courtesy of AoE4 World.
