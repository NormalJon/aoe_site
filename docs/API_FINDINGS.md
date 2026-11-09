# Age of Empires IV data APIs — research notes

Verified 7 November 2026 by direct requests from this machine. Everything below was probed with `curl`
and in a browser; response shapes are from real responses.

## 1. Is there an official public API from the developers?

**No.** World's Edge (Microsoft's studio) and Relic Entertainment have never published developer
documentation, API keys, rate limits or terms for Age of Empires IV data.

Evidence:
- Official forum thread "Age FAN SITE KIT, API and web Theme for Age IV" (Nov 2021): community asked for
  an API and fan-site kit; the only replies were other players pointing at third-party sites. No staff reply.
- "Support for Community Projects: Easy Access to Game Data (e.g. aoe4world)" and "API access" threads:
  same pattern, no developer response.
- The `Khady/aoe-api` atlas (verified Sept 2026) explicitly states no official SDK exists and that World's
  Edge "can still expose an undocumented interface without a public compatibility guarantee".

What *does* exist is the backend the game client itself calls, which answers unauthenticated reads.
Every community site (AoE4 World, aoeiv.net, aoestats…) is built on that plus replay parsing.

## 2. AoE4 World public API — the practical backbone

- Docs: https://aoe4world.com/api  ·  Base: `https://aoe4world.com/api/v0`
- Auth: none. CORS: `Access-Control-Allow-Origin: *`, preflight OK → callable straight from a browser.
- Cost: free; community-run, non-profit; "fan-made project not associated with Microsoft".
- Rate limits: none published. Rules: no bulk crawling, cache locally, use `since`/`updated_since` for
  incremental sync, identify automated clients with a `User-Agent` containing contact info, don't spoof
  browser UAs from scripts. Abuse → blocks. Bulk match history is offered as periodic dumps at `/dumps`.

### Endpoints

| Endpoint | Params | Notes from probing |
|---|---|---|
| `GET /players/search` | `query` (≥3 chars), `page` | 50/page; each player has `leaderboards{rm_solo,…}` incl. `previous_seasons`, `social`, `avatars`, `last_game_at` |
| `GET /players/autocomplete` | `leaderboard` (req.), `query` (≥3), `limit` | lighter, ladder-scoped |
| `GET /players/:id` | — | `modes{rm_solo, rm_team, qm_1v1, qm_2v2, qm_3v3, qm_4v4, rm_1v1_elo, rm_2v2_elo, …}`; each has rating, max_rating(_7d/_1m), rank, rank_level, streak, W/L, `rating_history{unix_ts:{rating,streak,…}}`, `civilizations[{civilization,win_rate,pick_rate,games_count}]`, `previous_seasons[]`. `rm_1v1` is a deprecated alias of `rm_solo`. |
| `GET /players/:id/games` | `leaderboard` (rm_solo, rm_team, qm_*), `opponent_profile_id`, `since`, `page`, `limit` (≤50) | `teams[][]{player:{profile_id,name,country,result,civilization,civilization_randomized,rating,rating_diff,mmr,mmr_diff,input_type}}`, plus map, map_id, duration, kind, server, patch, average_rating/mmr, ongoing |
| `GET /players/:id/games/last` | `include_stats`, `include_alts` | players are flat objects here (not wrapped in `player`) — the client normalises both shapes |
| `GET /leaderboards/:key` | `page`, `query`, `country`, `profile_id(s)` (≤50), `time` | keys: `rm_solo` (37.6k players, S14), `rm_team`, `qm_1v1`, `qm_2v2`, `qm_3v3`, `qm_4v4`. 50/page. Fields add `max_rating_7d/1m`, `last_rating_change`, `twitch_is_live`. `*_elo` keys are **not** leaderboards. |
| `GET /games` | `leaderboard` (rm_1v1…qm_4v4 — *not* rm_solo/rm_team), `order` (started_at\|updated_at), `since`, `updated_since`, `per_page`, `page` (≤20) | live feed; `ongoing: true` games have null ratings until rated |
| `GET /stats/:lb/civilizations` | `patch`, `rank_level`, `rating` | `:lb` ∈ rm_solo, rm_2v2, qm_1v1, qm_2v2, qm_3v3, qm_4v4. `rank_level` allowed: bronze, silver, gold, platinum, diamond, conqueror, ≤silver, ≥gold, ≥platinum, ≥diamond, ≥conqueror, ≥conqueror_4 (RM only). `rating` like `>1200`. Default `patch` currently resolves to `10604,10884,11214,11308`; unknown values fall back silently. |
| `GET /stats/:lb/matchups` | same | rm_solo and qm_1v1 only; 23×23 pairs with win_rate, games_count |
| `GET /stats/:lb/maps`, `/maps/:map_id` | same (+`include_civs`, expensive) | rm_solo, qm_1v1, rm_2v2 |
| `GET /stats/qm_2v2|qm_3v3/teams` | `patch`, `rating` | civ combinations with win rates |
| `GET /esports/leaderboards/1` | `page`, `query`, `country`, `show_inactive` | tournament Elo |
| `/dumps` | — | periodic bulk match-history dumps |

### Static game data
`https://data.aoe4world.com/` (repo `aoe4world/data`): `/civilizations/<slug>.json`, `/units/all.json`,
`/buildings/**`, `/technologies/**`, icons at `/images/units/<id>.png`. Civ flags and rank icons are served
from `static.aoe4world.com` with content-hashed filenames (not stable to hotlink); the prototype bundles
the 25 flag PNGs locally instead.

## 3. World's Edge / Relic community API — the official backend

- Base: `https://aoe-api.worldsedgelink.com/community/` (also `dr-activerelease1-api.worldsedgelink.com`).
  Legacy `aoe-api.reliclink.com` fails TLS hostname verification — do not disable TLS checks.
- Auth: none for the endpoints below. CORS: **none** → must be read server-side (hence `server.py`).
- Documentation: none official. Field names/ids reverse-engineered (LibreMatch wiki, `Khady/aoe-api`).
  Community-observed limit ≈ 50 req/s.

| Endpoint | Returns |
|---|---|
| `leaderboard/getAvailableLeaderboards?title=age4` | 127 leaderboards: ids 1–4 = ranked 1v1–4v4 (all-time ELO), 17–20 = QM 1v1–4v4, 206+ console, 479+ Empire Wars, 533 FFA, 601+ event modes, 0 = "Custom" |
| `leaderboard/getLeaderBoard2?leaderboard_id=&start=&count=&sortBy=1&platform=PC_STEAM&title=age4` | `statGroups[]` (profile_id, alias, `/steam/<id>`, xp, level, country) + `leaderboardStats[]` (wins, losses, streak, drops, rank, ranktotal, ranklevel, rating, regionrank, highestrating, lastmatchdate) |
| `leaderboard/getPersonalStat?title=age4&profile_ids=[id]` | same two arrays for one or more players, across every ladder they appear on |
| `leaderboard/getRecentMatchHistory?title=age4&profile_ids=[id]` | the **10 most recent matches per match type** (ranked 1v1, 2v2, 3v3, 4v4, quick match, custom), not the last N overall: `matchHistoryStats[]{id, mapname ("generated_map"), matchtype_id, startgametime, completiontime, matchhistoryreportresults[]{profile_id, resulttype, teamid, civilization_id, xpgained, counters(JSON string)}, matchhistorymember[]{oldrating,newrating,…}, matchurls[]{url (replay .gz on Azure blob), size}}` + `profiles[]` |

`counters` keys: `sqprod/unitprod` (units produced), `sqkill/ekills` (kills), `sqlost` (lost), `bprod/blost`
(buildings), `upg` (upgrades), `totalcmds` (commands → APM), `gt` (game time), `abil`, `edeaths`, and many
zero-valued fields shared with other Relic titles. This is the only source of per-match performance
telemetry; AoE4 World's `include_stats` is the other partial source.

Caveats: map names are not resolved (join on `startgametime` with AoE4 World games), civilizations are
numeric ids, leaderboard 0 semantics are unclear, and nothing here is guaranteed stable.

## 4. Replays — the only source of in-game detail (verified 7 Nov 2026)

Neither API says *what* a player built or *when*. That lives in the replay, a complete command log.

**Where replays come from**

- The game client keeps them locally under `Documents\My Games\Age of Empires IV\`:
  `network\M_<matchId>_<hash>.gz` (one replay and one post-game stats blob per match, same id; verify the
  `AOE4_REP` signature to tell them apart), `playback\temp.rec` (last game), and `matchhistory\<id>\replay.rec`
  plus `stats.rgs`. Only matches played on that machine are present (here: 51 replays since 18 Sep 2026).
- The official store: `GET leaderboard/getReplayFiles?matchIDs=[<id>,…]&title=age4` returns `replayFiles[]`
  with `profile_id`, `matchhistory_id`, `datatype` (0 = replay) and a **signed Azure blob URL** valid for a few
  minutes. Download it plainly; the unsigned URLs in `getRecentMatchHistory.matchurls` answer 409
  `PublicAccessNotPermitted`. Several ids per call are fine; bursts of calls get HTTP 429. Retention is uneven:
  some perspectives 404, some older matches return `result.code 2 NOT_FOUND`. Try every listed perspective.
  **Each entry is one player's upload** (`size` in bytes, `-1` when missing). A player who dropped at 4:00 uploads
  a replay that ends at 4:00 (verified 8 Nov 2026: a 12:34 4v4 had a 137 KB upload from the dropper and 324 KB
  from everyone else), so download the largest file and compare its tick length with the API duration. This also
  means replays exist for *anyone's* games, not just your own — the basis for game summaries and playstyle
  profiles of arbitrary players.
  (Mechanism confirmed by reading the open-source AoE4-Replay-Launcher, which also keeps a legacy fallback on
  `api.ageofempires.com/api/GameStats/AgeIV/GetMatchReplay`.)

**What a replay contains** (format per aoe4world/replays-api docs; our reader is `tools/aoe4rec.py`)

- Header with game build and date; player list (name, civ, team, id); then a tick stream (8 ticks/s).
- Per command: type, issuing player, receivers (the entity or group the order is addressed to), blueprint id. We
  decode train (0x03), research (0x10), build (0x7B, with map position), **cancel production (0x05)** and **cancel
  construction (0x38)**. Blueprint ids resolve against `data.aoe4world.com` units/buildings/technologies
  (99.3 % of train orders resolve).
- The cancel opcodes were identified from the stream, as no opcode table is published. 0x05 is 34 bytes, addressed
  to the producing building, carries a small queue-item id, follows batches of queued units within seconds, and 93 %
  of its occurrences target a building that had just trained; the analyser undoes the last live order in that
  building's queue. 0x38 has no payload, is addressed to a freshly created building entity and is followed by the
  same building being placed again; the analyser undoes the player's last building placed within 20 s. Across 522
  ranked 1v1 replays refunds were 2–4 % of gross spend, and players cancel more in games they lose, so gross spend
  flattered the losing side. Other frequent opcodes, not decoded: 0x92/0x94 (about 60 % of the stream, selection
  and idle samples), 0x3E (moves, with a position), 0x0C (rally points: entity, position or resource target),
  0x69/0x43/0x48/0x41/0x49 (unit orders with an entity target). Unit classes (`cavalry`, `ranged`, `siege`, `villager`, `trade_cart`, …) and
  landmark classes (`wonder_dark_age` = Feudal landmark, `wonder_feudal_age` = Castle, `wonder_castle_age` =
  Imperial; Abbasid wings are technologies with an `age`) drive the analysis.
- Not in a replay: positions of units, fights, kills, deaths, resources, idle time. Those are either in the
  official counters (totals only) or in the undocumented `stats.rgs` (Relic Chunky `StatLoggingInternal`,
  with per-player resource strings — not parsed).

## 5. Recommendation for a real site

0. **Personal analysis (built):** a local companion (`server.py` + `tools/replays.py`) that reads your replay folder,
   fetches official replays and counters, and serves the merged view to the site. Replays never leave the machine.
1. **Prototype / MVP:** browser → AoE4 World directly (as built). Add a tiny proxy for the official API.
2. **Production:** a backend that ingests both sources on a schedule (`/games?updated_since`, dumps,
   official ladders and match history), stores them, and serves its own API. Benefits: independence from
   third-party uptime, rate-limit safety, and features neither source offers directly (rating
   distributions, long-term trends, clan pages, custom percentiles, replay-derived build orders).
3. Credit AoE4 World visibly, keep request volume modest, and talk to the maintainers on their Discord
   before launching anything high-traffic.

## Map seed, biome and layout (found 9 Nov 2026)

AoE4 World's game records carry `map`, `map_id`, `patch` and `season` but no seed. The official
`leaderboard/getRecentMatchHistory` records do: each `matchHistoryStats[]` entry has an `options` field that is
base64 of zlib-compressed JSON with `rnd` (the match's random seed, 32-bit), `mapName` (`dry_arabia`),
`mapGenBio` (biome id), `mapGenLayout` / `mapGenLayoutNonRandomSelection` (layout ids), `mapGenSz`, win-condition
flags and the server address. `slotinfo` is the same encoding for the per-slot setup (profile ids, team ids, race
ids). The companion decodes `options` whenever it reads a player's recent history and stores seed/biome/layout per
game (`mapgen` table); the game summary shows the seed. Only the 10 most recent matches per match type are available
this way, so seeds for older games need the replay itself (the replay header also carries the settings, but the
seed is not labelled there; `winKey` 149419911 is a constant, not a seed). Ranked seeds are random per match, so
two games sharing one is a coincidence; map + biome + layout is the practical grouping.
