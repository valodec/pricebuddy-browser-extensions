// Service worker: central place for cross-origin API calls and for toggling the
// in-page helper panel when the toolbar icon is clicked.
//
// Permissions model — deliberately narrow:
//   • `activeTab` grants temporary access to the tab the user clicked the
//     toolbar icon on. That is exactly when the panel is injected, so no
//     install-time host access is needed and there is no content script sitting
//     on every page the user visits.
//   • The user's PriceBuddy origin is unknown at build time, so it lives in
//     `optional_host_permissions` and is requested from the options page once
//     they enter it. Without it the service worker's fetch would be blocked.

import { PriceBuddyClient } from './lib/api.js';

const SETTINGS_KEY = 'pricebuddy.settings';

const PANEL_FILES = ['src/content/viewmodels.js', 'src/content/panel.js'];

/**
 * The host-permission pattern for a PriceBuddy base URL.
 * @param {string} apiUrl
 * @returns {?string}
 */
export function originPattern(apiUrl) {
  try {
    const { protocol, origin } = new URL(apiUrl);
    return protocol === 'http:' || protocol === 'https:' ? `${origin}/*` : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<{apiUrl:string, token:string}>} */
async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return stored[SETTINGS_KEY] || { apiUrl: '', token: '' };
}

/**
 * The public view of the settings — everything the in-page panel legitimately
 * needs, with the token withheld. The panel runs as a content script on every
 * site the user visits; it only ever uses `apiUrl` (to build product links) and
 * `configured` (to decide whether to show the setup prompt), so there is no
 * reason to copy the credential into that context. All authenticated calls are
 * made here in the service worker instead.
 *
 * @returns {Promise<{apiUrl:string, configured:boolean}>}
 */
async function getPublicSettings() {
  const { apiUrl, token } = await getSettings();
  return { apiUrl: apiUrl || '', configured: Boolean(apiUrl && token) };
}

/**
 * A client for the configured instance, but only once we actually hold host
 * permission for it. Without this the fetch fails with an opaque network error;
 * this turns it into something the panel can act on.
 */
async function getClient() {
  const settings = await getSettings();
  const pattern = originPattern(settings.apiUrl);

  if (pattern && !(await chrome.permissions.contains({ origins: [pattern] }))) {
    const err = new Error(
      'PriceBuddy Companion needs permission to reach your instance. Open the extension options and press Save to grant it.',
    );
    err.status = 0;
    err.needsPermission = true;
    throw err;
  }

  return new PriceBuddyClient(settings);
}

// Toolbar icon -> show/hide the panel in the active tab.
//
// There is no registered content script: `activeTab` means the click itself is
// what grants access, so the panel is injected on demand. Try messaging first —
// on a second click the script is already there and re-injecting would be
// wasted work (the panel guards against double-injection either way).
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'pb:toggle-panel' });
    return;
  } catch {
    // Not injected yet — fall through.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: PANEL_FILES });
    await chrome.tabs.sendMessage(tab.id, { type: 'pb:toggle-panel' });
  } catch (err) {
    // Restricted page (chrome://, the Web Store, the PDF viewer, a file:// URL
    // without access). Nothing can run here, so say so on the icon rather than
    // leaving the click looking broken.
    console.warn('PriceBuddy: cannot run on this page.', err);
    await chrome.action.setBadgeText({ tabId: tab.id, text: 'n/a' });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#dc2626' });
    await chrome.action.setTitle({
      tabId: tab.id,
      title: 'PriceBuddy Companion can’t run on this page',
    });
  }
});

// Messages carrying a caller-supplied token are only accepted from extension
// pages (the options page), never from an injected script.
//
// Test on the sender's URL, not on `sender.tab`: the options page uses
// `open_in_tab`, so Chrome populates `sender.tab` for it exactly as it does for
// an injected script. An injected script reports the host page's http(s) URL,
// while an extension page reports chrome-extension://<id>/…, so the origin is
// what actually distinguishes them.
function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id
    && typeof sender.url === 'string'
    && sender.url.startsWith(chrome.runtime.getURL(''));
}

// Message router for the panel + options page.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'pb:get-settings': {
          sendResponse({ ok: true, data: await getPublicSettings() });
          break;
        }
        case 'pb:open-options': {
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        }
        case 'pb:test-connection': {
          if (!isExtensionPage(sender)) {
            sendResponse({ ok: false, error: 'Not permitted from this context.' });
            break;
          }
          const client = new PriceBuddyClient(message.settings);
          const user = await client.getUser();
          sendResponse({ ok: true, data: user });
          break;
        }
        case 'pb:client-config': {
          const client = await getClient();
          const data = await client.getClientConfig();
          sendResponse({ ok: true, data });
          break;
        }
        case 'pb:meta-extraction': {
          const client = await getClient();
          const data = await client.metaExtraction(message.url, message.store, {
            heal: message.heal,
            timeoutMs: message.timeoutMs,
          });
          sendResponse({ ok: true, data });
          break;
        }
        case 'pb:list-products': {
          const client = await getClient();
          const data = await client.listProducts(message.params || {});
          sendResponse({ ok: true, data });
          break;
        }
        case 'pb:get-product': {
          const client = await getClient();
          const data = await client.getProduct(message.id, message.params || {});
          sendResponse({ ok: true, data });
          break;
        }
        case 'pb:create-product': {
          const client = await getClient();
          const data = await client.createProduct(message.payload);
          sendResponse({ ok: true, data });
          break;
        }
        case 'pb:get-store': {
          const client = await getClient();
          const data = await client.getStoreByDomain(message.domain, message.exact);
          sendResponse({ ok: true, data });
          break;
        }
        case 'pb:create-store': {
          const client = await getClient();
          const data = await client.createStore(message.payload);
          sendResponse({ ok: true, data });
          break;
        }
        case 'pb:update-store': {
          const client = await getClient();
          const data = await client.updateStore(message.id, message.payload);
          sendResponse({ ok: true, data });
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message: ${message.type}` });
      }
    } catch (err) {
      sendResponse({
        ok: false,
        error: err.message,
        status: err.status,
        body: err.body,
        needsPermission: !!err.needsPermission,
      });
    }
  })();

  // Keep the message channel open for the async response.
  return true;
});
