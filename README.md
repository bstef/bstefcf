# bstefcf

Personal dashboards, utilities, and experiments hosted on Cloudflare Pages.

🔗 **Live:** [bstef.pages.dev](https://bstef.pages.dev)

> This repository may be kept **private**. Cloudflare Pages can deploy a private GitHub repository as long as the Cloudflare GitHub App remains authorized for the repo.

## What's here

Cloudflare Pages deploys this repository automatically from `main`. There is no frontend build step: the site is primarily plain HTML/CSS/JavaScript plus Cloudflare Pages Functions under `functions/`.

| Path | Description |
| --- | --- |
| `index.html` | Landing page / app launcher |
| `perodic.html` | Interactive periodic table |
| `qr.html` | QR code generator |
| `whois.html` | Domain & IP WHOIS lookup |
| `fork-sync.html` | GitHub fork sync status report |
| `cloudflare.html` | Cloudflare traffic/cache/error dashboard |
| `inwood-eero-network.html` | Interactive home network topology |
| `volvo.html` | Volvo dashboard — vehicle status, controls, trips, map, fuel tracking and updates |
| `home-value.html` | Private Home Value Tracker — family properties, valuations, rent data, taxes and value-history charts |

## Adding a new page

1. Add the new `.html` file to the repo.
2. Add one entry to `SITE_APPS` in `site-nav.js`.
3. Commit/push to `main`.
4. Cloudflare Pages deploys the change automatically.

`SITE_APPS` is the shared source of truth for the homepage cards and footer navigation, so a single entry keeps navigation in sync across the site.

## Shared navigation

`site-nav.js` + `site-nav.css` provide the shared navigation system.

| Mount point | Renders |
| --- | --- |
| `<div class="grid" id="app-grid"></div>` | Cards on `index.html` |
| `<div id="site-back"></div>` | Back-to-home link on app pages |
| `<div id="site-footer"></div>` | Links to the other apps plus site/source links |

## Home Value Tracker

`home-value.html` is a personal real-estate dashboard for a small set of family properties. The current UI includes:

- Portfolio overview with five tracked properties
- Separate tabs for each property
- Current valuation and valuation range
- Bedrooms, bathrooms, living area, year built, assessment and other property facts
- Property tax / parcel information where available
- Rental-estimate fields, including support for Zillow and planned RentCast data
- Value-history charts per property
- Source separation so Zillow, Redfin, Realtor and RentCast values are not silently blended
- Image slots intended for exact-property listing images or exact-address Street View fallbacks

### Home Value Tracker access control

Because the dashboard contains residential addresses, `/home-value.html` is protected by a Pages middleware gate in `functions/_middleware.js`.

The login form posts to `functions/api/home-auth.js` and uses the existing Cloudflare Pages secret:

- `DASHBOARD_TOKEN`

A successful login creates an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. The protected response is also marked `private, no-store` and `noindex, nofollow, noarchive`.

The token is **not embedded in the HTML or committed to GitHub**. Keeping this repository private is additionally recommended because the property dataset currently lives in `home-value.html` itself.

This is intentionally a lightweight shared-secret gate. Cloudflare Access / Zero Trust remains the stronger option if identity-based access is desired later.

## Cloudflare dashboard backend

`cloudflare.html` uses Pages Functions in `functions/`:

| Path | Description |
| --- | --- |
| `functions/api/analytics.js` | Queries Cloudflare GraphQL Analytics and aggregates traffic |
| `functions/api/zones.js` | Lists account zones for the domain picker |
| `functions/_shared/cf.js` | Shared Cloudflare GraphQL/REST helpers |

Required Pages secret:

- `CLOUDFLARE_API_TOKEN`

## Volvo dashboard backend

`volvo.html` talks to Volvo's official Connected Vehicle, Location and Energy APIs through Pages Functions in `functions/api/volvo/`.

| Path | Description |
| --- | --- |
| `functions/api/volvo/vehicle.js` | Aggregates vehicle state and diagnostics |
| `functions/api/volvo/location.js` | Current vehicle location |
| `functions/api/volvo/commands.js` | Supported remote commands |
| `functions/api/volvo/command.js` | Executes remote commands |
| `functions/api/volvo/trips.js` | Trip list/detail from D1 |
| `functions/api/volvo/poll.js` | Saves location samples and derives trip state |
| `functions/api/volvo/updates.js` | Software/app update information |
| `functions/api/volvo/fuel.js` | Fuel log and calculated fuel stats |
| `functions/api/volvo/fuel-import.js` | CSV fuel-history importer |
| `functions/api/volvo/oauth-setup.js` | OAuth setup helper |
| `functions/_shared/volvo.js` | Shared auth, Volvo API and token-refresh helpers |

### Why there is a GitHub Action

Volvo's public API exposes the vehicle's **current location**, but does not provide a complete historical trip log. The dashboard therefore creates its own trip history by periodically sampling the vehicle location and storing those samples in D1.

`.github/workflows/volvo-poll.yml` is the scheduler. Every five minutes it calls:

`POST /api/volvo/poll`

with a dedicated bearer secret. `poll.js` then fetches the current vehicle location and updates the trip start/continue/close state machine.

### GitHub Action configuration

The workflow needs two **GitHub Actions repository secrets**:

- `VOLVO_POLL_URL` — normally `https://bstef.pages.dev/api/volvo/poll`
- `VOLVO_POLL_SECRET` — must match the Cloudflare Pages `POLL_SECRET`

Previously the workflow intentionally exited with an error when either secret was missing, which caused repeated red/failing scheduled runs. It now **skips successfully with a notice when polling is not configured**.

To enable trip polling, set both GitHub repository secrets and make sure Cloudflare Pages also has the matching `POLL_SECRET`.

### Volvo access control

User-facing routes under `/api/volvo/` use `DASHBOARD_TOKEN` as a bearer token. The unattended poll endpoint uses its separate `POLL_SECRET`.

The shared-secret model is a minimum protection layer. Cloudflare Access is recommended if the Volvo dashboard and APIs need identity-based protection.

### Volvo setup summary

Cloudflare Pages environment/bindings used by the Volvo dashboard include:

- `VOLVO_CLIENT_ID`
- `VOLVO_CLIENT_SECRET`
- `VOLVO_API_KEY`
- `VOLVO_VIN`
- `DASHBOARD_TOKEN`
- `POLL_SECRET` (when scheduled trip polling is enabled)
- `VOLVO_DB` D1 binding
- Optional bootstrap `VOLVO_REFRESH_TOKEN`

GitHub Actions secrets used for trip polling:

- `VOLVO_POLL_URL`
- `VOLVO_POLL_SECRET`

## Private-repository notes

The site can continue deploying from a private GitHub repository. After changing repository visibility:

1. Confirm the Cloudflare Pages project still shows `bstef/bstefcf` as its connected Git repository.
2. Confirm the Cloudflare GitHub App has access to the private repo.
3. Make a small commit to `main` and verify a Pages deployment starts.
4. GitHub Actions continue to work in private repositories, but hosted-runner usage is subject to the account's private-repo Actions allowance.

The deployed Pages site is still publicly reachable unless individual routes are protected. Repository privacy hides the source; it does **not** automatically make `bstef.pages.dev` private.

## Stack

- **Hosting:** Cloudflare Pages
- **Source:** GitHub (`main`)
- **Frontend:** HTML / CSS / JavaScript
- **Backend:** Cloudflare Pages Functions
- **Database:** Cloudflare D1 where needed
- **Scheduled Volvo polling:** GitHub Actions
- **Authentication:** Lightweight shared-secret gates, with Cloudflare Access recommended for stronger identity-based protection

---
Part of the [bstef.com](https://bstef.com) / [peacock.computer](https://peacock.computer) network.
