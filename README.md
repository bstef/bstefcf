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
2. Commit and push to `main`.
3. Cloudflare Pages auto-deploys the change — it'll be live at `bstef.pages.dev/<filename>` within a minute or two.

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
