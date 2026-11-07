# Roadmap ideas — what the best stats sites do, and what Forge can borrow

Surveyed on 7 Nov 2026: **op.gg**, **Mobalytics**, **U.GG**, **Blitz**, **Tracker.gg** (League / Valorant profiles of
well-known pros), plus the Age of Empires tools **aoe2insights**, **AoE II Companion**, **aoe4world** and Dota's
**Stratz**. Each idea below is tied to the data Forge already has (AoE4 World API, official counters, replays)
so the list is a backlog, not a wish list.

Effort: **S** = an afternoon, **M** = a few days, **L** = needs new infrastructure (a corpus, a hosted backend, accounts).

---

## 1. What each site does well

| Site | Signature ideas worth stealing |
|---|---|
| **op.gg** | Ladder rank *and* "top 0.01 %" percentile in the header · "Last updated 3 min ago" + Update button · season-tier history table · queue filter tabs on the match list · colour-coded match rows with inline badges (Double kill, *Late bloomer*, *Struggle*, MVP/ACE score) and both rosters clickable · **Recently played with** (last 20 games, W–L per teammate) · **Activity pattern** (games and win rate by weekday and by hour) · *Last 20 games vs season* deltas · Multi-search (paste a lobby) · Live game tab · canned AI prompts ("Analyze my recent matches", "What is my skill level?") |
| **Mobalytics** | **Playstyle tags on the profile** (Public Enemy, Early Farmer, Mid Game Master, Risk Blind…) — persistent identity, not per match · GPI skill radar · LP progress chart (last 50 games) · GitHub-style **activity calendar** (120 days, good/bad day colouring) · match rows grouped into **sessions** with a session record ("22 days ago · 2W 1L · 66.7 %") · per-match badges (Comeback King, Stomp, Ahead of the Curve, Most Experienced Player) · tabs Overview / Champion Pool / Matchup Pool / LP Gains |
| **U.GG** | Whole-career season ribbon (S4 Challenger … S15 Master) · **LP gained per champion** in the sidebar · Recently Played With table · match-list header summary (65 % WR last 20, KDA) · Live Game tab |
| **Blitz** | **Post-match analysis** with "key insights that level up your game" · benchmarking overlay (your metrics vs. rank, in real time) · loading-screen **scouting** of allies and enemies · suggested picks and bans · pro builds you can import · compare your performance across your most-used champions and roles |
| **Tracker.gg** | A composite **Tracker Score** per match and overall · **stat percentiles** vs. all players · sessions · peak rank · top agents / weapons / maps widgets · "Live Update On" |
| **aoe2insights** | Match page with **Uptimes**, **Units over time**, **Economy units over time**, Market usage · planned deep analysis: TC idle time, eco efficiency, floating resources, gather rates, army value, map control · **Awards** on profiles · community profile pages · InsightsTV (who is streaming, coaching tags) |
| **AoE II Companion / Stratz** | **Follow players** with push notifications when they start a match · **Peers** page (everyone you shared ≥ 2 games with, filterable) · compare averages only within the same role / bracket · country leaderboards |
| **aoe4world** (incumbent) | Twitch VOD linking per game · ongoing-games feed · esports Elo · replay-derived game summaries behind a share link (not in the API) |

What **not** to copy: ad walls and premium gating, opaque single-number "OP scores" (prefer explainable tags), KDA-centric
metrics that have no RTS equivalent, and the visual clutter of three columns of widgets fighting for attention.
Forge's calm density is a feature.

---

## 2. Idea catalogue

### Profile page

| # | Idea | Inspired by | Data | Effort |
|---|---|---|---|---|
| P1 | **Percentile in the header**: "#301 · top 0.8 % of Solo Ranked", peak rank level, and a compact career ribbon of season finishes | op.gg, U.GG | leaderboard `rank` / `total_count`, `previous_seasons` — have | S |
| P2 | **Last 20 vs season** tile row: win rate, avg game length, avg rating change, avg opponent rating, each with a delta | op.gg | games list — have | S |
| P3 | **Activity pattern**: games and win rate by weekday and by hour of day; 120-day calendar heatmap coloured by net rating | op.gg, Mobalytics | games `started_at`, `rating_diff` — have | S |
| P4 | **Recently played with**: teammates *and* opponents of the last 50 games with W–L and a "compare" link (Insights already has rivals; add teammates and surface it on Overview) | op.gg, U.GG, Stratz | games — have | S |
| P5 | **Rating gained per civilization** and per map, sorted; "your best map / worst map" | U.GG (LP per champion) | games — have | S |
| P6 | **Playstyle tags on the profile**: aggregate the per-game tags over the player's analysed replays into identity tags with frequencies ("Boomer 62 %", "2-TC booms", "Infantry main", "Fast feudal") | Mobalytics | replays — fetchable for *anyone* from the official store | M |
| P7 | **Per-match badges for any player's recent games** (Top fragger, Highest APM, Fed, Biggest army): the official match history is public per profile id, so badges are not limited to "me" | op.gg, Mobalytics | `getRecentMatchHistory` for the viewed profile — have via proxy | M |
| P8 | **Session grouping** of the match list with a session record and net rating ("Today · 3W 1L · +41") | Mobalytics, Tracker.gg | games — have | S |
| P9 | **Match rows v2**: colour-coded result, both rosters inline and clickable, rating change, badges, expand-in-place for details; keep the mode filter tabs | op.gg, U.GG | have | M |
| P10 | **"In a game right now"** banner with map, mode and opponents, from the live feed; link to scouting (C3) | op.gg / U.GG Live game | `/games` ongoing — have | S |
| P11 | **Freshness and refresh**: "Updated 2 min ago" plus a refresh button that busts the cache | op.gg, Tracker.gg | — | S |
| P12 | **Personal records and awards**: fastest feudal, most villagers, longest game, longest win streak, biggest upset (rating gap), earliest 2nd TC | aoe2insights awards, Mobalytics records | games + analysed replays — have for me, fetchable for others | M |
| P13 | **Twitch**: "live now" badge on profiles and leaderboards; VOD link on games when the player was streaming | aoe4world, aoe2insights | leaderboard `twitch_url`, `twitch_is_live` — have | S |

### Match detail (My games)

| # | Idea | Inspired by | Data | Effort |
|---|---|---|---|---|
| M1 | **Key insights**, rule-based sentences at the top of a game: "You reached Castle 2:10 after your opponent", "You stopped making villagers at 14:00 with 46", "Your army was outnumbered 2:1 at 12:00", "Second TC 5 minutes later than your average" | Blitz post-match analysis | replays — have | M |
| M2 | **Minute-by-minute timelines**: units queued per minute per player (lines), villager count curve, age-up and TC markers; army value estimate from unit costs (aoe4world data has costs) | aoe2insights "Units over time" | replays (re-bucket to 1 min) + unit costs — have | M |
| M3 | **Benchmark against yourself**: each key number vs. your own median for that civ and mode ("villagers by 10:00: 46, your median 52") | Blitz mobile (compare to your most-used champions) | analysed replays — have | S |
| M4 | **Benchmark against the bracket**: same numbers vs. a Conqueror / Diamond median built from a corpus of fetched replays (a few hundred per bracket, refreshed per patch) | Blitz benchmarking, Tracker.gg percentiles | replay corpus — must be built | L |
| M5 | **Team contribution view**: share of team kills, losses, buildings, army at 15:00; MVP by an explainable formula shown alongside the tags | Tracker Score, op.gg ACE/MVP | counters + replays — have | S |
| M6 | **Share card**: one-image summary of a game or a profile for Discord | op.gg, Tracker.gg | render from existing data | M |

### Compare and scouting

| # | Idea | Inspired by | Data | Effort |
|---|---|---|---|---|
| C1 | **Skill radar** (two or more players): Economy (villagers by 10:00), Tempo (first age-up), Aggression (military by 8:00), Tech (upgrades per game), Macro (APM), Efficiency (K/D) — normalised to the pair or friend group first, to the bracket later (M4) | Mobalytics GPI | replays + counters — have | M |
| C2 | **Head-to-head over time** and common opponents, extending today's H2H card | — | games — have | S |
| C3 | **Multi-search / lobby scouting**: paste up to 8 names (or pick a live game) → ratings, win rates, civ pools, playstyle tags, team-average rating; "which team is favoured" | op.gg multi-search, Blitz loading-screen scouting | search + profiles + P6 — have | M |
| C4 | **Friends leaderboard** and a **Peers** page (everyone you have shared ≥ 2 games with, as teammate or opponent) | Stratz Peers, AoE II Companion country boards | games + config — have | S |

### Leaderboards and stats

| # | Idea | Inspired by | Data | Effort |
|---|---|---|---|---|
| L1 | **Rank distribution histogram** with a "you are here" marker; sample ~20 pages per ladder to estimate tier boundaries | Tracker.gg percentiles | leaderboard pages — have, needs sampling | M |
| L2 | **Movers**: biggest 7-day gains and losses, longest active streaks, most games this week | op.gg Highlights | `max_rating_7d`, `streak`, `games_count` — have | S |
| L3 | **Civ pages**: one page per civilization with win rate by bracket and map, best matchups, top players on that civ, your own record with it | Blitz tier lists / champion pages, aoe2insights civ pages | stats endpoints + leaderboard — have | M |
| L4 | **Patch compare**: civ win-rate delta between patches ("26.21 → 26.22" style arrows) | Blitz tier list deltas | stats `patch` param — have | S |

### Platform

| # | Idea | Inspired by | Data | Effort |
|---|---|---|---|---|
| X1 | **Ctrl+K command palette** search for players, civs, maps | Blitz, Mobalytics | — | S |
| X2 | **Favourites and notes** on players (local storage first; account later) | op.gg, Stratz follow | — | S |
| X3 | **Companion auto-analysis**: the local server watches the replay folder and analyses new games as they land, with a "new game analysed" toast | Blitz, AoE II Companion | local — have | M |
| X4 | **Follow and notify**: alerts when a friend starts a game (live feed) — in-app first, push later | AoE II Companion, Stratz | `/games` polling — have; push needs a backend | M / L |
| X5 | **Natural-language summaries** of a profile or a game generated from the structured data ("Analyze my last 10 games") | op.gg AI prompts | existing JSON + an LLM | L |

---

## 3. Suggested order

1. **Quick wins on the profile (all S):** P1 percentile and career ribbon · P2 last-20 deltas · P3 activity pattern · P4 recently played with · P5 rating per civ and map · P8 sessions · P10 live banner · P11 freshness · P13 Twitch. Together these make the profile feel like op.gg/U.GG in a day or two without new data.
2. **The differentiators nobody else has for AoE4 (M):** P6 playstyle tags on profiles · M1 key insights · M2 minute timelines · C1 skill radar · C3 lobby scouting · P12 records. All run on the replay pipeline that already exists.
3. **Infrastructure bets (L):** M4 bracket benchmarks (needs a replay corpus) · L1 rank distribution · X4 follow/notify and X5 AI summaries (need a hosted backend and accounts).

---

## 4. Design notes carried over from the survey

- Group matches into **sessions**; it is the single most readable change the three LoL sites share.
- Keep tags **explainable**: every badge shows its rule and the numbers (already the case). Mobalytics and op.gg both
  gate real explanations behind an app download; Forge can make that the default.
- Put **percentiles** next to raw numbers wherever a distribution exists (ladder rank, win rate, APM).
- Compare **like with like**: Stratz compares only within a role; for AoE4 that means within mode (1v1 vs team) and
  bracket, never a raw average.
- One hero number per view, status colours only for win/loss, and no dual axes — the current chart rules hold.
