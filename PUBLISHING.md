# Publishing PriceBuddy Companion to the Chrome Web Store

This document covers everything from a first manual submission through to a fully
automated GitHub Actions release pipeline.

- [1. Submission readiness](#1-submission-readiness)
- [2. One-time account setup](#2-one-time-account-setup)
- [3. Store listing assets](#3-store-listing-assets)
- [4. Privacy & permission justifications](#4-privacy--permission-justifications)
- [5. Packaging the zip](#5-packaging-the-zip)
- [6. First (manual) submission](#6-first-manual-submission)
- [7. Automating with the Chrome Web Store API](#7-automating-with-the-chrome-web-store-api)
- [8. GitHub Actions workflow](#8-github-actions-workflow)
- [9. Release process](#9-release-process)
- [10. Review timelines and common rejections](#10-review-timelines-and-common-rejections)
- [Appendix: publishing to Firefox and Edge](#appendix-publishing-to-firefox-and-edge)

---

## 1. Submission readiness

### Already done

These were blockers in the original audit and are all resolved. `.github/workflows/ci.yml`
now enforces the first four, so they cannot silently come back:

| # | Was | Now |
| - | --- | --- |
| 1 | `description` was 158 chars (store limit is 132) | 105 chars, CI-validated |
| 2 | Google Fonts `@import` in the injected CSS | System font stack; no bundled or remote fonts. CI greps for remote resources |
| 3 | `<all_urls>` host permission + content script on every page | `activeTab` + `optional_host_permissions`, requested per-origin at runtime |
| 4 | Unused `tabs` permission and `web_accessible_resources` | Both removed; CI allowlists permissions |
| 5 | No privacy policy | [`PRIVACY.md`](PRIVACY.md), published at <https://pricebuddy.app> |
| 6 | No licence | MIT, [`LICENSE`](LICENSE) |

`minimum_chrome_version`, `short_name` and `homepage_url` are all set.

### Ready to submit

Nothing outstanding blocks submission. `assets/screenshot.png` is 1280×800 and
valid on its own; adding a second and third would make a stronger listing (up to
5 are allowed).

The two URLs the form asks for:

- **Privacy policy URL** — <https://pricebuddy.app>
- **Promotional video** — <https://www.youtube.com/watch?v=Iv_NELXQ1AE>

Paste the video into **Notes for reviewer** as well as the video field. A reviewer
with no PriceBuddy server otherwise sees only "Open settings", and the video is
what shows them the round trip. Suggested note:

> This extension is a client for PriceBuddy, a self-hosted price tracker
> (<https://pricebuddy.app>), so it needs the reviewer's own server to do
> anything. This 39-second video shows the full flow against a real instance —
> tracking a product from an Amazon page through to it appearing in PriceBuddy:
> https://www.youtube.com/watch?v=Iv_NELXQ1AE
> Happy to provide credentials to a live demo instance on request.

---

## 2. One-time account setup

1. **Register a developer account** — <https://chrome.google.com/webstore/devconsole>.
   One-time **US$5** fee, paid by card. Use an account you control long-term; the
   listing cannot be transferred without a Google Group publisher.
2. **Recommended: publish as a group.** Create a Google Group, add it as a
   publisher in the Developer Dashboard, and publish the item under the group.
   This means the listing survives losing access to a single personal account.
3. **Verify a contact email** in Account settings. Unverified accounts cannot
   publish.

---

## 3. Store listing assets

Prepare these before you open the submission form — the form will not let you
save a draft without most of them.

| Asset | Spec | Notes |
| ----- | ---- | ----- |
| Store icon | 128×128 PNG | You already ship `chrome/icons/icon128.png`. Keep ~16px of padding inside the canvas. |
| Screenshots | 1280×800 (or 640×400) PNG/JPEG, **1–5 required** | Capture the Track, Insights and Tune tabs against a real product page. Do **not** include a browser chrome mockup with a fake URL bar — reviewers flag misleading imagery. |
| Small promo tile | 440×280 PNG | Optional, but required to be eligible for any store featuring. |
| Marquee promo tile | 1400×560 PNG | Optional. |
| Promotional video | **YouTube URL only** — the field does not accept an upload | <https://www.youtube.com/watch?v=Iv_NELXQ1AE> |
| Detailed description | Plain text, up to 16,000 chars | Reuse the "What it does" section of the root `README.md`. State clearly in the **first paragraph** that the extension requires a self-hosted PriceBuddy instance — this pre-empts the most common user complaint and reviewer confusion. |
| Category | *Shopping* | |
| Language | English | |

**Single-purpose statement.** The store enforces a single-purpose policy. Yours is
defensible; phrase it as one purpose, not three features:

> Single purpose: act as a companion client for the user's own self-hosted
> PriceBuddy price-tracking instance — configuring how PriceBuddy scrapes a store
> and viewing the price data PriceBuddy has already collected for the page being
> viewed.

---

## 4. Privacy & permission justifications

The Privacy tab requires a justification per permission. These are the ones to
paste, worded the way reviewers expect (what it does + why nothing narrower works):

- **`storage`** — "Stores the user's own PriceBuddy instance URL and API token,
  their light/dark preference, and per-site draft scraper configurations. No data
  leaves the user's browser except to the PriceBuddy server they configured."
- **`scripting`** — "Injects the helper panel into the active tab when the user
  clicks the toolbar icon."
- **`activeTab`** — "Grants access to the current tab only, and only when the user
  clicks the extension's toolbar icon. The panel needs to read that page's DOM so
  the user can visually select the price/title/image elements to scrape. No page
  content is transmitted anywhere other than the user's own PriceBuddy server."
- **`optional_host_permissions: <all_urls>`** — "The extension talks to a
  PriceBuddy server whose address is entered by the user at runtime and is
  therefore unknown at build time. Nothing is requested at install. When the user
  saves their instance URL in the options page, permission is requested for **that
  single origin**. `<all_urls>` is declared only because the address cannot be
  known in advance; it is never requested wholesale."

That last one is the important framing for a reviewer: the extension ships with
**zero** host access and asks for one origin, chosen by the user, on an explicit
action.

**Data-use disclosures.** Tick *Authentication information* (the API token) and
*Web history* (the page URL is sent to the user's PriceBuddy server for
extraction). Then tick all three certification checkboxes. Under-disclosing here
is the single most common cause of a takedown after approval.

### The permission surface (already reduced)

The manifest ships no `host_permissions` and no `content_scripts`:

```jsonc
{
  "permissions": ["storage", "scripting", "activeTab"],
  "optional_host_permissions": ["<all_urls>"]
}
```

`activeTab` grants temporary access to the tab the user clicked the icon on,
which is exactly the extension's trigger — `background.js` injects the panel with
`chrome.scripting.executeScript` at that point. The PriceBuddy origin is
requested from the options page with
`chrome.permissions.request({ origins: [apiUrl + '/*'] })`, which must be the
first `await` in the click handler or Chrome drops the user gesture.

`ci.yml` fails the build if `host_permissions` becomes non-empty or an
unexpected permission appears, so this can't regress without a deliberate edit to
the allowlist — and to these justifications.

---

## 5. Packaging the zip

The store wants a zip whose **root** contains `manifest.json` — not a folder
containing it.

```bash
cd chrome
zip -r ../pricebuddy-companion-0.1.0.zip . \
  -x 'test/*' 'package.json' 'images/*' '*.DS_Store' '*/.*'
```

Verify before uploading:

```bash
unzip -l ../pricebuddy-companion-0.1.0.zip | head
# manifest.json must appear at the top level, with no leading directory
```

Excluding `test/`, `package.json` and `images/` keeps the package to only what
the browser loads. `images/` is build-time source: the wordmark is **inlined** in
both `panel.js` and `options.html` (CSS custom properties don't cascade into an
SVG loaded via `<img src>`, so it has to be), and `icon-symbol.svg` only exists
to regenerate the toolbar PNGs. Nothing in the extension fetches either at
runtime — the manifest declares no `web_accessible_resources` at all. Chrome ignores them either way, but a smaller package reviews faster and
avoids questions about unused files.

---

## 6. First (manual) submission

The **first** upload must be done by hand — the API can only update an item that
already exists.

1. Developer Dashboard → **Add new item** → upload the zip.
2. Fill in the **Store listing**, **Privacy**, and **Distribution** tabs.
3. Under Distribution, choose visibility:
   - **Unlisted** — installable by link only. Ideal for a self-hosted tool like
     this: you skip the "who is this for?" review friction and can hand the link
     to PriceBuddy users. Still fully reviewed, but historically faster.
   - **Public** — appears in search. Choose this only once §1 and §4 are done.
4. **Submit for review.**
5. Once approved, copy the **item ID** from the dashboard URL
   (`.../devconsole/.../<ITEM_ID>`) — you need it for automation.

---

## 7. Automating with the Chrome Web Store API

Yes — the store has a REST API, and GitHub Actions can drive it end to end. The
authentication setup is a one-time slog; budget 20 minutes.

### 7a. Enable the API

1. Open <https://console.cloud.google.com/> and create a project, e.g.
   `pricebuddy-extension-release`.
2. **APIs & Services → Library** → enable **Chrome Web Store API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in app name and support email.
   - Add the scope `https://www.googleapis.com/auth/chromewebstore`.
   - Add your own Google account under **Test users**.
   - Leave the app in **Testing** — you do not need to publish the consent screen.

> ⚠️ A consent screen left in *Testing* issues refresh tokens that expire after
> **7 days**. To get a non-expiring refresh token you must move the consent
> screen to **In production** (Publish app). Since the only scope is a
> non-sensitive first-party one, this does not trigger a Google verification
> review. Do this, or your workflow will start failing a week after you set it up.

### 7b. Create OAuth credentials

**APIs & Services → Credentials → Create credentials → OAuth client ID**

- Application type: **Desktop app**
- Name: `cws-uploader`

Save the **Client ID** and **Client secret**.

### 7c. Mint a refresh token

Visit this URL in a browser (substituting your client ID), approve the consent
screen, and copy the `code` parameter from the resulting redirect:

```
https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=<CLIENT_ID>&redirect_uri=urn:ietf:wg:oauth:2.0:oob
```

> If Google rejects `urn:ietf:wg:oauth:2.0:oob` (it is deprecated for some newer
> projects), set the redirect URI to `http://localhost:8080` instead, register
> that URI on the OAuth client, and grab the `code` query parameter from the
> `localhost` URL your browser lands on.

Exchange the code for a refresh token:

```bash
curl -s "https://accounts.google.com/o/oauth2/token" \
  -d "client_id=<CLIENT_ID>" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "code=<CODE>" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
```

The response contains `refresh_token`. **This is a long-lived credential with
publish rights over your extension — treat it like a password.**

### 7d. Store the secrets

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository
secret**:

| Secret | Value |
| ------ | ----- |
| `CWS_EXTENSION_ID` | The item ID from §6.5 |
| `CWS_CLIENT_ID` | From §7b |
| `CWS_CLIENT_SECRET` | From §7b |
| `CWS_REFRESH_TOKEN` | From §7c |

Consider putting these in a GitHub **Environment** named `chrome-web-store` with
a required reviewer, so a publish cannot happen without a human approving it.

---

## 8. GitHub Actions workflow

Two workflows: one that validates every push, and one that publishes on a tag.

### 8a. CI — `.github/workflows/ci.yml`

**Already committed.** Runs on every push and PR:

- `npm test` (the view-model suite)
- syntax-checks every source file, in the right parse mode (classic vs ESM)
- validates the manifest: `manifest_version`, name ≤45, **description ≤132**,
  version format, and that every file the manifest references actually exists
- allowlists `permissions` and fails if `host_permissions` becomes non-empty —
  adding one is then a deliberate edit to both the workflow and §4's
  justifications
- fails on remote resources (CDN fonts/scripts) and on `innerHTML` assigned
  anything other than `''`
- builds the zip and asserts `manifest.json` is at its root

The manifest and remote-resource checks exist because both of those shipped as
real defects in the first version of this extension.

### 8b. Publish — `.github/workflows/publish.yml`

```yaml
name: Publish to Chrome Web Store

on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:
    inputs:
      publish:
        description: 'Publish after upload (false = upload as draft only)'
        type: boolean
        default: false

permissions:
  contents: write

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: chrome-web-store
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Unit tests
        working-directory: chrome
        run: npm test

      - name: Check tag matches manifest version
        if: startsWith(github.ref, 'refs/tags/')
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          MANIFEST=$(node -p "require('./chrome/manifest.json').version")
          if [ "$TAG" != "$MANIFEST" ]; then
            echo "::error::Tag v$TAG does not match manifest version $MANIFEST"
            exit 1
          fi
          echo "VERSION=$TAG" >> "$GITHUB_ENV"

      - name: Build package
        run: |
          cd chrome
          zip -r "../pricebuddy-companion-${VERSION:-dev}.zip" . \
            -x 'test/*' 'package.json' '*.DS_Store' '*/.*'
          cd ..
          unzip -l "pricebuddy-companion-${VERSION:-dev}.zip"

      - uses: actions/upload-artifact@v4
        with:
          name: extension-zip
          path: pricebuddy-companion-*.zip

      - name: Upload to Chrome Web Store
        run: |
          npx --yes chrome-webstore-upload-cli@3 upload \
            --source "pricebuddy-companion-${VERSION:-dev}.zip" \
            --extension-id "$EXTENSION_ID" \
            --client-id "$CLIENT_ID" \
            --client-secret "$CLIENT_SECRET" \
            --refresh-token "$REFRESH_TOKEN"
        env:
          EXTENSION_ID: ${{ secrets.CWS_EXTENSION_ID }}
          CLIENT_ID: ${{ secrets.CWS_CLIENT_ID }}
          CLIENT_SECRET: ${{ secrets.CWS_CLIENT_SECRET }}
          REFRESH_TOKEN: ${{ secrets.CWS_REFRESH_TOKEN }}

      - name: Submit for review
        if: startsWith(github.ref, 'refs/tags/') || inputs.publish
        run: |
          npx --yes chrome-webstore-upload-cli@3 publish \
            --extension-id "$EXTENSION_ID" \
            --client-id "$CLIENT_ID" \
            --client-secret "$CLIENT_SECRET" \
            --refresh-token "$REFRESH_TOKEN"
        env:
          EXTENSION_ID: ${{ secrets.CWS_EXTENSION_ID }}
          CLIENT_ID: ${{ secrets.CWS_CLIENT_ID }}
          CLIENT_SECRET: ${{ secrets.CWS_CLIENT_SECRET }}
          REFRESH_TOKEN: ${{ secrets.CWS_REFRESH_TOKEN }}

      - name: GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          files: pricebuddy-companion-*.zip
          generate_release_notes: true
```

Notes on the design:

- **Upload and publish are separate steps.** `upload` replaces the draft without
  submitting it; `publish` is what starts the review. `workflow_dispatch` with
  `publish: false` lets you push a draft and eyeball it in the dashboard first.
- **`environment: chrome-web-store`** gates the job behind whatever protection
  rules you configure — use a required reviewer so nothing ships unattended.
- **The tag/manifest version check** prevents the most common release mistake:
  tagging `v0.2.0` while `manifest.json` still says `0.1.0`. The store rejects any
  upload whose version is not strictly greater than the published one, and the
  error message is unhelpful.
- **Publishing does not go live immediately.** `publish` submits for review;
  approval takes anywhere from an hour to several days. Add
  `--target trustedTesters` to the publish command to release to your tester group
  instead of the public channel.

---

## 9. Release process

```bash
# 1. Bump the version in chrome/manifest.json (e.g. 0.1.0 -> 0.2.0)
# 2. Update CHANGELOG.md
git commit -am "chore: release v0.2.0"
git tag v0.2.0
git push origin master --tags
# 3. Approve the deployment in the Actions tab if you configured a reviewer
```

Chrome extension versions must be **1–4 dot-separated integers**, each 0–65535.
`0.2.0` is valid; `0.2.0-beta` is not. If you want prerelease semantics, use the
store's *trusted testers* channel rather than a version suffix.

Rollout is staged by default for updates. If you push a bad release, use
**Cancel rollout** in the dashboard, then upload a fixed higher version — you
cannot roll back to a previous version number.

---

## 10. Review timelines and common rejections

Typical review is a few hours to three days; broad host permissions push you
toward the slow end, occasionally two-plus weeks.

Rejections you are specifically exposed to:

| Rejection | Why it applies here | Fix |
| --------- | ------------------- | --- |
| *Requesting but not using permissions* | `tabs` and `web_accessible_resources` are declared but unused | Remove them (§1.4) |
| *Broad host permissions not justified* | `<all_urls>` at install time | Move to `activeTab` + `optional_host_permissions` (§4) |
| *Remotely hosted code* | The Google Fonts `@import` in the injected CSS | Bundle the fonts (§1.2) |
| *Inadequate privacy disclosure* | Token = authentication info; page URL = web history | Disclose both (§4) |
| *Functionality not demonstrable* | A reviewer with no PriceBuddy server sees only "Open settings" | Say so in the first line of the description, and put a demo server URL + read-only token in the **Notes for reviewer** field |

That last one is the most likely rejection in practice. The reviewer must be able
to see the extension work.

**This is covered.** <https://www.youtube.com/watch?v=Iv_NELXQ1AE> — 39s, no narration needed, ending on the tracked
product inside PriceBuddy so the round trip is visible. Paste it into **Notes for
reviewer** (wording in §1) as well as the video field in §3.

Offering a demo instance with a throwaway token alongside it is still worth doing
if you're willing to run one, since it lets a reviewer click through themselves
rather than take the video's word for it.

---

## Appendix: publishing to Firefox and Edge

The repo is named `browser-extensions` (plural), so this is presumably coming.

- **Firefox (AMO)** — free account, `web-ext sign` CLI, credentials as
  `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET`. Requires MV3 `background.scripts` (or a
  `browser_specific_settings` block) since Firefox does not support MV3
  service workers identically. Firefox also **requires source-code submission**
  if you add a build step — a reason to keep this extension bundler-free.
- **Edge Add-ons** — free, accepts the same Chrome zip almost verbatim. Has its
  own REST API (`microsoft/edge-addons-action` on the marketplace wraps it).

Both can be added as extra jobs in `publish.yml` gated on the same tag, once the
codebase is restructured with a shared `src/` and per-browser manifests.
