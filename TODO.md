# TODO

Backlog from the August 2026 audit. Items are ordered within each section by
value-for-effort. File references are `path:line` at time of writing.

---

## Done (audit follow-up, 7 Aug 2026)

- [x] Shorten manifest `description` to 105 chars (was 158; store limit is 132)
- [x] Drop the unused `tabs` permission and `web_accessible_resources`
- [x] Remove the Google Fonts `@import` (first bundled locally, then dropped
      entirely in favour of `system-ui`)
- [x] Stop sending the API token to content scripts (`getPublicSettings`)
- [x] Reject `pb:test-connection` from non-extension contexts
- [x] Scheme-validate every URL before `window.open` / `href` (`safeUrl`)
- [x] Validate the API URL scheme on the options page (`apiUrlError`)
- [x] Add `short_name`, `homepage_url`, `minimum_chrome_version`
- [x] Fix README drift (Usage described buttons that don't exist), broken links, paths
- [x] Add root README, LICENSE (MIT), PRIVACY.md, PUBLISHING.md, CLAUDE.md
- [x] Confirm the GitHub URL against the `origin` remote — `jez500/pricebuddy-browser-extensions`
      was correct; upstream `jez500/pricebuddy` verified live
- [x] Licence decision: **MIT**, kept deliberately rather than inheriting
      upstream's GPL-3.0-with-modifications. The extension is an independent
      client and contains no PriceBuddy code, so it isn't obliged to, and a
      permissive licence suits a client people may fork for other trackers.

---

## P0 — correctness bugs (all done, 7 Aug 2026)

Verified against a clone of `jez500/pricebuddy` rather than guessed at.

- [x] **`dealTiming` inferred tone from prose.** Now uses the backend's
      `dealScore.verdictKey` enum (`great|good|average|pricey|wait` from
      `App\Services\Insights\DealScoreCalculator`), with a negation-aware prose
      fallback for older responses. Also surfaces `dealScore.lowConfidence`,
      which the extension was ignoring, and stops the verdict card claiming
      "Good time to buy here" when the score says `wait`. 6 new tests.
- [x] **Saving in Tune could clobber a working store.** `storeLookupOk` now gates
      `onSaveStore`; a failed lookup blocks the save with an explanation and a
      *Retry lookup* button instead of writing defaults over the real config.
- [x] **Only the first 100 products were searched.** `findTrackedProductId` pages
      through up to 2,000 (the API caps `per_page` at 100 server-side and exposes
      no URL filter — confirmed in `ProductResource/Api/Handlers/PaginationHandler`).
      Past the bound it reports "too many products to search" rather than
      "not tracked", which would have invited a duplicate.
- [x] **The paging request was downloading everything.** Each page carried every
      product's `price_cache`, including a full `{date: price}` history per store
      — all discarded, since the match is only used to get an id for the detail
      request that follows. Now requests `fields[products]=id&include=urls`, with
      a one-shot fallback to the full payload if the instance rejects it.
- [x] **Status messages were wiped by the following re-render.** `#pb-status`
      moved out of `#pb-content` into the panel shell.
- [x] **Caches never invalidated on SPA navigation.** `resetPageCaches()` +
      a 1s poll and `popstate`/`hashchange` listeners, started when the panel
      opens. (Polling because patching `history.pushState` from an isolated world
      only sees the isolated world's copy.)
- [x] **`onTestAll` overwrote the auto-detect cache.** Split into `testResult`;
      also means test results now survive a re-render instead of resetting to
      "not tested".
- [x] **Unhandled async renders.** `renderContent()` now catches and routes
      failures to `setStatus(..., 'error')`.

### Correction to the original audit

**There is no `scrape_settings` bug** — I flagged one and was wrong. The two
spellings are both correct, and the asymmetry is deliberate upstream:

- `GET /api/stores` → Filament `StoreTransformer` → `$model->toArray()` →
  **`scrape_strategy`**. So `prepareStoreForTune` was right.
- `POST /api/meta-extraction` → `MetaExtractionResource` → `Http\Resources\StoreResource`,
  which renames it → **`scrape_settings`**. So `detectedField` was right too.
- Writes (the `store` payload on meta-extraction) expect **`scrape_strategy`**.

`api.js:143`'s comment was accurate. Both call sites now carry a comment
explaining which is which so this doesn't get "fixed" into a real bug later.

## Blocked on upstream: all URL matching moves server-side

Agreed with the PriceBuddy maintainer 7 Aug 2026; their design doc is
*"Move all URL matching server-side"* (status: approved for planning). **The
extension will do no URL normalisation at all** once these land — it sends raw
URLs and the server answers every matching question, so the normalisation rule
can never drift between the two codebases.

All four shipped and **verified against a live instance 7 Aug 2026**
(`price-buddy.lndo.site`), client integration done:

- [x] **`filter[url]` on `GET /api/products`** → `findViaUrlFilter` does it in one
      request. Verified matching across exact / +tracking-params / no-`www` /
      uppercase / trailing-slash; untracked and malformed URLs both return 200
      with empty `data`, not an error.
- [x] **`current_url` on `GET /api/products/{id}`** → `is_current` per
      `price_cache` entry, consumed by `buildInsights`. Verified it works
      **with and without `include=insights`** (they're independent), and that the
      key is absent entirely when the param is omitted.
- [x] **`GET /api/client-config`** → `loadCapabilities()`, cached per-instance in
      `chrome.storage.local`. 24h TTL on success, 1h on failure so re-minting a
      token or upgrading is picked up sooner. 403 and 404 are treated
      identically.
- [x] **`filter[domain]` (exact) on `GET /api/stores`** → `findStoresForDomain()`
      sends `location.host` verbatim. Verified `www.`/case/port variants all
      resolve, and a store whose `domains` JSON is malformed
      (`{"domain":"…","0":"…"}`, as Dan Murphys is) still matches.
- [x] **Sparse fieldsets confirmed live.** `fields[products]=id&include=urls`
      returns exactly `{id, urls:[…]}` — selecting only `id` does not break the
      `urls` eager-load, and `price_cache` is absent from the payload.
- [x] `lookupStores` / `prepareStoreForTune` de-duplicated into
      `findStoresForDomain()` (was a P2 item).

Still open on this thread:

- [x] **Currency/locale exposed and wired.** Verified live: store-level
      `locale_settings` override honoured (`GBP`/`en-GB`), app fallback
      otherwise, survives a sparse fieldset that omits `settings`, and
      `fields[stores]=currency` correctly 400s. `money()` now takes a BCP-47
      locale so an AU price doesn't render German-style in a German browser.
- [x] **schema_org stores can be saved.** Upstream made `value` conditional via
      one shared `ScrapeStrategyValue` rule across create/update/meta-extraction.
      Verified live: create and update with `{"type":"schema_org"}` and no value
      both succeed, and the stored column omits `value` entirely.
- [x] **`stores_filter_domain` capability flag** shipped; the
      `products_filter_url` proxy is gone.
- [x] **Request timeouts, bounded by the server's own budget.** `request()` takes
      an `AbortSignal`; the extraction timeout comes from
      `limits.meta_extraction_timeout_seconds` in `/api/client-config` plus 10s
      headroom, so the two can't drift. The 75s hardcode is gone. A "still
      working" note appears after 6s.
- [x] **AI healing is opt-in.** Upstream defaulted `heal` to false and bounded it
      with `ExtractionBudget`. Verified live: the default path went 120.1s → 0.39s
      and the unmatched-domain first-run case → 0.08s. Auto-detect no longer
      heals implicitly (it would return a *different* strategy than the draft
      under test); a "✦ Try AI detection" button in Tune → Auto-detect opts in,
      shown only when the plain scrape missed a field. `healing.reason` is
      surfaced per-case rather than failing silently.
- [x] **Currency verified on meta-extraction** — the endpoint the Track tab
      actually uses, which was unverifiable while it hung. `currency`/`locale`
      present at top level; Track now renders `$127.49` rather than `127.49`. `GET /api/stores`
      returns id/name/slug/initials/domains/scrape_strategy/settings/notes/cookies
      — no currency — and `POST /api/meta-extraction` doesn't return one either.
      So the Track tab renders a bare `127.49` while Insights (which gets currency
      from `price_cache[]`) renders `$127.49`, in the same panel.
- [ ] **Capabilities can be stale** for up to the TTL. An upgrade only adds
      capabilities, so a stale `false` is safe. A rollback gives a stale `true`,
      so every gated call falls back on a 4xx via `isCapabilityMiss()` — 401/403
      deliberately excluded, since those are real auth problems worth surfacing.
- [ ] **`filter[url]` can return more than one product** (two products sharing a
      normalised URL). `findViaUrlFilter` takes the first and logs. Fine for now;
      revisit if it shows up in practice.
- [ ] The paging fallback (`listProductsPage`, `MAX_PRODUCT_PAGES`,
      `LEAN_LIST_PARAMS`, `leanListSupported`) is now dead code against any
      current instance. **Keep it** until the minimum supported PriceBuddy
      version is decided, then delete ~60 lines.

### The fallback path keeps the old strip-all rule — deliberately

`V.normalizeUrl` stays as-is (host + path, **all** query params dropped) purely
for instances that predate the above. Two things to know before touching it:

- **Don't port the server's denylist rule into it.** The server keeps
  significant params (`?variant=`, `?sku=`), which means affiliate params it
  doesn't denylist would break matching — eBay is tagged with six
  (`mkrid`, `mkcid`, `campid`, `siteid`, `toolid`, `mkevt`). Strip-all drops
  those along with everything else, so the fallback is immune. The server solves
  this by matching on `urls.id` rather than on a normalised string; that option
  isn't available here.
- **Its known weakness is the opposite one:** dropping every param collapses
  `?variant=` / `?sku=` URLs, so on those sites the fallback can match the wrong
  variant. Accepted, not fixed — disambiguating would mean paging every product
  to look for a better match, which isn't worth it in a path that only serves
  pre-upgrade instances.

## P0.5 — exercise it in a browser (prerequisite for most of P1)

Everything below P0 was verified by unit tests and by curling the API directly.
**No part of this has been run as an actual extension.** `npm test` covers
`viewmodels.js` only; `panel.js`, `background.js` and `options.js` are untested
by the suite, and that's where all of today's integration work landed.

- [ ] Load unpacked against `price-buddy.lndo.site` and walk all three tabs.
      Specifically unverified: `loadCapabilities()`'s `chrome.storage.local`
      caching and per-instance key, the font `FontFace` registration (does the
      panel actually render in Manrope, or silently fall back to system?),
      `safeUrl` gating on the outbound store links, the SPA URL watcher, the
      picker, and the blocked-save + *Retry lookup* path.
- [ ] Test the 403 degradation with a **narrow token** (`user:detail` +
      `meta-extraction:extract`, no `client-config:read`). The all-access token
      used so far can't exercise it, and the whole fallback design rests on 403
      and 404 being indistinguishable.

## P1 — publishing

- [x] **`activeTab` + `optional_host_permissions`, no content script.** Ships
      with zero host access; the PriceBuddy origin is requested from the options
      page on save (must be the first `await` in the click handler or Chrome
      drops the user gesture). `getClient()` returns a `needsPermission` error
      if the grant is missing. Restricted pages now set a red `n/a` badge
      instead of only logging to console.
- [x] **CI + publish workflows** (`.github/workflows/`). CI runs tests, syntax
      checks both parse modes, validates the manifest (including that every
      referenced file exists), allowlists permissions, rejects remote resources
      and unsafe `innerHTML`, and asserts `manifest.json` sits at the zip root.
- [x] Privacy policy hosted — <https://pricebuddy.app>. That's the URL for the
      store form.
- [x] **Screenshot** — `assets/screenshot.png` is 1280×800, a valid store size,
      compositing all three tabs. `assets/{track,insights,tune}.png` are the raw
      panel captures it's built from; they're not store sizes and aren't meant
      to be uploaded.
- [ ] Optional: a second and third screenshot so the listing isn't a single
      image. The per-tab captures already exist — each just needs padding onto a
      1280×800 canvas, with the element picker being the obvious fourth since
      it's the feature nothing currently shows.
- [x] **Screencast recorded** — `assets/extension-in-action.webm`, 39s, Amazon
      page → panel → track → Tune → the product inside PriceBuddy. Ending on the
      app is what makes it useful to a reviewer: it shows the round trip they
      can't otherwise verify without a server.
- [x] **Screencast hosted** — <https://www.youtube.com/watch?v=Iv_NELXQ1AE> ("PriceBuddy browser extension"). Verified
      publicly reachable via YouTube's oembed endpoint, so a reviewer can open it
      without being signed in. Reviewer-note wording is in `PUBLISHING.md` §1.
- [ ] Optional: strip the screencast's audio track. It's completely silent
      (RMS 0, peak 0) but still shipped as an Opus stream, so a viewer sees audio
      controls and wonders if they're missing narration.
      `ffmpeg -i extension-in-action.webm -c:v copy -an out.webm` — no re-encode,
      so no quality loss. I left the original alone since it's untracked and
      overwriting it would be unrecoverable.
- [ ] Add a `CHANGELOG.md`.
- [ ] **Re-test the permission flow end to end.** The `activeTab` move is the
      largest behavioural change so far and is unverified in a browser: first
      click on a fresh install, the options-page permission prompt, declining it,
      and the `n/a` badge on a `chrome://` page.
- [ ] Stale host permissions aren't revoked when the API URL changes — the old
      origin stays granted. Harmless but untidy; `chrome.permissions.remove`
      on change would fix it.

## P2 — structure and maintainability

- [ ] **Split `panel.js` (~1,500 lines, now including the inline logo).**
      Suggested: `panel/logo.js`, `panel/selector.js`, `panel/picker.js`,
      `panel/track.js`, `panel/insights.js`, `panel/tune.js`. Classic content
      scripts can't `import`, so list them in order in `content_scripts.js` the
      way `viewmodels.js` already is.
- [ ] **Test the selector generator.** Extract `cssSelector`/`partFor`/
      `suggestValueSelector` to `src/content/selector.js` and test under jsdom.
      This is the feature most likely to regress silently, and it's currently
      untested. Would raise coverage from ~14% meaningfully.
- [ ] **De-duplicate:** `send()` (`panel.js:189`) vs `sendMessage()`
      (`options.js:38`) are identical; `SETTINGS_KEY` is defined twice.
      (The `lookupStores` / `prepareStoreForTune` duplication is already done —
      both now go through `findStoresForDomain()`.)
- [ ] Collapse `background.js`'s nine near-identical router cases into a
      type → client-method table.
- [ ] Add eslint + a `lint` script, wired into CI.
- [ ] Clean up abandoned per-domain drafts in `chrome.storage.local`
      (`panel.js:161`) — currently unbounded, and stale drafts resurface.
- [ ] Move the token from `chrome.storage.sync` to `storage.local`, or state the
      cross-device sync tradeoff on the options page. (Currently documented in
      `PRIVACY.md` only.)

## P3 — UX

- [x] **Scraper service is selectable in Tune** ("Fetched with": HTTP / Browser).
      The panel hardcoded `http`, so a JavaScript-rendered page returned nothing
      and the failure looked like a bad selector rather than the wrong fetch
      method. The choice persists in the draft, seeds from the existing store,
      and is included in the `Test all` draft payload so it can be verified
      before saving. Changing it clears the previous results rather than leaving
      them looking current. Verified live: a draft with `scraper_service: api`
      took 3.05s vs 0.08s for `http` (the browser path's ~2s floor), and the
      setting persisted alongside `ai_self_healing_disabled`.
- [x] **Saving a store deleted data it didn't model.** A PUT replaces
      `scrape_strategy` and `domains` wholesale (JSON casts, no server-side
      merge), and `buildStorePayload` rebuilt both from scratch. So saving from
      Tune dropped any `prepend`/`append` on a strategy (BWS uses them to
      reconstruct image URLs) and collapsed a multi-domain store down to the one
      host being viewed. Both are now preserved via `currentStrategyExtras` /
      `currentStoreDomains`. `settings` was already echoed verbatim, which
      upstream confirmed is correct — stripping it would drop
      `ai_self_healing_disabled` and re-enable healing on stores that opted out.
- [x] **Track offered "Track this product" on an already-tracked page**, next to
      a note saying it was already tracked. Acting on it created a duplicate.
      Insights is now the primary action; tracking again is secondary and
      labelled as such.
- [x] **Store name was defaulted from `document.title`** — on a product page that
      named the store after the product ("Save to Logitech MX Master 3S"), and a
      store name is permanent and shared by every product on the domain. Now
      derived from the domain (`V.storeNameFromHost`) and **editable** in Tune,
      which it previously wasn't at all.
- [x] **All-stores min/avg/max hidden when there's only one store** — it repeated
      the "you're here" figures verbatim.
- [ ] **The picker hides its own instructions.** `startPicking` (`panel.js:227`)
      sets a status message then hides the whole panel, so the user gets a
      crosshair and no visible hint or cancel affordance; Esc works but is
      undiscoverable. Show a slim fixed picking banner instead.
- [ ] **Clicking the icon on an unsupported page does nothing visible** —
      `background.js` only logs to console. Use `chrome.action.setBadgeText`.
- [ ] Cache the panel-open API fetch per URL for the session.
- [ ] Add un-track, notify-price, and store-delete actions — the panel can create
      and update but never undo.
- [ ] Make the panel draggable and remember its position; at 400px fixed
      top-right it collides with site carts and chat widgets.
- [ ] Add a `commands` keyboard shortcut to toggle the panel.
- [ ] Handle iframes and page shadow roots in the picker, or detect and say so.

## P4 — UI and accessibility

- [x] **Palette rebuilt from the PriceBuddy Filament theme** — primary
      `Color::Teal`, Tailwind gray neutrals, `gray-950` page / `gray-900` cards
      in dark. Light mode uses teal-700 rather than the brand teal-400, which is
      only ~2.2:1 on white.
- [x] **Contrast now meets WCAG AA in both themes**, enforced by a test over
      every text token (`--faint` dark went 4.2:1 → 6.4:1). The test also asserts
      both palettes define the same token set.
- [x] **Options page reconciled with the panel** — same tokens, real logo,
      `system-ui`, and `color-scheme: light dark` so it follows the OS instead of
      forcing dark.
- [x] **System font stack.** Manrope/DM Mono removed entirely (~55 KB and the
      whole `web_accessible_resources` + `FontFace` path went with them).
- [x] **Real PriceBuddy wordmark** replaces the CSS-drawn placeholder.
- [ ] Tab bar needs `role="tablist"`/`role="tab"`/`aria-selected` and arrow-key
      navigation.
- [ ] `.pb-input` sets `outline: none` with no `:focus-visible` replacement — a
      WCAG 2.4.7 failure; keyboard users lose focus entirely. (The options page
      is already fixed; the panel is not.)
- [x] **Status messages no longer go stale, and are visible.** Two bugs in one:
      `withProgressNote` cleared its *timer* but not a note it had already shown,
      so "Still reading this page…" survived a successful scrape indefinitely. It
      now retracts the note on completion, guarded by a `statusSeq` so a result
      or error set in the meantime isn't clobbered. Info/success also expire on
      their own (9s/6s); errors persist, since they're the ones needing action.
      Visually it's now a bordered, tinted banner on the same 16px gutters as the
      cards, with a per-tone icon, instead of unframed coloured text.
- [x] **Toolbar icon rebuilt from the brand symbol** — transparent background
      (was a white rounded plate), symbol sized edge to edge. The `$` and hook
      gap are real cutouts, so it reads on light and dark browser chrome.
      Regeneration steps in `chrome/images/README.md`.
- [ ] Replace text glyphs (`✓ ⌾ ◎ ☀ ☾ ↘ ⌕`) with inline SVG — they render
      inconsistently across platforms and some become emoji on Windows.
- [ ] `sparklinePath` with all-equal values pins the line to the bottom of the
      viewbox (`viewmodels.js:63`); centre it instead.

## P5 — other browsers

- [ ] Firefox: needs `browser_specific_settings` and an MV3
      `background.scripts`/event-page shim. Keep the codebase build-step-free —
      AMO requires source submission otherwise.
- [ ] Edge: accepts the Chrome zip nearly verbatim; add a job to `publish.yml`.
- [ ] Factor a shared `src/` with per-browser manifests **before** the second
      copy exists, not after.
