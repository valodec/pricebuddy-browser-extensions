# Privacy Policy — PriceBuddy Companion

**Last updated: 7 August 2026**

PriceBuddy Companion is a client for a PriceBuddy server that **you** run. The
extension has no backend of its own. Nothing is sent to the developer, and there
is no analytics, telemetry, advertising, or tracking of any kind.

## What the extension stores

All of this is stored by your browser, on your device, and is never transmitted
to the developer:

| Data | Where | Why |
| ---- | ----- | --- |
| Your PriceBuddy instance URL | `chrome.storage.sync` | To know which server to talk to |
| Your PriceBuddy API token | `chrome.storage.sync` | To authenticate to that server |
| Light/dark theme preference | `chrome.storage.sync` | To remember your choice |
| Draft scrape strategies, per domain | `chrome.storage.local` | So work in progress survives a page reload |

`chrome.storage.sync` is synchronised by Chrome across the devices where you are
signed in to the same Google profile. This means **your API token is synced by
Chrome to your own Google account**. If you would rather it did not leave this
device, turn off extension sync in Chrome's sync settings.

Uninstalling the extension deletes all of the above.

## What is sent, and where

The extension only ever contacts the PriceBuddy server address you entered in its
settings. It sends:

- **The URL of the page you are viewing** — when you open the panel, press
  *Track this product*, or press *Test all*. Your server uses it to fetch and
  scrape the product page.
- **Your API token** — as an `Authorization: Bearer` header on every request, so
  your server can authenticate you.
- **Draft scrape strategy values** — the CSS/XPath/regex selectors you type or
  pick, when you press *Test all* or *Save to store*.

It does **not** send page content, form data, cookies, passwords, or your
browsing history. It does not read pages you do not open the panel on, beyond the
inert script that waits for you to click the toolbar icon.

The URLs you send to your own PriceBuddy server are then subject to whatever
that server does with them, which is under your control, not the developer's.

## Third parties

None. There are no third-party services, SDKs, or CDNs. Fonts are bundled inside
the extension package specifically so that opening the panel does not generate a
request to Google Fonts from the page you are on.

## Permissions

- **`storage`** — to save the settings and drafts listed above.
- **`scripting`** — to inject the panel into the current tab when you click the
  toolbar icon.
- **Access to all websites (`<all_urls>`)** — needed for two reasons. First, the
  address of your PriceBuddy server is typed in by you at runtime and is unknown
  when the extension is built, so it cannot be requested narrowly in advance.
  Second, the point of the extension is to let you select price/title/image
  elements on arbitrary retailer pages, which requires reading those pages' DOM.
  This access is used only when you open the panel.

## Data retention and deletion

The developer holds no data, so there is nothing to request or delete. To remove
everything the extension stores locally, uninstall it. To revoke its access to
your PriceBuddy server, delete the API token in your PriceBuddy instance under
**API keys**.

## Children

The extension is not directed at children and collects no personal information.

## Changes

Material changes will be noted in this file and in the repository's release
notes. The "last updated" date above always reflects the current version.

## Contact

Open an issue at
<https://github.com/jez500/pricebuddy-browser-extensions/issues>.
