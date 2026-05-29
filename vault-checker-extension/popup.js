/* popup.js — load the Game Vault export into storage.local, toggle detection
 * on/off, set the fuzzy threshold, and clear the stored list. */
(function () {
  'use strict';

  const browser = window.browser;
  const VM = window.VaultMatch;
  const KEY_DATA = 'vaultData';
  const KEY_ENABLED = 'enabled';

  const $ = (id) => document.getElementById(id);
  const enabledToggle = $('enabled-toggle');
  const toggleState = $('toggle-state');
  const jsonInput = $('json-input');
  const fileInput = $('file-input');
  const loadBtn = $('load-btn');
  const clearBtn = $('clear-btn');
  const thresholdInput = $('threshold-input');
  const statusEl = $('status');

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function clampThreshold(v) {
    let n = parseFloat(v);
    if (!Number.isFinite(n)) n = VM.DEFAULT_THRESHOLD;
    return Math.min(0.95, Math.max(0.5, n));
  }

  /* Parse a vault export (or a fallback name list) into unique game names.
     Real export shape: { version, vault:[{name}], played:[{name}] }. */
  function extractNames(raw) {
    raw = String(raw || '').trim();
    if (!raw) return { error: 'Paste your vault JSON (or a list of names) first.' };

    let names = [];
    let vaultCount = 0, playedCount = 0;
    let parsedJson = true;
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const x of data) {
          if (typeof x === 'string') names.push(x);
          else if (x && x.name) names.push(x.name);
        }
      } else if (data && typeof data === 'object') {
        if (Array.isArray(data.vault)) {
          for (const it of data.vault) if (it && it.name) { names.push(it.name); vaultCount++; }
        }
        if (Array.isArray(data.played)) {
          for (const it of data.played) if (it && it.name) { names.push(it.name); playedCount++; }
        }
        // tolerate a generic { games: [...] } shape
        if (!data.vault && !data.played && Array.isArray(data.games)) {
          for (const it of data.games) {
            if (typeof it === 'string') names.push(it);
            else if (it && it.name) names.push(it.name);
          }
        }
      }
    } catch (e) {
      parsedJson = false;
    }

    // Not JSON → treat as plain newline/comma separated list of names.
    if (!parsedJson) {
      names = raw.split(/[\n,]+/);
    }

    names = names.map((s) => String(s == null ? '' : s).trim()).filter(Boolean);
    if (names.length === 0) {
      return { error: parsedJson ? 'No game names found in that JSON (need vault[].name / played[].name).' : 'No names found.' };
    }

    // Dedup by the vault's normalize() so the same game isn't stored twice.
    const seen = new Set();
    const uniq = [];
    for (const n of names) {
      const norm = VM.normalize(n);
      const key = norm || n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(n);
    }
    return { names: uniq, vaultCount, playedCount, rawTotal: names.length };
  }

  async function init() {
    try {
      const res = await browser.storage.local.get([KEY_DATA, KEY_ENABLED]);
      const isOn = res[KEY_ENABLED] !== false;
      enabledToggle.checked = isOn;
      toggleState.textContent = isOn ? 'On' : 'Off';

      const d = res[KEY_DATA];
      if (d && Array.isArray(d.names)) {
        thresholdInput.value = clampThreshold(d.threshold);
        const parts = [];
        if (d.vaultCount) parts.push('vault ' + d.vaultCount);
        if (d.playedCount) parts.push('played ' + d.playedCount);
        const detail = parts.length ? ' (' + parts.join(' + ') + ')' : '';
        setStatus('Loaded ' + d.names.length + ' games' + detail + '.', 'ok');
      } else {
        thresholdInput.value = VM.DEFAULT_THRESHOLD;
        setStatus('No vault loaded yet.', '');
      }
    } catch (e) {
      setStatus('Storage unavailable: ' + e.message, 'err');
    }
  }

  enabledToggle.addEventListener('change', async () => {
    const isOn = enabledToggle.checked;
    toggleState.textContent = isOn ? 'On' : 'Off';
    try { await browser.storage.local.set({ [KEY_ENABLED]: isOn }); }
    catch (e) { setStatus('Could not save toggle: ' + e.message, 'err'); }
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
    const parsed = extractNames(jsonInput.value);
    if (parsed.error) { setStatus(parsed.error, 'err'); return; }
    const threshold = clampThreshold(thresholdInput.value);
    thresholdInput.value = threshold;
    const data = {
      names: parsed.names,
      count: parsed.names.length,
      vaultCount: parsed.vaultCount,
      playedCount: parsed.playedCount,
      threshold: threshold,
      updatedAt: Date.now()
    };
    try {
      await browser.storage.local.set({ [KEY_DATA]: data });
      const parts = [];
      if (parsed.vaultCount) parts.push('vault ' + parsed.vaultCount);
      if (parsed.playedCount) parts.push('played ' + parsed.playedCount);
      const detail = parts.length ? ' (' + parts.join(' + ') + ')' : '';
      setStatus('Loaded ' + parsed.names.length + ' games' + detail + '.', 'ok');
    } catch (e) {
      setStatus('Save failed: ' + e.message, 'err');
    }
  });

  clearBtn.addEventListener('click', async () => {
    try {
      await browser.storage.local.remove(KEY_DATA);
      jsonInput.value = '';
      setStatus('Vault cleared.', '');
    } catch (e) {
      setStatus('Clear failed: ' + e.message, 'err');
    }
  });

  init();
})();
