# CLAUDE.md

Working notes for AI coding agents in this repository.

## What this is

A Manifest V3 Chrome extension that acts as a companion client for a self-hosted
[PriceBuddy](https://github.com/jez500/pricebuddy) instance. It is a **client
only** — all data lives on the user's own PriceBuddy server, reached over its
HTTP API with a URL + token the user configures.

Currently only `chrome/` exists. The repo name is plural because Firefox is
planned; nothing has been factored for that yet.

## Commands

```bash
cd chrome && npm test          # node --test over test/ — no deps, no build step
node --check src/content/panel.js                  # classic scripts
node --input-type=module --check < src/lib/api.js  # ESM (background.js, lib/api.js)
```

There is **no build step, no bundler, and no dependencies**. Keep it that way
unless there is a strong reason: `package.json` exists only to mark the directory
CommonJS so the tests run under plain node, and Firefox's AMO requires a source
submission from anything with a build step.

To run it: `chrome://extensions` → Developer mode → Load unpacked → pick
`chrome/`.

## Architecture

```
toolbar click ──> background.js (service worker)
                    │  chrome.tabs.sendMessage 'pb:toggle-panel'
                    v
                  panel.js (content script, shadow DOM)
                    │  chrome.runtime.sendMessage 'pb:*'
                    v
                  background.js ──> PriceBuddyClient ──> user's PriceBuddy server
```

**The service worker is the only place that touches the network or the token.**
The panel never holds the credential — `pb:get-settings` returns
`getPublicSettings()`, which is `{apiUrl, configured}` with the token withheld.
Preserve this. The panel is a content script on every site the user visits, so
anything it holds is exposed to that much more surface.

Every API call is a `pb:*` message case in `background.js`'s router. To add an
endpoint: add a method to `PriceBuddyClient`, then a case to the router. Do not
`fetch` from the content script — the service worker has the host permissions and
avoids CORS entirely.

### File roles

| File | Role |
| ---- | ---- |
| `src/background.js` | Service worker. Message router + panel toggle. Holds the token. |
| `src/lib/api.js` | `PriceBuddyClient`. Thin, well-JSDoc'd HTTP wrapper. ESM. |
| `src/content/viewmodels.js` | **Pure** transforms. No `chrome.*`, no DOM. UMD-ish: `module.exports` for tests, `window.PBView` in the page. |
| `src/content/panel.js` | The panel: shadow DOM, three tabs, element picker, 175 lines of CSS in a template literal. Classic script, loaded after viewmodels.js. |
| `src/options/*` | Settings page. Plain script, not a module. |

### The viewmodels / panel split is the load-bearing convention

`viewmodels.js` is pure and is the only tested file. **Put new logic there, not in
`panel.js`.** If you find yourself writing a calculation, a format, or a decision
inside a render function, it belongs in `viewmodels.js` with a test.

`panel.js` is ~1,300 lines and does too much; it is slated for a split (see
`TODO.md`). Don't grow it further without pulling something out.

## Conventions

- **Never `innerHTML` with data.** Use the `el()` helper and `textContent`. The
  only `innerHTML` uses are `= ''` to clear a container; keep it that way.
- **Never hand an unvalidated URL to `window.open` or an `href`.** Use `safeUrl()`
  / `openExternal()` in `panel.js`, `apiUrlError()` in `options.js`.
- **No remote resources.** No CDN scripts, styles, or fonts — it leaks the user's
  browsing to a third party from every page, breaks under strict host CSP, and is
  a Chrome Web Store review risk. Fonts are bundled in `chrome/fonts/`.
- **Don't add permissions casually.** Each one needs a written justification at
  submission time and slows review. `tabs` was deliberately removed —
  `chrome.tabs.sendMessage` needs host access, not that permission.
- **Panel CSS uses theme tokens only** (`var(--teal)`, `var(--text)`, …) defined
  in `THEMES` in `viewmodels.js` and applied to `.pb-panel` by `applyTheme()`.
  Never hardcode a colour in `PANEL_CSS`; add a token to both palettes instead.
- Two-space indent, semicolons, single quotes, trailing commas in multiline
  literals. Braces on every `if`.
- Comments explain *why*, not *what* — the existing ones set the bar; match it.

## Backend API notes

The PriceBuddy API is at `../pricebuddy` when checked out alongside. Gotchas:

- The store **list** transformer returns `scrape_strategy`; some responses use
  `scrape_settings`. `panel.js:detectedField()` currently reads `scrape_settings`
  off the meta-extraction response and this may be dead code — verify against a
  live instance before touching it (see `TODO.md`).
- `POST /api/meta-extraction` accepts an optional `store` body to test a *draft*
  strategy without saving anything. This is what powers "Test all".
- `POST /api/products` with `create_store: true` auto-builds a store from the URL.
- Product endpoints need a broad (`*`) token; meta-extraction only needs
  `user:detail` + `meta-extraction:extract`. The panel surfaces 403s with a
  "token too narrow" hint — preserve that when adding calls.

## Before you claim something works

`npm test` covers `viewmodels.js` only — roughly 14% of the code. Anything you
change in `panel.js`, `background.js`, or `options.js` is **unverified by the test
suite**. Either load the unpacked extension and exercise it, or say plainly that
you have not.

## Publishing

See `PUBLISHING.md`. Note the hard constraints it encodes: manifest `description`
must be ≤132 characters, versions are 1–4 dot-separated integers only, and the
store rejects any upload whose version is not strictly greater than the published
one.
