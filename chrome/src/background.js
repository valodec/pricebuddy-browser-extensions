// Service worker: central place for cross-origin API calls (host_permissions
// grant cross-origin fetch here without CORS friction) and for toggling the
// in-page helper panel when the toolbar icon is clicked.

import { PriceBuddyClient } from './lib/api.js';

const SETTINGS_KEY = 'pricebuddy.settings';

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

async function getClient() {
  return new PriceBuddyClient(await getSettings());
}

// Toolbar icon -> tell the active tab's content script to show/hide the panel.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'pb:toggle-panel' });
  } catch {
    // Content script not present (chrome://, web store, PDF viewer, etc.).
    // Inject it on demand, then toggle.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content/viewmodels.js', 'src/content/panel.js'],
      });
      await chrome.tabs.sendMessage(tab.id, { type: 'pb:toggle-panel' });
    } catch (err) {
      console.warn('PriceBuddy: cannot run on this page.', err);
    }
  }
});

// Messages carrying a caller-supplied token are only accepted from extension
// pages (options), never from a content script. `sender.tab` is set for content
// scripts and undefined for extension pages.
function isExtensionPage(sender) {
  return !sender.tab && sender.id === chrome.runtime.id;
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
        case 'pb:meta-extraction': {
          const client = await getClient();
          const data = await client.metaExtraction(message.url, message.store);
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
          const data = await client.getStoreByDomain(message.domain);
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
      sendResponse({ ok: false, error: err.message, status: err.status, body: err.body });
    }
  })();

  // Keep the message channel open for the async response.
  return true;
});
