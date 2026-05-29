/* content.js — runs on every page. Detects text selections, splits them into
 * individual game names, matches each against the stored Game Vault using the
 * verbatim match engine, and shows a small Shadow-DOM panel near the selection.
 *
 * Honors the ON/OFF toggle in storage.local: when disabled, no panel is shown.
 */
(function () {
  'use strict';

  const browser = (typeof self !== 'undefined' && self.browser) || window.browser;
  const VM = (typeof self !== 'undefined' && self.VaultMatch) || window.VaultMatch;
  if (!browser || !VM) return; // polyfill / engine not loaded — bail quietly

  const KEY_DATA = 'vaultData';
  const KEY_ENABLED = 'enabled';
  const MAX_NAMES = 25;          // cap rows so a huge selection can't make a giant panel
  const DEBOUNCE_MS = 150;

  let enabled = true;            // default ON
  let vaultData = null;          // { names:[], threshold, count, ... }
  let index = null;              // VM.SearchIndex, built lazily and cached
  let host = null, shadow = null, listEl = null, titleEl = null;

  /* ─── State / storage ─────────────────────────────────────────── */
  async function loadState() {
    try {
      const res = await browser.storage.local.get([KEY_DATA, KEY_ENABLED]);
      enabled = res[KEY_ENABLED] !== false;       // anything but explicit false ⇒ ON
      vaultData = res[KEY_DATA] || null;
      index = null;                                 // rebuild lazily
    } catch (e) { /* storage unavailable — leave defaults */ }
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
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  /* ─── Shadow-DOM panel ─────────────────────────────────────────── */
  function ensurePanel() {
    if (host) return;
    host = document.createElement('div');
    host.id = '__vault_checker_host';
    host.style.cssText =
      'all:initial;position:fixed;top:0;left:0;z-index:2147483647;display:none;';
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = [
      ':host{ all:initial; }',
      '.vc-panel{',
      '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
      '  width:max-content;max-width:320px;min-width:180px;',
      '  background:#16161b;color:#f0ece4;border:1px solid #2a2a31;',
      '  border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,0.45);',
      '  overflow:hidden;font-size:13px;line-height:1.4;}',
      '.vc-head{display:flex;align-items:center;justify-content:space-between;',
      '  gap:8px;padding:8px 10px;background:#1c1c22;border-bottom:1px solid #2a2a31;}',
      '.vc-title{font-size:11px;font-weight:600;letter-spacing:.08em;',
      '  text-transform:uppercase;color:#f5a623;white-space:nowrap;}',
      '.vc-close{appearance:none;background:none;border:none;color:#9a948b;',
      '  cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;border-radius:4px;}',
      '.vc-close:hover{color:#fff;background:rgba(255,255,255,.08);}',
      '.vc-list{margin:0;padding:4px 0;max-height:260px;overflow-y:auto;}',
      '.vc-row{display:flex;align-items:center;gap:8px;padding:5px 12px;}',
      '.vc-mark{flex:none;width:16px;text-align:center;font-weight:700;}',
      '.vc-hit .vc-mark{color:#4ade80;}',
      '.vc-miss .vc-mark{color:#f87171;}',
      '.vc-name{flex:1;word-break:break-word;}',
      '.vc-sub{display:block;font-size:11px;color:#76716a;margin-top:1px;}',
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

  function hidePanel() {
    if (host) host.style.display = 'none';
  }

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
      row.className = 'vc-row ' + (r.hit ? 'vc-hit' : 'vc-miss');
      const mark = document.createElement('span');
      mark.className = 'vc-mark';
      mark.textContent = r.hit ? '✓' : '✗';
      const nameWrap = document.createElement('span');
      nameWrap.className = 'vc-name';
      nameWrap.textContent = r.name;
      if (r.hit && r.match && r.match.toLowerCase() !== r.name.toLowerCase()) {
        const sub = document.createElement('span');
        sub.className = 'vc-sub';
        sub.textContent = 'matched: ' + r.match;
        nameWrap.appendChild(sub);
      }
      row.appendChild(mark);
      row.appendChild(nameWrap);
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
    const hits = rows.filter((r) => r.hit).length;
    titleEl.textContent = 'In vault: ' + hits + ' / ' + rows.length;
  }

  function positionPanel(rect) {
    // host is position:fixed → rect (viewport coords) maps directly.
    const panel = shadow.querySelector('.vc-panel');
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + pw > vw - 8) left = vw - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > vh - 8) top = Math.max(8, rect.top - ph - 8); // flip above selection
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
    let rows = [];
    let note = '';
    if (!idx) {
      note = 'No vault loaded — open the extension and paste your Game Vault JSON.';
    } else {
      const th = getThreshold();
      const seen = new Set();
      for (const nm of names) {
        if (rows.length >= MAX_NAMES) break;
        const key = nm.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const m = idx.matchOne(nm, true, th);
        rows.push({ name: nm, hit: !!m, match: (m && m.item) ? m.item.name : null });
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

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (KEY_ENABLED in changes) enabled = changes[KEY_ENABLED].newValue !== false;
    if (KEY_DATA in changes) { vaultData = changes[KEY_DATA].newValue || null; index = null; }
    if (!enabled) hidePanel();
  });

  loadState();
})();
