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

async function load() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] || { apiUrl: '', token: '' };
  apiUrlInput.value = settings.apiUrl || '';
  tokenInput.value = settings.token || '';
}

async function save() {
  const settings = readForm();
  if (!settings.apiUrl || !settings.token) {
    showStatus('Both an API URL and a token are required.', 'error');
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
