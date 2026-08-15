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
| `volvo.html` | Volvo car dashboard — status, remote controls, trip log & map, software/app updates |

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
| `functions/_shared/volvo.js` | OAuth token refresh (persisted in D1) and the authenticated fetch wrapper |

Volvo's public API only reports a vehicle's *current* location, not a trip history, so this dashboard builds its own trip log: a scheduled job hits `/api/volvo/poll` every few minutes, and that endpoint derives trips from consecutive location pings stored in D1 (see `schema/volvo.sql`).

### One-time setup

1. **Register an app** at [developer.volvocars.com](https://developer.volvocars.com), subscribe to the Connected Vehicle, Location, and (if applicable) Energy APIs, and complete the OAuth 2.0 authorization-code + PKCE flow for your own car once to obtain a `client_id`, `client_secret`, and a `refresh_token`. Note your vehicle's VIN.
2. **Create the D1 database**: `wrangler d1 create bstefcf-volvo`, then either paste the returned `database_id` into `wrangler.toml`, or bind it from the Cloudflare Pages dashboard (Settings → Functions → D1 database bindings → variable name `VOLVO_DB`) if this project deploys via git integration rather than `wrangler pages deploy`.
3. **Apply the schema**: `wrangler d1 execute bstefcf-volvo --remote --file=schema/volvo.sql`.
4. **Set Pages environment variables/secrets**: `VOLVO_CLIENT_ID`, `VOLVO_CLIENT_SECRET`, `VOLVO_API_KEY` (the VCC API key), `VOLVO_REFRESH_TOKEN` (bootstraps the very first token exchange — after that, D1 holds the rotated token), `VOLVO_VIN`, and `POLL_SECRET` (a random string that authorizes calls to `/api/volvo/poll`).
5. **Schedule the poller**: Cloudflare Pages Functions don't support Cron Triggers directly, so `.github/workflows/volvo-poll.yml` calls `/api/volvo/poll` on a schedule instead. Set the repo secrets `VOLVO_POLL_URL` (e.g. `https://bstef.pages.dev/api/volvo/poll`) and `VOLVO_POLL_SECRET` (matching `POLL_SECRET` above).

## Stack

- **Hosting:** Cloudflare Pages
- **Deploys:** GitHub → Cloudflare (auto, on push)
- **Build:** none — static files only, plus a couple of Pages Functions for the Cloudflare dashboard's backend

---
Part of the [bstef.com](https://bstef.com) / [peacock.computer](https://peacock.computer) network.
