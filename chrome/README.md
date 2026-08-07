# PriceBuddy Companion (Chrome extension)

A Manifest V3 Chrome extension that turns any product page into a live workbench
for your [PriceBuddy](../../) instance. It talks to PriceBuddy over its HTTP API
using a URL + token you configure — no code changes to the running site required.

> **Status: prototype.** Built as a proof of concept. The store-strategy helper
> and live extraction run against the officially scoped `meta-extraction` API and
> work with a minimal token. Product tracking / price history use the Filament
> CRUD API and need a broader token (see below).

## What it does

Click the toolbar icon on any product page to toggle an in-page panel. The panel
is organised into three tabs, with a ☀/☾ light/dark toggle (top-right) that
defaults to your OS preference and remembers your choice:

### Track

The landing tab for a page that isn't tracked yet. It shows the product title,
image and domain, the **price detected on this page**, and how many PriceBuddy
stores already match this domain. One click **Track this product**
(`POST /api/products` with `create_store: true`) starts monitoring it, then jumps
you to Insights. Shortcuts drop you into **Tune** to add another store or edit the
scrape settings.

### Insights

For a product that's already tracked, this is the payoff view. It fetches the
product with its materialised insights (`GET /api/products/{id}?include=insights`)
and renders:

- a **verdict card** up top — either *"Good time to buy here"* (with the
  deal-timing "cheaper than X% of the year"), or *"Cheaper at &lt;store&gt;"* with the
  saving and a one-click button to open the cheapest store;
- a **"You're here" card** — the current store's price, its own price-history
  sparkline, and that store's min / avg / max;
- the **other stores'** prices with an up/down trend glyph and a **BEST** badge
  (tap a row to open it);
- **all-stores min / avg / max**, and a link straight to the product in PriceBuddy.

### Tune

The scrape-strategy workbench, in two modes:

- **Auto-detect** — asks PriceBuddy to detect a strategy for the page (matching an
  existing store by domain, or auto-building one) and lists what each field
  (*title* / *price* / *image*) resolved to, with a confidence hint.
- **Manual override** — for each field choose a strategy type (Schema.org / CSS /
  XPath / Regex / JSON path) and a value. **Pick on page** lets you click the
  element and generates a resilient selector for you (preferring
  `itemprop`/`data-testid`/stable classes, with `nth-of-type` fallback, and
  attribute extraction `|src` / `|content` / `|value` where the value lives in an
  attribute). **Test all** scrapes the live page with your *draft* strategy and
  shows a matched / no-match preview per field, so you dial selectors in before
  saving. **Save** creates the store, or updates it when one already exists for
  the domain.

## Install (developer / unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser).
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this directory
   (`browser-extensions/chrome`).
4. The 🛒 PriceBuddy icon appears in the toolbar.

## Configure

1. Right-click the toolbar icon → **Options** (or click the icon on a page and
   press **Open settings**).
2. **API URL** — the base URL of your instance, e.g. `http://price-buddy.lndo.site`
   (no trailing `/api`).
3. **API token** — create one in PriceBuddy under **API keys**
   (`/admin/api-keys`):
   - For the store helper + extraction only, a *custom* token with the
     `user:detail` and `meta-extraction:extract` abilities is enough.
   - For **Track this product** and **Price history**, the token also needs
     access to the products API — use an **all access** (`*`) token. The panel
     surfaces a clear message if the token is too narrow (HTTP 403).
4. Click **Test connection** to verify (`GET /api/user`).

## Usage

1. Navigate to a product page on any store.
2. Click the 🛒 toolbar icon to open the panel.
3. **Pick** or type selectors for title/price/image → **Test extraction**.
4. Iterate until all three resolve, then **Copy config** into PriceBuddy — or
   **Track this product** to start monitoring it immediately.

## How it's wired

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest; registers the content script, service worker, options page. |
| `src/background.js` | Service worker. Toggles the panel on icon click and proxies all API calls (host permissions allow cross-origin fetch here without CORS friction). |
| `src/lib/api.js` | `PriceBuddyClient` — thin wrapper over the PriceBuddy HTTP API. |
| `src/content/panel.js` | In-page Shadow-DOM panel (Track / Insights / Tune tabs) + element picker. Lives in the page so clicking elements never dismisses the UI. |
| `src/content/viewmodels.js` | Pure data transforms (theme tokens, sparkline path, Insights/Track view-models). Loaded before the panel as `window.PBView`; unit-tested under `node --test`. |
| `src/options/*` | Settings page (API URL + token, stored in `chrome.storage.sync`). |

Settings and the theme choice live in `chrome.storage.sync`; per-page strategy
drafts live in `chrome.storage.local` keyed by host, so your work survives reloads
and re-picks.

The data transforms in `src/content/viewmodels.js` are pure and covered by tests:

```
cd browser-extensions/chrome && node --test
```

## Permissions

- `storage` — save settings and per-site drafts.
- `tabs`, `scripting` — toggle/inject the panel from the toolbar icon.
- `host_permissions: <all_urls>` — required so the service worker can reach the
  *user-configured* PriceBuddy origin (unknown at build time) and so the helper
  can run on arbitrary store pages.

## API endpoints used

- `GET /api/user` — verify token (ability `user:detail`).
- `POST /api/meta-extraction` — live strategy test / auto-detect
  (ability `meta-extraction:extract`).
- `GET /api/products?per_page=100` — locate the tracked product for this URL
  (needs product access).
- `GET /api/products/{id}?include=insights` — the Insights tab payload: per-store
  `price_cache` plus the materialised insights block (needs product access).
- `POST /api/products` — track a product (needs product access).

## Known limitations (prototype)

- Price-history matching compares the page URL against tracked URLs by
  `host + pathname`; heavily parameterised URLs may not match.
- The element picker generates CSS selectors only (the API also supports XPath /
  Regex / JSON path — type those manually).
- No build step or bundler; plain ES modules / scripts loaded directly.
- Not packaged/signed for the Chrome Web Store.
