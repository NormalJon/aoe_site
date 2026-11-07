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
| `leaderboard/getRecentMatchHistory?title=age4&profile_ids=[id]` | ~50 recent matches: `matchHistoryStats[]{id, mapname ("generated_map"), matchtype_id, startgametime, completiontime, matchhistoryreportresults[]{profile_id, resulttype, teamid, civilization_id, xpgained, counters(JSON string)}, matchhistorymember[]{oldrating,newrating,…}, matchurls[]{url (replay .gz on Azure blob), size}}` + `profiles[]` |

`counters` keys: `sqprod/unitprod` (units produced), `sqkill/ekills` (kills), `sqlost` (lost), `bprod/blost`
(buildings), `upg` (upgrades), `totalcmds` (commands → APM), `gt` (game time), `abil`, `edeaths`, and many
zero-valued fields shared with other Relic titles. This is the only source of per-match performance
telemetry; AoE4 World's `include_stats` is the other partial source.

Caveats: map names are not resolved (join on `startgametime` with AoE4 World games), civilizations are
numeric ids, leaderboard 0 semantics are unclear, and nothing here is guaranteed stable.

## 4. Recommendation for a real site

1. **Prototype / MVP:** browser → AoE4 World directly (as built). Add a tiny proxy for the official API.
2. **Production:** a backend that ingests both sources on a schedule (`/games?updated_since`, dumps,
   official ladders and match history), stores them, and serves its own API. Benefits: independence from
   third-party uptime, rate-limit safety, and features neither source offers directly (rating
   distributions, long-term trends, clan pages, custom percentiles, replay-derived build orders).
3. Credit AoE4 World visibly, keep request volume modest, and talk to the maintainers on their Discord
   before launching anything high-traffic.
