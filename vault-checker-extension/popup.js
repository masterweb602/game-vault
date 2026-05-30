/* popup.js — load the Game Vault export into storage.local, toggle detection
 * on/off, set the fuzzy threshold, and clear the stored list. */
(function () {
  'use strict';

  // Storage MUST NOT depend on the webextension-polyfill — `window.browser` is
  // never set if the polyfill throws on load, which is the real cause of the
  // "storage unavailable" error. Use chrome.storage.local directly: it exists
  // natively on BOTH Chromium MV3 and Firefox MV3. Fall back to
  // browser.storage.local only if `chrome` is entirely absent.
  const S = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local
          : (typeof browser !== 'undefined' && browser.storage) ? browser.storage.local
          : null;
  // Independent runtime ref, used only for lastError reporting.
  const RT = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime
           : (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime
           : null;
  const STORAGE_NS = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage
                   : (typeof browser !== 'undefined' && browser.storage) ? browser.storage
                   : null;

  const TABS = (typeof chrome !== 'undefined' && chrome.tabs) ? chrome.tabs
             : (typeof browser !== 'undefined' && browser.tabs) ? browser.tabs : null;

  const VM = window.VaultMatch;
  const KEY_DATA = 'vaultData';
  const KEY_ENABLED = 'enabled';
  const KEY_AUTOSCAN = 'autoScan';
  const KEY_RESULTS = 'scanResults';

  const $ = (id) => document.getElementById(id);
  const enabledToggle = $('enabled-toggle');
  const toggleState = $('toggle-state');
  const autoscanToggle = $('autoscan-toggle');
  const autoscanState = $('autoscan-state');
  const viewResultsBtn = $('view-results');
  const resultsCount = $('results-count');
  const jsonInput = $('json-input');
  const fileInput = $('file-input');
  const loadBtn = $('load-btn');
  const clearBtn = $('clear-btn');
  const thresholdInput = $('threshold-input');
  const statusEl = $('status');

  const hasStorage = !!S;

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  // Promise wrappers around chrome.storage.local. MV3 chrome.storage returns a
  // promise when called without a callback; we pass a callback AND handle the
  // returned promise so this works whether the API is callback- or promise-based.
  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        const r = S.get(keys, (res) => {
          const err = RT && RT.lastError;
          if (err) reject(new Error(err.message)); else resolve(res);
        });
        if (r && typeof r.then === 'function') r.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }
  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      try {
        const r = S.set(obj, () => {
          const err = RT && RT.lastError;
          if (err) reject(new Error(err.message)); else resolve();
        });
        if (r && typeof r.then === 'function') r.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }
  function storageRemove(key) {
    return new Promise((resolve, reject) => {
      try {
        const r = S.remove(key, () => {
          const err = RT && RT.lastError;
          if (err) reject(new Error(err.message)); else resolve();
        });
        if (r && typeof r.then === 'function') r.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }

  function clampThreshold(v) {
    let n = parseFloat(v);
    if (!Number.isFinite(n)) n = VM.DEFAULT_THRESHOLD;
    return Math.min(0.95, Math.max(0.5, n));
  }

  /* Parse an export into { names, playedNorms }. Supports:
     - v3 Mother: { version:3, type:"mother", games:[{name, played}] }
     - legacy:    { vault:[{name}], played:[{name}] }  (played → completed)
     - generic:   { games:[...] }, array of strings/objects, or a plain list. */
  function extractNames(raw) {
    raw = String(raw || '').trim();
    if (!raw) return { error: 'Paste your vault JSON (or a list of names) first.' };

    let names = [];
    const playedNames = [];      // names flagged as played/completed
    let vaultCount = 0, playedCount = 0;
    let isMother = false, parsedJson = true;

    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const x of data) {
          if (typeof x === 'string') names.push(x);
          else if (x && x.name) names.push(x.name);
        }
      } else if (data && typeof data === 'object') {
        if (data.type === 'mother' && Array.isArray(data.games)) {
          isMother = true;
          for (const g of data.games) {
            if (!g || !g.name) continue;
            names.push(g.name);
            if (g.played) playedNames.push(g.name);
          }
        } else if (Array.isArray(data.vault) || Array.isArray(data.played)) {
          if (Array.isArray(data.vault))
            for (const it of data.vault) if (it && it.name) { names.push(it.name); vaultCount++; }
          if (Array.isArray(data.played))
            for (const it of data.played) if (it && it.name) { names.push(it.name); playedNames.push(it.name); playedCount++; }
        } else if (Array.isArray(data.games)) {
          for (const it of data.games) {
            if (typeof it === 'string') names.push(it);
            else if (it && it.name) { names.push(it.name); if (it.played) playedNames.push(it.name); }
          }
        }
      }
    } catch (e) {
      parsedJson = false;
    }

    if (!parsedJson) names = raw.split(/[\n,]+/);   // plain newline/comma list

    names = names.map((s) => String(s == null ? '' : s).trim()).filter(Boolean);
    if (names.length === 0) {
      return { error: parsedJson ? 'No game names found in that JSON.' : 'No names found.' };
    }

    // Dedup by normalize() so the same game isn't stored twice.
    const seen = new Set();
    const uniq = [];
    for (const n of names) {
      const key = VM.normalize(n) || n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(n);
    }
    // Normalized set of played/completed names.
    const playedNormSet = new Set();
    for (const n of playedNames) {
      const key = VM.normalize(n) || n.toLowerCase();
      if (key) playedNormSet.add(key);
    }

    return {
      names: uniq,
      playedNorms: Array.from(playedNormSet),
      vaultCount, playedCount,
      isMother
    };
  }

  function loadedMsg(d) {
    const completed = (d.playedNorms && d.playedNorms.length) || 0;
    return 'Loaded ' + d.names.length + ' games' + (completed ? ' (' + completed + ' completed)' : '') + '.';
  }

  function timeAgo(ts) {
    if (!ts) return 'just now';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hr ago';
    const d = Math.floor(h / 24);
    return d + ' day' + (d > 1 ? 's' : '') + ' ago';
  }

  // Auto-synced vaults (source:'game-vault') get the sync message; manual loads
  // keep the existing "Loaded N games" text.
  function statusMsg(d) {
    if (!d || !Array.isArray(d.names)) return null;
    if (d.source === 'game-vault') {
      return 'Synced from Game Vault: ' + d.names.length + ' games · last synced ' + timeAgo(d.lastSynced) + '.';
    }
    return loadedMsg(d);
  }

  async function init() {
    if (!hasStorage) {
      setStatus('Extension storage unavailable — reload the extension.', 'err');
      return;
    }
    try {
      const res = await storageGet([KEY_DATA, KEY_ENABLED, KEY_AUTOSCAN, KEY_RESULTS]);
      const isOn = res[KEY_ENABLED] === true;   // default OFF unless explicitly enabled
      enabledToggle.checked = isOn;
      toggleState.textContent = isOn ? 'On' : 'Off';

      const scanOn = res[KEY_AUTOSCAN] === true;   // default OFF
      autoscanToggle.checked = scanOn;
      autoscanState.textContent = scanOn ? 'On' : 'Off';

      renderResultsCount(res[KEY_RESULTS]);

      const d = res[KEY_DATA];
      const msg = statusMsg(d);
      if (msg) {
        thresholdInput.value = clampThreshold(d.threshold);
        setStatus(msg, 'ok');
      } else {
        thresholdInput.value = VM.DEFAULT_THRESHOLD;
        setStatus('No vault loaded yet.', '');
      }
    } catch (e) {
      setStatus('Storage error: ' + e.message, 'err');
    }
  }

  enabledToggle.addEventListener('change', async () => {
    const isOn = enabledToggle.checked;
    toggleState.textContent = isOn ? 'On' : 'Off';
    if (!hasStorage) { setStatus('Storage unavailable.', 'err'); return; }
    try { await storageSet({ [KEY_ENABLED]: isOn }); }
    catch (e) { setStatus('Could not save toggle: ' + e.message, 'err'); }
  });

  autoscanToggle.addEventListener('change', async () => {
    const isOn = autoscanToggle.checked;
    autoscanState.textContent = isOn ? 'On' : 'Off';
    if (!hasStorage) { setStatus('Storage unavailable.', 'err'); return; }
    try { await storageSet({ [KEY_AUTOSCAN]: isOn }); }
    catch (e) { setStatus('Could not save toggle: ' + e.message, 'err'); }
  });

  function renderResultsCount(r) {
    const n = r ? ((r.inVault || []).length + (r.completed || []).length + (r.notInVault || []).length) : 0;
    resultsCount.textContent = n + ' collected';
  }

  viewResultsBtn.addEventListener('click', () => {
    const url = (RT && RT.getURL) ? RT.getURL('results.html') : 'results.html';
    if (TABS && TABS.create) TABS.create({ url: url });
    else window.open(url, '_blank');
  });

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { jsonInput.value = String(reader.result || ''); setStatus('File loaded — press “Load vault”.', ''); };
    reader.onerror = () => setStatus('Could not read file.', 'err');
    reader.readAsText(f);
  });

  loadBtn.addEventListener('click', async () => {
    if (!hasStorage) { setStatus('Extension storage unavailable — reload the extension.', 'err'); return; }
    const parsed = extractNames(jsonInput.value);
    if (parsed.error) { setStatus(parsed.error, 'err'); return; }
    const threshold = clampThreshold(thresholdInput.value);
    thresholdInput.value = threshold;
    const data = {
      names: parsed.names,
      playedNorms: parsed.playedNorms,
      count: parsed.names.length,
      vaultCount: parsed.vaultCount,
      playedCount: parsed.playedCount,
      threshold: threshold,
      source: 'manual',
      updatedAt: Date.now()
    };
    try {
      await storageSet({ [KEY_DATA]: data });
      setStatus(loadedMsg(data), 'ok');
    } catch (e) {
      setStatus('Save failed: ' + e.message, 'err');
    }
  });

  clearBtn.addEventListener('click', async () => {
    if (!hasStorage) { setStatus('Storage unavailable.', 'err'); return; }
    try {
      await storageRemove(KEY_DATA);
      jsonInput.value = '';
      setStatus('Vault cleared.', '');
    } catch (e) {
      setStatus('Clear failed: ' + e.message, 'err');
    }
  });

  // Live-refresh the status if an auto-sync lands while the popup is open
  // (e.g. right after the user flips the toggle ON and sync.js syncs).
  if (STORAGE_NS && STORAGE_NS.onChanged && STORAGE_NS.onChanged.addListener) {
    STORAGE_NS.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (KEY_DATA in changes) {
        const d = changes[KEY_DATA].newValue;
        const msg = statusMsg(d);
        if (msg) { thresholdInput.value = clampThreshold(d.threshold); setStatus(msg, 'ok'); }
      }
      if (KEY_RESULTS in changes) renderResultsCount(changes[KEY_RESULTS].newValue);
    });
  }

  init();
})();
