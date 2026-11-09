# Replay corpus estimate · top 200 Solo Ranked players

Generated 2026-11-08 21:11 by `tools/corpus_estimate.py --top 200 --pages 3 --days 45`. Counts come from AoE4 World game lists only; no replay was downloaded. Ranked seeds are random per match, so a same-seed corpus is not a practical target; "same map" is the finest level the data supports.

## Sample

- Leaderboard ranks 1–201 (ratings 1811–2520), up to 150 most recent Solo Ranked games each.
- 25381 unique games listed, 23356 finished Ranked 1v1 games of 8+ minutes, from 2022-04-13 to 2026-11-09.
- **8645 of them started in the last 45 days**, the window in which the official replay store still tends to have the file: about 1345 games per week across these players.
- Name-based player matching in replays fails for roughly one game in seven today (players change clan tags); the store now matches by civ and team as a fallback.

## Civ matchups in the last 45 days

- 325 distinct matchups (of 325 possible with 25 civilizations, mirrors included). Median games per matchup: 19; 161 matchups have 20+ games, 276 have 10+. Mirrors: 691 games.

| Matchup | Games | Share |
|---|---:|---:|
| scots vs vikings | 451 | 5.2% |
| vikings vs vikings | 212 | 2.5% |
| scots vs scots | 156 | 1.8% |
| french vs knights_templar | 124 | 1.4% |
| english vs french | 89 | 1.0% |
| french vs mongols | 87 | 1.0% |
| knights_templar vs mongols | 74 | 0.9% |
| house_of_lancaster vs knights_templar | 74 | 0.9% |
| byzantines vs french | 72 | 0.8% |
| french vs vikings | 72 | 0.8% |
| english vs knights_templar | 71 | 0.8% |
| byzantines vs knights_templar | 67 | 0.8% |
| french vs house_of_lancaster | 66 | 0.8% |
| french vs scots | 66 | 0.8% |
| holy_roman_empire vs vikings | 64 | 0.7% |
| french vs macedonian_dynasty | 63 | 0.7% |
| knights_templar vs macedonian_dynasty | 62 | 0.7% |
| jin_dynasty vs vikings | 61 | 0.7% |
| jin_dynasty vs knights_templar | 60 | 0.7% |
| house_of_lancaster vs mongols | 57 | 0.7% |

## Civ matchup on one map, last 45 days

- 2660 distinct matchup × map combinations; median 2 games each; 151 combinations have 10+ games, 526 have 5+.

| Matchup on map | Games | Share |
|---|---:|---:|
| scots vs vikings on Dry Arabia | 122 | 1.4% |
| scots vs vikings on Cliffside | 53 | 0.6% |
| scots vs vikings on Lipany | 50 | 0.6% |
| scots vs vikings on King of the Hill | 47 | 0.5% |
| vikings vs vikings on Dry Arabia | 45 | 0.5% |
| french vs knights_templar on Dry Arabia | 37 | 0.4% |
| scots vs scots on Dry Arabia | 35 | 0.4% |
| scots vs vikings on Golden Pit | 34 | 0.4% |
| scots vs vikings on Fangs | 32 | 0.4% |
| scots vs vikings on Marshland | 30 | 0.3% |
| vikings vs vikings on Lipany | 29 | 0.3% |
| byzantines vs french on Dry Arabia | 28 | 0.3% |
| english vs french on Dry Arabia | 27 | 0.3% |
| scots vs vikings on Himeyama | 25 | 0.3% |
| french vs mongols on Dry Arabia | 24 | 0.3% |

## Maps in the last 45 days

| Map | Games | Share |
|---|---:|---:|
| Dry Arabia | 2235 | 25.9% |
| Lipany | 1344 | 15.5% |
| Himeyama | 906 | 10.5% |
| King of the Hill | 750 | 8.7% |
| The Pit | 550 | 6.4% |
| Flankwoods | 437 | 5.1% |
| Atacama | 436 | 5.0% |
| Cliffside | 295 | 3.4% |
| Gorge | 255 | 2.9% |
| High View | 207 | 2.4% |
| Fangs | 205 | 2.4% |
| Marshland | 196 | 2.3% |

## Civ picks in the last 45 days (player-games)

| Civilization | Games | Share |
|---|---:|---:|
| vikings | 1528 | 8.8% |
| french | 1350 | 7.8% |
| scots | 1252 | 7.2% |
| knights_templar | 1228 | 7.1% |
| english | 952 | 5.5% |
| mongols | 917 | 5.3% |
| house_of_lancaster | 859 | 5.0% |
| jin_dynasty | 730 | 4.2% |
| byzantines | 730 | 4.2% |
| rus | 729 | 4.2% |
| macedonian_dynasty | 698 | 4.0% |
| chinese | 662 | 3.8% |
| zhu_xis_legacy | 627 | 3.6% |
| japanese | 585 | 3.4% |
| holy_roman_empire | 581 | 3.4% |
| abbasid_dynasty | 494 | 2.9% |
| ottomans | 469 | 2.7% |
| tughlaq_dynasty | 457 | 2.6% |
| malians | 441 | 2.6% |
| order_of_the_dragon | 434 | 2.5% |
| golden_horde | 426 | 2.5% |
| ayyubids | 393 | 2.3% |
| sengoku_daimyo | 285 | 1.6% |

## What this means for a "pro baseline"

- To have, say, 20 analysed games for every matchup that occurs at all, about 5184 replays would be fetched (one per game, every player perspective kept). At the store's observed pace of one download per 1–2 s with pauses on HTTP 429, that is roughly 130–259 minutes of harvesting.
- Fetching **every** recent game of these players is 8645 replays (~3890 MB), 3.6–7.2 hours at that pace.
- Per map the samples thin out fast: only the most common matchups on the most common maps reach double digits, so a map-specific baseline needs several weeks of harvesting or a wider player set.
