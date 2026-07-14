# bstefcf

Static pages hosted on Cloudflare Pages — a landing page plus whatever experiments and artifacts I drop in over time.

🔗 **Live:** [bstef.pages.dev](https://bstef.pages.dev)

## What's here

This repo is deployed automatically to Cloudflare Pages on every push to `main`. There's no build step — it's just plain HTML files served as-is.

| Path | Description |
|------|--------------|
| `index.html` | Landing page |
| `perodic.html` | interactive periodic table |
| `qr.html` | QR Code Generator |

## Adding a new page

1. Drop a new `.html` file anywhere in the repo (root or a subfolder).
2. Commit and push to `main`.
3. Cloudflare Pages auto-deploys the change — it'll be live at `bstef.pages.dev/<filename>` within a minute or two.

## Stack

- **Hosting:** Cloudflare Pages
- **Deploys:** GitHub → Cloudflare (auto, on push)
- **Build:** none — static files only

---
Part of the [bstef.com](https://bstef.com) / [peacock.computer](https://peacock.computer) network.
