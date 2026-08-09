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

## Stack

- **Hosting:** Cloudflare Pages
- **Deploys:** GitHub → Cloudflare (auto, on push)
- **Build:** none — static files only, plus a couple of Pages Functions for the Cloudflare dashboard's backend

---
Part of the [bstef.com](https://bstef.com) / [peacock.computer](https://peacock.computer) network.
