# TODO

Backlog from the August 2026 audit. Items are ordered within each section by
value-for-effort. File references are `path:line` at time of writing.

---

## Done (audit follow-up, 7 Aug 2026)

- [x] Shorten manifest `description` to 105 chars (was 158; store limit is 132)
- [x] Drop the unused `tabs` permission and the icons `web_accessible_resources`
- [x] Bundle Manrope + DM Mono locally; remove the Google Fonts `@import`
- [x] Stop sending the API token to content scripts (`getPublicSettings`)
- [x] Reject `pb:test-connection` from non-extension contexts
- [x] Scheme-validate every URL before `window.open` / `href` (`safeUrl`)
- [x] Validate the API URL scheme on the options page (`apiUrlError`)
- [x] Add `short_name`, `homepage_url`, `minimum_chrome_version`
- [x] Fix README drift (Usage described buttons that don't exist), broken links, paths
- [x] Add root README, LICENSE (MIT), PRIVACY.md, PUBLISHING.md, CLAUDE.md

---

## P0 — correctness bugs users will hit

- [ ] **`dealTiming` misreads negated verdicts.** `viewmodels.js:169` substring-
      matches `/good|buy|low|great|decent/i` against free text, so *"Not a good
      time to buy"* renders as a positive signal. Map exact known verdict strings,
      or have the backend return a tone enum. Add a test with a negated verdict.
- [ ] **Saving in Tune can clobber a working store.** `buildStorePayload`
      (`panel.js:205`) always emits all three fields, so if `prepareStoreForTune`
      didn't complete (store lookup 403'd or the user reached Tune first), an
      untouched field is written back as `schema_org`. Gate save on a successful
      store load, and only send changed fields. Destructive and un-undoable.
- [ ] **Only the first 100 products are searched.** `loadInsights`
      (`panel.js:401`) uses `per_page: 100` with no pagination, so product #101+
      reports as untracked and re-tracking creates a duplicate. Best fix is a
      server-side `filter[url]` lookup, which also removes the biggest
      per-panel-open cost.
- [ ] **Verify or delete the `scrape_settings` read.** `panel.js:810` reads
      `detected.store.scrape_settings`, but everything else uses
      `scrape_strategy` and `api.js:143` says the transformer returns the latter.
      If it's dead, the Auto-detect confidence indicator is reporting the local
      draft rather than what the server actually used — i.e. lying.
- [ ] **Status messages are wiped by the re-render that follows them.**
      `renderContent()` (`panel.js:458`) clears the container and rebuilds
      `#pb-status`, so e.g. `onTrack`'s success message dies when it calls
      `setTab('insights')`. Move the status element outside `#pb-content`.
- [ ] **Caches never invalidate on SPA navigation.** `loaded`, `detected` and
      `insightsVM` are set once, so on Amazon/eBay-style client-side nav the panel
      shows the previous product. Listen for `pushState`/`popstate` and reset.
- [ ] **`onTestAll` overwrites the auto-detect cache.** `panel.js:948` assigns
      manual results to `detected`, which Auto-detect then presents as its own.
      Use separate variables.
- [ ] **Unhandled async renders.** `renderContent()` calls `renderTrack(box)` etc.
      without awaiting; a rejection is an unhandled promise with no user-visible
      error. Add a `.catch` that routes to `setStatus(..., 'error')`.

## P1 — publishing blockers and review risk

- [ ] Move to `activeTab` + `optional_host_permissions` and drop the always-on
      content script (`PUBLISHING.md` §4). Biggest single improvement to review
      odds; `background.js` already has the `executeScript` path.
- [ ] Host `PRIVACY.md` at a public URL (GitHub Pages) — the store form needs a
      URL, not a repo file.
- [ ] Capture 1280×800 screenshots of the Track / Insights / Tune tabs.
- [ ] Stand up a demo PriceBuddy instance + throwaway token for the reviewer
      notes, or record a screencast. A reviewer with no server sees only
      "Open settings" — the most likely rejection reason.
- [ ] Confirm the real GitHub URL. `homepage_url`, the README links and
      `PRIVACY.md` currently assume `github.com/jez500/pricebuddy-browser-extensions`;
      there is no git remote configured to check against.
- [ ] Add `.github/workflows/ci.yml` and `publish.yml` from `PUBLISHING.md` §8.
- [ ] Add a `CHANGELOG.md`.

## P2 — structure and maintainability

- [ ] **Split `panel.js` (~1,300 lines).** Suggested: `panel/styles.css` (loaded
      via `chrome.runtime.getURL`), `panel/selector.js`, `panel/picker.js`,
      `panel/track.js`, `panel/insights.js`, `panel/tune.js`. Classic content
      scripts can't `import`, so list them in order in `content_scripts.js` the
      way `viewmodels.js` already is.
- [ ] **Test the selector generator.** Extract `cssSelector`/`partFor`/
      `suggestValueSelector` to `src/content/selector.js` and test under jsdom.
      This is the feature most likely to regress silently, and it's currently
      untested. Would raise coverage from ~14% meaningfully.
- [ ] **De-duplicate:** `send()` (`panel.js:189`) vs `sendMessage()`
      (`options.js:38`) are identical; `SETTINGS_KEY` is defined twice; store
      lookup+filter is duplicated in `lookupStores` and `prepareStoreForTune`.
- [ ] Collapse `background.js`'s nine near-identical router cases into a
      type → client-method table.
- [ ] Add eslint + a `lint` script, wired into CI.
- [ ] Clean up abandoned per-domain drafts in `chrome.storage.local`
      (`panel.js:161`) — currently unbounded, and stale drafts resurface.
- [ ] Move the token from `chrome.storage.sync` to `storage.local`, or state the
      cross-device sync tradeoff on the options page. (Currently documented in
      `PRIVACY.md` only.)

## P3 — UX

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

- [ ] Tab bar needs `role="tablist"`/`role="tab"`/`aria-selected` and arrow-key
      navigation.
- [ ] `.pb-input` sets `outline: none` (`panel.js:1282`) with no `:focus-visible`
      replacement — a WCAG 2.4.7 failure; keyboard users lose focus entirely.
- [ ] Contrast: `--faint` (`#6e7681`) on `--bg` (`#0d1117`) is ~4.2:1, used at
      9–10.5px in `.pb-here-label`, `.pb-chip-label`, `.pb-allstat-label`. Below
      AA at that size — lighten the token or raise the sizes.
- [ ] **Reconcile the options page with the panel's design language.** Options
      uses a slate palette (`#0f172a`/`#14b8a6`), the panel uses GitHub-dark +
      teal (`#0d1117`/`#2fe0c8`), and options force `color-scheme: dark`
      regardless of the theme preference the panel respects. It's the first
      screen a new user sees. Ideally share the `THEMES` tokens.
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
