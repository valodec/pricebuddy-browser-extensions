# PriceBuddy Browser Extensions

Browser extensions that act as companion clients for a self-hosted
[PriceBuddy](https://github.com/jez500/pricebuddy) price-tracking instance.

| Browser | Directory | Status |
| ------- | --------- | ------ |
| Chrome / Chromium / Edge | [`chrome/`](chrome/) | Prototype — works, not yet published |
| Firefox | — | Not started |

## What it does

Click the toolbar icon on any product page to open an in-page panel:

- **Track** — the detected price and title for this page, and one click to start
  tracking it in PriceBuddy.
- **Insights** — for an already-tracked product: a buy-here-or-switch verdict,
  the current store's price history, every store's price with a BEST badge, and
  all-store min/avg/max.
- **Tune** — a scrape-strategy workbench. Auto-detect the title/price/image
  selectors, or hand-tune them with a click-the-element picker and test them
  against the live page before saving the store config.

You need your own PriceBuddy server and an API token from it. See
[`chrome/README.md`](chrome/README.md) for setup.

## Repository layout

```
chrome/            The Chrome (MV3) extension — see chrome/README.md
  manifest.json
  src/
    background.js    Service worker: API proxy + panel toggle
    lib/api.js       PriceBuddyClient — thin HTTP API wrapper
    content/         In-page panel (shadow DOM) + pure view-models
    options/         Settings page
  fonts/           Self-hosted Manrope + DM Mono (OFL)
  test/            node --test unit tests for the view-models
CLAUDE.md          Working notes for AI coding agents
PRIVACY.md         Privacy policy (required for store submission)
PUBLISHING.md      Chrome Web Store submission + GitHub Actions release guide
TODO.md            Prioritised backlog
```

## Development

No build step, no dependencies. Load `chrome/` as an unpacked extension.

```bash
cd chrome && npm test     # runs node --test over test/
```

## Licence

MIT — see [LICENSE](LICENSE). Bundled fonts are SIL OFL 1.1; see
[`chrome/fonts/LICENSE-OFL.txt`](chrome/fonts/LICENSE-OFL.txt).
