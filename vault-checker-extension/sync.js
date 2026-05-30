/* sync.js — runs ONLY on the Game Vault page (local file + GitHub Pages).
 * Auto-syncs the full game database from Game Vault's localStorage mirror into
 * chrome.storage.local, so the extension needs no manual upload and stays fresh
 * as the vault changes.
 *
 * Game Vault writes localStorage["vaultCheckerSync"] =
 *   { version:4, type:"mother", games:[{ name, played, db }] }
 * (cleaned names) and dispatches a window CustomEvent('vault-checker-sync')
 * after each write, plus a "vaultCheckerSyncTs" timestamp.
 *
 * OFF by default: while the extension toggle is OFF this script is fully inert —
 * it reads nothing and attaches no sync listeners; only a passive
 * chrome.storage.onChanged listener waits for the flip. No polling / setInterval.
 */
(function () {
  'use strict';

  // chrome.storage.local directly (native on Chromium + Firefox MV3); fall back
  // to browser.storage.local only if `chrome` is entirely absent.
  const S = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local
          : (typeof browser !== 'undefined' && browser.storage) ? browser.storage.local
          : null;
  const RT = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime
           : (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime
           : null;
  const STORAGE_NS = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage
                   : (typeof browser !== 'undefined' && browser.storage) ? browser.storage
                   : null;
  const VM = (typeof self !== 'undefined' && self.VaultMatch) || window.VaultMatch;
  if (!S || !VM) return; // missing deps — bail quietly

  const KEY_DATA = 'vaultData';
  const KEY_ENABLED = 'enabled';
  const LS_KEY = 'vaultCheckerSync';
  const TS_KEY = 'vaultCheckerSyncTs';

  let enabled = false;       // default OFF
  let listenersOn = false;

  /* ─── Storage helpers ─────────────────────────────────────────── */
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

  /* ─── Parse + sync ────────────────────────────────────────────── */
  // Build the stored shape content.js reads (names + playedNorms) plus a dbMap
  // (norm → source database) for a later results-UI phase. Deduped by normalize.
  function parsePayload(raw) {
    if (!raw) return null;
    let data;
    try { data = JSON.parse(raw); } catch (e) { return null; }
    if (!data || !Array.isArray(data.games)) return null;

    const names = [];
    const playedNormsSet = new Set();
    const dbMap = {};
    const seen = new Set();
    for (const g of data.games) {
      if (!g || !g.name) continue;
      const name = String(g.name);
      const norm = VM.normalize(name) || name.toLowerCase();
      if (!norm || seen.has(norm)) continue;   // already deduped at source; defensive
      seen.add(norm);
      names.push(name);
      if (g.db) dbMap[norm] = String(g.db);
      if (g.played) playedNormsSet.add(norm);
    }
    return { names, playedNorms: Array.from(playedNormsSet), dbMap, count: names.length };
  }

  async function doSync() {
    let raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { return; }
    const parsed = parsePayload(raw);
    if (!parsed) return;

    // Preserve a previously-set fuzzy threshold; otherwise use the engine default.
    let threshold = VM.DEFAULT_THRESHOLD || 0.82;
    try {
      const cur = await storageGet([KEY_DATA]);
      const cd = cur[KEY_DATA];
      const t = cd && Number(cd.threshold);
      if (Number.isFinite(t) && t > 0) threshold = t;
    } catch (e) { /* keep default */ }

    const data = {
      names: parsed.names,
      playedNorms: parsed.playedNorms,
      dbMap: parsed.dbMap,
      count: parsed.count,
      threshold: threshold,
      source: 'game-vault',
      lastSynced: Date.now()
    };
    try { await storageSet({ [KEY_DATA]: data }); } catch (e) { /* non-fatal */ }
  }

  /* ─── Live-sync listeners (passive, no polling) ───────────────── */
  const onCustom = () => doSync();                              // same-tab write
  const onStorage = (e) => {                                    // other-tab write
    if (!e || e.key === null || e.key === LS_KEY || e.key === TS_KEY) doSync();
  };
  const onFocus = () => doSync();
  const onVisibility = () => { if (document.visibilityState === 'visible') doSync(); };

  function enable() {
    if (listenersOn) return;
    listenersOn = true;
    window.addEventListener('vault-checker-sync', onCustom);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    doSync();   // initial sync
  }
  function disable() {
    if (!listenersOn) return;
    listenersOn = false;
    window.removeEventListener('vault-checker-sync', onCustom);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  // Passive flip listener — the only thing alive while OFF.
  if (STORAGE_NS && STORAGE_NS.onChanged && STORAGE_NS.onChanged.addListener) {
    STORAGE_NS.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (KEY_ENABLED in changes) {
        enabled = changes[KEY_ENABLED].newValue === true;
        if (enabled) enable(); else disable();
      }
    });
  }

  // Boot: read the toggle, act only if ON.
  (async () => {
    try {
      const res = await storageGet([KEY_ENABLED]);
      enabled = res[KEY_ENABLED] === true;
    } catch (e) { enabled = false; }
    if (enabled) enable();
  })();
})();
