/* content.js — runs on every page. Detects text selections, splits them into
 * individual game names, matches each against the stored Game Vault (Mother
 * aggregate) using the verbatim match engine, and shows a small Shadow-DOM panel
 * near the selection with three states per name:
 *   matched + played  → ✓ completed   (teal)
 *   matched + !played → ✓ in vault     (green)
 *   no match          → ✗ not in vault (red)
 * Honors the ON/OFF toggle in storage.local: when disabled, no panel is shown.
 */
(function () {
  'use strict';

  // Storage MUST NOT depend on window.browser (the polyfill may be absent or
  // may have thrown on load). Use chrome.storage.local directly — native on
  // BOTH Chromium MV3 and Firefox MV3 — falling back to browser.storage.local
  // only if `chrome` is missing entirely.
  const S = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local
          : (typeof browser !== 'undefined' && browser.storage) ? browser.storage.local
          : null;
  const RT = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime
           : (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime
           : null;
  // onChanged lives on the storage namespace itself, not storage.local.
  const STORAGE_NS = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage
                   : (typeof browser !== 'undefined' && browser.storage) ? browser.storage
                   : null;
  const VM = (typeof self !== 'undefined' && self.VaultMatch) || window.VaultMatch;
  if (!S || !VM) return; // missing deps — bail quietly

  const KEY_DATA = 'vaultData';
  const KEY_ENABLED = 'enabled';
  const MAX_NAMES = 25;
  const DEBOUNCE_MS = 150;

  let enabled = true;            // default ON
  let vaultData = null;          // { names:[], playedNorms:[], threshold, ... }
  let index = null;              // VM.SearchIndex, built lazily
  let playedSet = new Set();     // normalized names flagged completed/played
  let host = null, shadow = null, listEl = null, titleEl = null;

  /* ─── Storage ─────────────────────────────────────────────────── */
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

  async function loadState() {
    try {
      const res = await storageGet([KEY_DATA, KEY_ENABLED]);
      enabled = res[KEY_ENABLED] !== false;
      vaultData = res[KEY_DATA] || null;
      index = null;
      playedSet = new Set((vaultData && vaultData.playedNorms) || []);
    } catch (e) { /* leave defaults */ }
  }

  function ensureIndex() {
    if (index) return index;
    if (!vaultData || !Array.isArray(vaultData.names) || vaultData.names.length === 0) return null;
    const idx = new VM.SearchIndex();
    idx.rebuild(vaultData.names.map((name, i) => ({ id: i, name: String(name) })));
    index = idx;
    return index;
  }

  function getThreshold() {
    const t = vaultData ? Number(vaultData.threshold) : NaN;
    return (Number.isFinite(t) && t > 0) ? t : VM.DEFAULT_THRESHOLD;
  }

  /* ─── Selection helpers ───────────────────────────────────────── */
  function splitNames(text) {
    return text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  }
  function debounce(fn, ms) {
    let t = null;
    return function () { if (t) clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* ─── Shadow-DOM panel ─────────────────────────────────────────── */
  function ensurePanel() {
    if (host) return;
    host = document.createElement('div');
    host.id = '__vault_checker_host';
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647;display:none;';
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = [
      ':host{ all:initial; }',
      '.vc-panel{',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      '  width:max-content;max-width:340px;min-width:200px;',
      '  background:#16161b;color:#f0ece4;border:1px solid #2a2a31;',
      '  border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,0.45);',
      '  overflow:hidden;font-size:13px;line-height:1.4;}',
      '.vc-head{display:flex;align-items:center;justify-content:space-between;',
      '  gap:8px;padding:8px 10px;background:#1c1c22;border-bottom:1px solid #2a2a31;}',
      '.vc-title{font-size:11px;font-weight:600;letter-spacing:.04em;color:#cfcabf;white-space:nowrap;}',
      '.vc-close{appearance:none;background:none;border:none;color:#9a948b;',
      '  cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;border-radius:4px;}',
      '.vc-close:hover{color:#fff;background:rgba(255,255,255,.08);}',
      '.vc-list{margin:0;padding:4px 0;max-height:280px;overflow-y:auto;}',
      '.vc-row{display:flex;align-items:center;gap:8px;padding:5px 12px;}',
      '.vc-mark{flex:none;width:16px;text-align:center;font-weight:700;}',
      '.vc-name{flex:1;word-break:break-word;}',
      '.vc-status{flex:none;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;}',
      '.vc-sub{display:block;font-size:11px;color:#76716a;margin-top:1px;}',
      // state colors
      '.vc-done .vc-mark,.vc-done .vc-status{color:#38bdf8;}',   // completed (teal)
      '.vc-hit  .vc-mark,.vc-hit  .vc-status{color:#4ade80;}',   // in vault (green)
      '.vc-miss .vc-mark,.vc-miss .vc-status{color:#f87171;}',   // not in vault (red)
      '.vc-note{padding:8px 12px;color:#9a948b;font-size:12px;}',
      '.vc-more{padding:4px 12px 8px;color:#76716a;font-size:11px;}'
    ].join('\n');
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'vc-panel';

    const head = document.createElement('div');
    head.className = 'vc-head';
    titleEl = document.createElement('span');
    titleEl.className = 'vc-title';
    titleEl.textContent = 'Vault Checker';
    const close = document.createElement('button');
    close.className = 'vc-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    close.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hidePanel(); });
    head.appendChild(titleEl);
    head.appendChild(close);

    listEl = document.createElement('div');
    listEl.className = 'vc-list';

    panel.appendChild(head);
    panel.appendChild(listEl);
    shadow.appendChild(panel);
    document.documentElement.appendChild(host);
  }

  function hidePanel() { if (host) host.style.display = 'none'; }

  // state: 'done' | 'hit' | 'miss'
  const STATUS_TEXT = { done: 'completed', hit: 'in vault', miss: 'not in vault' };
  const MARK = { done: '✓', hit: '✓', miss: '✗' };

  function renderRows(rows, note, total) {
    listEl.innerHTML = '';
    if (note) {
      const n = document.createElement('div');
      n.className = 'vc-note';
      n.textContent = note;
      listEl.appendChild(n);
    }
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'vc-row vc-' + r.state;
      const mark = document.createElement('span');
      mark.className = 'vc-mark';
      mark.textContent = MARK[r.state];
      const nameWrap = document.createElement('span');
      nameWrap.className = 'vc-name';
      nameWrap.textContent = r.name;
      if (r.match && r.match.toLowerCase() !== r.name.toLowerCase()) {
        const sub = document.createElement('span');
        sub.className = 'vc-sub';
        sub.textContent = 'matched: ' + r.match;
        nameWrap.appendChild(sub);
      }
      const status = document.createElement('span');
      status.className = 'vc-status';
      status.textContent = STATUS_TEXT[r.state];
      row.appendChild(mark);
      row.appendChild(nameWrap);
      row.appendChild(status);
      listEl.appendChild(row);
    }
    if (total && total > rows.length) {
      const more = document.createElement('div');
      more.className = 'vc-more';
      more.textContent = '+' + (total - rows.length) + ' more selected (not shown)';
      listEl.appendChild(more);
    }
  }

  function setTitle(rows, note) {
    if (note) { titleEl.textContent = 'Vault Checker'; return; }
    let done = 0, hit = 0, miss = 0;
    for (const r of rows) { if (r.state === 'done') done++; else if (r.state === 'hit') hit++; else miss++; }
    titleEl.textContent = 'Completed ' + done + ' · Vault ' + hit + ' · Missing ' + miss;
  }

  function positionPanel(rect) {
    const panel = shadow.querySelector('.vc-panel');
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + pw > vw - 8) left = vw - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > vh - 8) top = Math.max(8, rect.top - ph - 8);
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
  }

  /* ─── Core check ──────────────────────────────────────────────── */
  function checkSelection() {
    if (!enabled) { hidePanel(); return; }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hidePanel(); return; }
    const text = sel.toString();
    if (!text || !text.trim()) { hidePanel(); return; }

    const names = splitNames(text);
    if (names.length === 0) { hidePanel(); return; }

    let rect;
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (e) { hidePanel(); return; }
    if (!rect || (rect.width === 0 && rect.height === 0)) { hidePanel(); return; }

    ensurePanel();

    const idx = ensureIndex();
    const rows = [];
    let note = '';
    if (!idx) {
      note = 'No vault loaded — open the extension and load your Game Vault export.';
    } else {
      const th = getThreshold();
      const seen = new Set();
      for (const nm of names) {
        if (rows.length >= MAX_NAMES) break;
        const key = nm.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const m = idx.matchOne(nm, true, th);
        let state, match = null;
        if (!m) {
          state = 'miss';
        } else {
          match = m.item.name;
          state = playedSet.has(VM.normalize(match)) ? 'done' : 'hit';
        }
        rows.push({ name: nm, state: state, match: match });
      }
    }

    renderRows(rows, note, names.length);
    setTitle(rows, note);
    host.style.display = 'block';
    positionPanel(rect);
  }

  const debouncedCheck = debounce(checkSelection, DEBOUNCE_MS);

  /* ─── Events ──────────────────────────────────────────────────── */
  document.addEventListener('selectionchange', debouncedCheck, true);
  document.addEventListener('mouseup', () => setTimeout(checkSelection, 0), true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePanel(); }, true);
  window.addEventListener('scroll', hidePanel, true);
  window.addEventListener('resize', hidePanel, true);

  if (STORAGE_NS && STORAGE_NS.onChanged && STORAGE_NS.onChanged.addListener) {
    STORAGE_NS.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (KEY_ENABLED in changes) enabled = changes[KEY_ENABLED].newValue !== false;
      if (KEY_DATA in changes) {
        vaultData = changes[KEY_DATA].newValue || null;
        index = null;
        playedSet = new Set((vaultData && vaultData.playedNorms) || []);
      }
      if (!enabled) hidePanel();
    });
  }

  loadState();
})();
