# bstefcf

Static pages hosted on Cloudflare Pages — a landing page plus whatever experiments and artifacts I drop in over time.

🔗 **Live:** [bstef.pages.dev](https://bstef.pages.dev)

## What's here

This repo is deployed automatically to Cloudflare Pages on every push to `main`. There's no build step — it's just plain HTML files served as-is.

| Path | Description |
| --- | --- |
| `index.html` | Landing page |
| `perodic.html` | interactive periodic table |
| `qr.html` | QR Code Generator |
| `whois.html` | Domain & IP whois lookup |
| `fork-sync.html` | GitHub fork sync status report |
| `cloudflare.html` | Cloudflare traffic/cache/error dashboard, aggregated across all domains on the account |
| `volvo.html` | Volvo car dashboard — status, remote controls, trip log & map, fuel tracking, software/app updates |

## Adding a new page

1. Drop a new `.html` file anywhere in the repo (root or a subfolder).
2. Add an entry to the `SITE_APPS` array in `site-nav.js` (path, icon, name, description).
3. Commit and push to `main`.
4. Cloudflare Pages auto-deploys the change — it'll be live at `bstef.pages.dev/<filename>` within a minute or two.

Step 2 is what makes the new page show up as a card on the index and as a nav link in every other page's footer — see below.

## Shared navigation

`site-nav.js` + `site-nav.css` are the single source of truth for site-wide navigation. `SITE_APPS` in `site-nav.js` lists every app; the script renders it into whichever of these mount points a page includes:

| Mount point | Renders |
| --- | --- |
| `<div class="grid" id="app-grid"></div>` | index.html's card grid |
| `<div id="site-back"></div>` | "&larr; back to bstef.pages.dev" link (skipped on the index itself) |
| `<div id="site-footer"></div>` | nav links to every other app, plus bstef.com/source links |

Because every page pulls from the same `SITE_APPS` array, adding one entry keeps the index cards, every footer, and the favicon-matching icons all in sync — no per-page edits needed. Page-specific footer content (e.g. qr.html's privacy note, fork-sync.html's scheduled-task blurb) stays separate and is rendered alongside `#site-footer`, not replaced by it.

## Cloudflare dashboard backend

`cloudflare.html` is powered by Pages Functions in `functions/`:

| Path | Description |
| --- | --- |
| `functions/api/analytics.js` | Queries Cloudflare's GraphQL Analytics API and aggregates traffic across zones |
| `functions/api/zones.js` | Lists the account's zones for the domain picker |
| `functions/_shared/cf.js` | Shared GraphQL/REST helpers used by both endpoints |

Requires a `CLOUDFLARE_API_TOKEN` secret (scoped to `Zone → Analytics → Read` and `Zone → Zone → Read`, all zones) set as a Pages environment variable — see `functions/api/analytics.js` for details.

## Volvo dashboard backend

`volvo.html` talks to Volvo's official [Connected Vehicle / Location / Energy APIs](https://developer.volvocars.com) through Pages Functions in `functions/api/volvo/`:

| Path | Description |
| --- | --- |
| `functions/api/volvo/vehicle.js` | Aggregates doors, windows, odometer, tyres, warnings, diagnostics, statistics, engine status, fuel, brakes, energy |
| `functions/api/volvo/location.js` | Current vehicle location |
| `functions/api/volvo/commands.js` | Lists the remote commands this vehicle supports |
| `functions/api/volvo/command.js` | Executes a remote command (lock, unlock, climatization, flash, honk, engine start/stop) |
| `functions/api/volvo/trips.js` | Trip list / single trip detail, read from D1 |
| `functions/api/volvo/poll.js` | Polling target — logs a location ping and runs the trip start/continue/close state machine |
| `functions/api/volvo/updates.js` | Best-effort car software info + this dashboard's own version/changelog |
| `functions/api/volvo/fuel.js` | Fill-up log: list with derived MPG/cost stats (GET), add a fill-up (POST), delete one (DELETE) |
| `functions/api/volvo/fuel-import.js` | One-time CSV import (Fuelly export or similar) to backfill fuel history |
| `functions/api/volvo/oauth-setup.js` | One-time OAuth helper backing `volvo-setup.html` — hands back the authorize URL, then exchanges a code for tokens |
| `functions/_shared/volvo.js` | OAuth token refresh (persisted in D1, single-flight to survive concurrent requests), the authenticated fetch wrapper, and the dashboard access-code check |

Volvo's public API only reports a vehicle's *current* location, not a trip history, so this dashboard builds its own trip log: a scheduled job hits `/api/volvo/poll` every few minutes, and that endpoint derives trips from consecutive location pings stored in D1 (see `schema/volvo.sql`).

### Access control

Every route under `/api/volvo/` except `poll.js` (which uses its own `POLL_SECRET` for the unattended cron caller) requires a `DASHBOARD_TOKEN` shared secret, sent as `Authorization: Bearer <token>`. `volvo.html` prompts for it once and caches it in `localStorage`. This exists because the API endpoints — including the ones that send lock/unlock/climatization/engine commands — would otherwise be reachable by anyone who found the public Pages URL.

That said, an app-level shared secret is a minimum bar, not real authentication. For meaningful protection, put **Cloudflare Access** (Zero Trust) in front of `/volvo.html` and `/api/volvo/*`, gated to your own email/identity — that's a Cloudflare dashboard policy, not a code change, so it isn't set up by this PR. Treat `DASHBOARD_TOKEN` as defense-in-depth underneath it, not a replacement for it.

### Fuel tracking

There's no public Fuelly API (confirmed via their forums — developers have asked for years), so `/api/volvo/fuel` is a self-hosted fill-up log instead: log gallons/price/odometer/station from the Fuel tab, and MPG is derived server-side using the standard full-to-full method (gallons accumulate across any partial fills until the next full fill closes the interval). To bring in existing history, export your Fuelly log as CSV (vehicle page → *Export Fuel-ups* → *All Fuelups*) and upload it via the Fuel tab's importer — `fuel-import.js` matches common column-name variants rather than a fixed header list, since exporter formats vary. New fill-ups after that are logged natively.

### One-time setup

Do these in order — each step after the first depends on the one before it.

1. **Register an app** at [developer.volvocars.com](https://developer.volvocars.com) and subscribe it to the Connected Vehicle, Location, and (if applicable) Energy APIs. The app page gives you a `client_id`, `client_secret`, and a VCC API key. Also note your vehicle's VIN (from the car's registration/VIN plate, or the Volvo app).
2. **Set the secrets you have so far** in the Cloudflare Pages dashboard (Settings → Environment variables — this repo has no `wrangler.toml`, so all bindings/secrets live there, same as `CLOUDFLARE_API_TOKEN` for `cloudflare.html`): `VOLVO_CLIENT_ID`, `VOLVO_CLIENT_SECRET`, `VOLVO_API_KEY`, `VOLVO_VIN`, and `DASHBOARD_TOKEN` (any random string — this is what you'll type into the dashboard's login prompt, not something Volvo gives you). Redeploy after adding them so the Functions can see them.
3. **Create the D1 database**: `wrangler d1 create bstefcf-volvo`, bind it from the Pages dashboard (Settings → Functions → D1 database bindings → variable name `VOLVO_DB`), then apply the schema: `wrangler d1 execute bstefcf-volvo --remote --file=schema/volvo.sql`.
4. **Get a refresh token** by visiting `/volvo-setup.html` on your deployed site (log in with `DASHBOARD_TOKEN` from step 2) — it walks through registering a redirect URI, picking scopes, and running the OAuth authorization-code + PKCE flow, then hands you a `refresh_token` (and saves it straight to D1 if that's already set up, so step 3 first saves you a manual copy-paste). If you do it before D1 exists, paste the returned value into a `VOLVO_REFRESH_TOKEN` secret instead — it's only used to bootstrap the very first exchange; D1 takes over from there.
5. **Schedule the poller**: Cloudflare Pages Functions don't support Cron Triggers directly, so `.github/workflows/volvo-poll.yml` calls `/api/volvo/poll` on a schedule instead. Set the repo secrets `VOLVO_POLL_URL` (e.g. `https://bstef.pages.dev/api/volvo/poll`) and `VOLVO_POLL_SECRET` (matching a `POLL_SECRET` Pages secret you also set).
6. **(Recommended)** Add a Cloudflare Access policy in front of `/volvo.html`, `/volvo-setup.html`, and `/api/volvo/*` for real caller authentication — see "Access control" above.

## Stack

- **Hosting:** Cloudflare Pages
- **Deploys:** GitHub → Cloudflare (auto, on push)
- **Build:** none — static files only, plus a couple of Pages Functions for the Cloudflare dashboard's backend

---
Part of the [bstef.com](https://bstef.com) / [peacock.computer](https://peacock.computer) network.
