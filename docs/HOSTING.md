# Hosting Forge so friends can test it

Forge is a static site plus one small Python process (`server.py`) that serves the files, proxies the official
World's Edge API and runs the replay companion (game summaries, playstyle profiles, live-game opponent intel, the Cup).
Nothing else is needed: no database, no build step, no third-party Python packages.

| Option | What works | Effort | Cost |
|---|---|---|---|
| **A. Render web service** (recommended) | everything except *My games* (that page reads replays from your own PC) | 5 minutes, no CLI | free tier |
| **B. Any Docker host** (Fly.io, Railway, a VPS) | same as A | 10–20 minutes | varies |
| **C. GitHub Pages** (static only) | profiles (live game panel with API-only facts), compare basics, leaderboards, civs, maps, live feed — anything that only needs the AoE4 World API | 2 minutes | free |

## A. Render (full site, free)

1. Create an account at <https://render.com> and connect your GitHub account.
2. **New → Blueprint**, pick `NormalJon/aoe_site`, click **Apply**. The included [render.yaml](../render.yaml)
   creates one free web service named `forge-aoe4` that runs `python server.py` with `HOST=0.0.0.0`.
3. Wait for the first deploy (about a minute). The URL is shown at the top of the service page, e.g.
   `https://forge-aoe4.onrender.com`. Share that link.
4. Open the service's **Environment** tab and copy the generated `FORGE_ADMIN_KEY`. On the Cup page, paste it into
   *Prototype controls → Admin key → Save key*. Only people with the key can move the demo clock, add demo
   entrants, rebuild brackets or reset the tournament; signing up, locking in, drafting and reporting stay open.

Good to know on the free tier:

- The service **sleeps after about 15 minutes without traffic**; the first request afterwards takes 30–60 s.
  Tell your friends to wait for the first load. The paid starter plan removes this.
- The **disk is ephemeral**: downloaded replays, the analysis cache and the tournament state in
  `cache/tournament.json` are lost on every deploy or restart. Fine for testing; for a real cup, add a Render
  persistent disk mounted at `/opt/render/project/src/cache` (paid) or move the store to a database.
- Every push to `main` redeploys automatically.
- Outbound calls to AoE4 World and the official replay store now come from Render's IP, shared by everyone
  using the site, so the replay store's rate limit (HTTP 429) is reached sooner than on your own machine.

## B. Docker (any host)

```bash
docker build -t forge .
docker run -p 8000:8000 -e FORGE_ADMIN_KEY=choose-a-secret forge
```

The [Dockerfile](../Dockerfile) is a `python:3.12-slim` image with the repository copied in. `PORT` and `HOST`
are environment variables; mount a volume at `/app/cache` to keep replays and tournament state across restarts.
On Fly.io: `fly launch` (it detects the Dockerfile), then `fly secrets set FORGE_ADMIN_KEY=…`.

## C. GitHub Pages (static half only)

Repository **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**, or from a terminal:

```bash
gh api repos/NormalJon/aoe_site/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

The site appears at `https://normaljon.github.io/aoe_site/` within a minute or two. Pages cannot run
`server.py`, so the Official data tab, game summaries, playstyle/records, the skill radar, the replay tells in opponent intel and
the Cup show a notice explaining that the companion is not running. Pair it with option A if you want both a
permanent static URL and the full site.

## What friends can and cannot do

- Everything on the public pages works for any player: profiles, compare, leaderboards, civs, maps, live feed.
- Game summaries, playstyle, records, the radar and opponent intel work for **anyone's games**; the companion
  fetches replays from the official store on demand (retention there is limited, and bursts get rate-limited).
- The Cup is a shared prototype: everyone sees the same sign-ups and brackets. Identity is a claimed profile, so
  agree among yourselves not to impersonate each other; Steam sign-in is on the roadmap.
- **My games** stays personal: it reads replays from the folder of the machine running the server and needs
  `forge.local.json`, which is gitignored and never deployed.

## Checklist before sharing

- [ ] `server.py` starts with `HOST=0.0.0.0` (the blueprint and Dockerfile set it).
- [ ] `FORGE_ADMIN_KEY` is set on the host and saved in your own browser's Prototype controls.
- [ ] `/cache/` and `forge.local.json` are not served (the server answers 404 for them).
- [ ] Open the URL in a private window once: home, a profile (live game panel), a game summary, Cup.
