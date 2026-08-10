const SETTINGS_KEY = 'pricebuddy.settings';

const apiUrlInput = document.getElementById('apiUrl');
const tokenInput = document.getElementById('token');
const statusEl = document.getElementById('status');

function showStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
}

function readForm() {
  return {
    apiUrl: apiUrlInput.value.trim().replace(/\/+$/, ''),
    token: tokenInput.value.trim(),
  };
}

// The saved URL is later used to build clickable links in the in-page panel, so
// reject anything that isn't a plain http(s) origin before it can be stored.
function apiUrlError(apiUrl) {
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch {
    return 'Enter a full URL, e.g. https://price-buddy.example.com';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'The API URL must start with http:// or https://';
  }
  if (/\/api$/i.test(parsed.pathname)) {
    return 'Drop the trailing /api — enter just the base URL of your instance.';
  }
  return null;
}

async function load() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] || { apiUrl: '', token: '' };
  apiUrlInput.value = settings.apiUrl || '';
  tokenInput.value = settings.token || '';
}

/** The host-permission pattern for a PriceBuddy base URL. */
function originPattern(apiUrl) {
  try {
    return `${new URL(apiUrl).origin}/*`;
  } catch {
    return null;
  }
}

/**
 * Ask for access to the user's instance.
 *
 * The extension ships with no host permissions — the PriceBuddy address is
 * unknown at build time, so it's requested here for that origin alone rather
 * than taking `<all_urls>` up front.
 *
 * Must be the first `await` in a click handler: Chrome requires a user gesture,
 * and awaiting anything else first (including `permissions.contains`) can lose
 * it. Requesting an already-granted permission resolves true without prompting,
 * so there's no need to check first.
 */
async function requestHostPermission(apiUrl) {
  const origins = [originPattern(apiUrl)].filter(Boolean);
  if (!origins.length) {
    return false;
  }
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

function validate(settings) {
  if (!settings.apiUrl || !settings.token) {
    return 'Both an API URL and a token are required.';
  }
  return apiUrlError(settings.apiUrl);
}

async function save() {
  const settings = readForm();
  const invalid = validate(settings);
  if (invalid) {
    showStatus(invalid, 'error');
    return false;
  }

  // Permission first — see requestHostPermission on why nothing may be awaited
  // before it.
  if (!(await requestHostPermission(settings.apiUrl))) {
    showStatus(
      `Access to ${settings.apiUrl} was declined. The extension can't reach your instance without it — press Save to try again.`,
      'error',
    );
    return false;
  }

  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  showStatus('Saved.', 'success');
  return true;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function test() {
  const settings = readForm();
  if (!settings.apiUrl || !settings.token) {
    showStatus('Enter an API URL and token first.', 'error');
    return;
  }
  showStatus('Testing…', 'info');
  const res = await sendMessage({ type: 'pb:test-connection', settings });
  if (res.ok) {
    showStatus(`Connected as ${res.data.name} (${res.data.email}).`, 'success');
  } else {
    showStatus(`Failed: ${res.error}`, 'error');
  }
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('test').addEventListener('click', async () => {
  if (await save()) {
    await test();
  }
});

load();
