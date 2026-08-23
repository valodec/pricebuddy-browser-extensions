# Privacy Policy — PriceBuddy Companion

**Last updated: 24 August 2026**

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
| Which features your instance supports | `chrome.storage.local` | A short-lived cache of your server's own capability flags, so the panel doesn't re-ask on every open |

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
browsing history. The page's HTML is read on your device, so you can point at the
elements you want scraped; it is never transmitted. Nothing runs on a page at all
until you click the toolbar icon on that page.

The URLs you send to your own PriceBuddy server are then subject to whatever
that server does with them, which is under your control, not the developer's.

## Third parties

None. There are no third-party services, SDKs, or CDNs, and no remotely hosted
code — every script and style the extension runs ships inside its own package.
The UI uses your system font stack rather than a web font, specifically so that
opening the panel does not generate a request to Google Fonts from the page you
are on.

## Permissions

The extension ships with **no access to any website**.

- **`activeTab`** — temporary access to the one tab you are on, granted by your
  click on the toolbar icon and only for that visit. This is what lets the panel
  read the page so you can point at the price/title/image elements to scrape.
- **`scripting`** — injects the panel into that tab at that moment. There is no
  content script, so the extension is not present on pages you never open it on.
- **`storage`** — to save the settings and drafts listed above.
- **Access to all websites (`<all_urls>`)** — declared as *optional* and **never
  requested wholesale**. Your PriceBuddy server's address is typed in by you at
  runtime and is unknown when the extension is built, so it cannot be listed
  narrowly in advance. When you save that address on the options page, the
  extension asks for permission to that **one origin** — nothing else.

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

PriceBuddy: <https://pricebuddy.app>

Open an issue at
<https://github.com/jez500/pricebuddy-browser-extensions/issues>.
