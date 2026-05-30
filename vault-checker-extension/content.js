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
  const KEY_AUTOSCAN = 'autoScan';
  const KEY_RESULTS = 'scanResults';
  const DEBOUNCE_MS = 150;

  let enabled = false;           // default OFF — fully inert until toggled on
  let listenersOn = false;       // whether selection listeners are attached
  let autoScan = false;          // Auto-scan toggle (independent of Detection)
  let scanOn = false;            // whether scan observers are attached
  let vaultData = null;          // { names:[], playedNorms:[], dbMap, threshold, ... }
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

  async function loadState() {
    try {
      const res = await storageGet([KEY_DATA, KEY_ENABLED, KEY_AUTOSCAN]);
      enabled = res[KEY_ENABLED] === true;   // default OFF unless explicitly enabled
      autoScan = res[KEY_AUTOSCAN] === true; // default OFF
      vaultData = res[KEY_DATA] || null;
      index = null;
      playedSet = new Set((vaultData && vaultData.playedNorms) || []);
    } catch (e) { /* leave defaults */ }
  }

  function ensureIndex() {
    if (index) return index;
    if (!vaultData || !Array.isArray(vaultData.names) || vaultData.names.length === 0) return null;
    const idx = new VM.SearchIndex();
    // Match on the cleaned base name (year+playtime stripped) but keep the raw
    // name in _raw so the played lookup still works against the stored
    // playedNorms (which were computed from the raw names). This is what lets the
    // fix work on the CURRENTLY loaded data with just an extension reload.
    idx.rebuild(vaultData.names.map((name, i) => {
      const raw = String(name);
      return { id: i, name: VM.cleanGameName(raw), _raw: raw };
    }));
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
      '.vc-list{margin:0;padding:0 0 4px;max-height:60vh;overflow-y:auto;}',
      '.vc-summary{padding:7px 12px;font-size:11px;font-weight:600;color:#cfcabf;',
      '  border-bottom:1px solid #2a2a31;position:sticky;top:0;background:#16161b;z-index:1;}',
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

  function renderRows(rows, note) {
    listEl.innerHTML = '';
    if (note) {
      const n = document.createElement('div');
      n.className = 'vc-note';
      n.textContent = note;
      listEl.appendChild(n);
      return;
    }
    // Summary line (sticky at the top while scrolling). Every detected game is
    // represented in the rows below — there is no cap.
    let done = 0, hit = 0, miss = 0;
    for (const r of rows) { if (r.state === 'done') done++; else if (r.state === 'hit') hit++; else miss++; }
    const sum = document.createElement('div');
    sum.className = 'vc-summary';
    sum.textContent = rows.length + (rows.length === 1 ? ' game' : ' games') +
      ' — ' + hit + ' in vault · ' + done + ' completed · ' + miss + ' not in vault';
    listEl.appendChild(sum);
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
        const key = nm.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        // Clean the selection too (harmless if it carries no year meta), so a
        // pasted "Crimson Desert 2025 30" matches the same as "Crimson Desert".
        const cleanedNm = VM.cleanGameName(nm);
        const m = idx.matchOne(cleanedNm, true, th);
        let state, match = null, db = '';
        if (!m) {
          state = 'miss';
        } else {
          // Display the cleaned matched name; resolve played via the RAW name's
          // norm so it lines up with the stored (raw-derived) playedNorms.
          match = m.item.name;
          const rawNorm = VM.normalize(m.item._raw || m.item.name);
          state = playedSet.has(rawNorm) ? 'done' : 'hit';
          db = (vaultData && vaultData.dbMap && vaultData.dbMap[rawNorm]) || '';
        }
        rows.push({ name: nm, state: state, match: match });
        // Collect manual selections into the same store as auto-scan (nothing
        // lost). collectResult dedups by normalize across all three lists.
        collectResult(state, cleanedNm, match, db);
      }
    }

    renderRows(rows, note);
    setTitle(rows, note);
    host.style.display = 'block';
    positionPanel(rect);
  }

  const debouncedCheck = debounce(checkSelection, DEBOUNCE_MS);

  /* ─── Auto-scan ────────────────────────────────────────────────────
   * Passive, scroll-driven detection of candidate game names from page
   * structure. Uses IntersectionObserver (marks elements as they scroll into
   * view) + a MutationObserver (registers newly-added nodes on infinite-scroll
   * / SPA pages). NO polling. Reuses the same vault index, threshold and
   * playedSet as manual Detection. Independent toggle; OFF by default and
   * fully inert when off. Manual select is untouched. */
  const MARK_COLOR = { done: '#38bdf8', hit: '#4ade80', miss: '#f87171' };
  const MARK_GLYPH = { done: '✓', hit: '✓', miss: '✗' };
  // Candidate TITLE elements only: headings, links, and explicit title/name
  // class hooks. We deliberately exclude li / generic containers / img[alt] so
  // we mark the prominent game title, not whole rows or surrounding metadata.
  const SCAN_SELECTOR = 'h1, h2, h3, h4, h5, h6, a, [class*="title"], [class*="name"]';
  // Regions that hold settings/filters/nav — never a game title. Anything inside
  // these is skipped entirely.
  // Skip ONLY by real tag + obvious nav ARIA role. No class-name matching —
  // RAWG card ancestors kept matching generic class words and ate the whole grid.
  // The word-exclusion filters (All X / X list / genre / score / settings words)
  // handle the MobyGames sidebar junk instead.
  const SKIP_TAGS = new Set(['NAV', 'ASIDE', 'FORM', 'SELECT', 'OPTION', 'BUTTON', 'LABEL']);
  const SKIP_ROLE_RX = /^(?:navigation|search|menu|menubar|menuitem|listbox|combobox|dialog|tablist|radiogroup)$/i;

  let io = null, mo = null;
  let scanSeen = new Set();          // norms already collected (dedup across lists)
  let scanResults = { inVault: [], completed: [], notInVault: [] };
  let scanResultsLoaded = false;
  let _scanWriteTimer = null;
  let _lastWrittenTs = 0;            // updatedAt of our own last write (to ignore the echo)

  /* — exclusion filters: drop non-game candidates before matching — */
  const UI_WORDS = new Set([
    'home','login','log in','sign in','sign up','signup','register','logout','log out',
    'menu','search','settings','account','profile','dashboard','cart','checkout','wishlist',
    'subscribe','newsletter','contact','about','about us','privacy','privacy policy','terms',
    'terms of service','cookie','cookies','help','support','faq','share','follow','like',
    'comment','comments','reply','more','read more','view all','see all','show more','load more',
    'next','previous','prev','back','top','skip','close','submit','send','save','cancel','edit',
    'delete','download','upload','print','copy','link','category','categories','tags','tag',
    'home page','sign out','my account','add to cart','buy now','learn more','get started',
    'advertisement','sponsored','trending','popular','latest','news','reviews','review','guides',
    'guide','forum','forums','community','store','shop','wiki','blog','english','language',
    // UI actions / "show more like this" family
    'show more','show less','show more like this','show all','view more','view all','see all',
    'see more','load more','read more','expand','collapse','filter','filters','apply','reset',
    'clear','clear all','sort','sort by','order','order by','add to list','add','remove',
    // settings / filter labels (MobyGames / RAWG management UI)
    'from','until','title','moby score','results per page','include add-ons','add-ons','addons',
    'nsfw','released games only','display settings','icons','hotkeys','perspective','theme',
    'mode','setting','chart','companies','company','platforms','platform','genres','genre',
    'game groups','game group','group','groups','attributes','attribute','release date',
    'developer','developers','publisher','publishers','rating','ratings','price','tags',
    'platform list','company list','genre list','group list','attribute list'
  ]);
  // Genre words — common on store/db pages as their own links/badges.
  const GENRE_WORDS = new Set([
    'shooter','adventure','action','rpg','role-playing','role playing','action-adventure',
    'strategy','puzzle','racing','simulation','sports','fighting','platformer','platform',
    'indie','casual','arcade','horror','mmo','mmorpg','moba','battle royale','sandbox',
    'open world','open-world','stealth','survival','hack and slash','metroidvania',
    'visual novel','point-and-click','point and click','roguelike','roguelite','tactical',
    'turn-based','real-time','rts','fps','tps','beat em up','beat ’em up'
  ]);
  const PLATFORMS = new Set([
    'pc','dos','win','windows','mac','macos','osx','linux','steam','steamos',
    'ps','ps1','ps2','ps3','ps4','ps5','psx','psp','vita','psvita','playstation',
    'xbox','x360','xone','xsx','xss','xboxone','xbox360','xboxseriesx',
    'switch','nsw','wii','wiiu','3ds','ds','nds','gba','gb','gbc','n64','snes','nes','gamecube','gc',
    'dreamcast','saturn','genesis','megadrive','sega','android','ios','ipad','iphone','mobile',
    'arcade','amiga','atari','c64','vr','oculus','quest','nintendo',
    // multi-word platform names (spaces/punctuation stripped before lookup)
    'playstation1','playstation2','playstation3','playstation4','playstation5','playstationvita',
    'xboxseriess','xboxseries','nintendoswitch','nintendo64','nintendo3ds','nintendods',
    'nintendowii','nintendowiiu','newnintendo3ds','segagenesis','segasaturn','segadreamcast'
  ]);
  const PURE_NUM_RX   = /^[\s\d.,:/%$#@&*()+\-–—_]+$/;
  const HAS_LETTER_RX = /[a-zA-Z]/;
  const DATE_RX = /^(?:\d{4}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,4}(?:,?\s*\d{4})?)$/i;
  const SCORE_RX = /^(?:\d+(?:\.\d+)?\s*(?:\/\s*\d+|%|stars?|pts?|points?|out of\s*\d+)|metascore.*|score:?.*|rating:?.*)$/i;
  const COMPANY_RX = /\b(?:inc|ltd|llc|co|corp|gmbh|s\.?a\.?|studios?|games|interactive|entertainment|software|productions?|epd|team|limited|publishing|media|technologies|technology)\b\.?$/i;

  function isExcluded(text) {
    if (!text) return true;
    const t = text.trim();
    if (t.length < 2 || t.length > 80) return true;       // too short / sentence-length
    if (!HAS_LETTER_RX.test(t)) return true;              // no letters at all
    if (PURE_NUM_RX.test(t)) return true;                 // numbers / symbols only
    const words = t.split(/\s+/);
    if (words.length > 12) return true;                   // likely a sentence/paragraph
    const lower = t.toLowerCase();
    if (UI_WORDS.has(lower)) return true;
    if (GENRE_WORDS.has(lower)) return true;
    if (PLATFORMS.has(lower.replace(/[^a-z0-9]/g, ''))) return true;
    if (/^all\s/i.test(t)) return true;                   // "All Platforms", "All Companies"...
    if (/list$/i.test(lower)) return true;                // "platform list", "genre list"...
    if (t.endsWith(':')) return true;                     // labels: "Release date:", "Genres:"
    if (DATE_RX.test(t)) return true;
    if (SCORE_RX.test(t)) return true;
    if (COMPANY_RX.test(t)) return true;                  // ends with a company suffix
    // gibberish: letters must be a reasonable share of the string
    const letters = (t.match(/[a-zA-Z]/g) || []).length;
    if (letters / t.length < 0.4) return true;
    return false;
  }

  function candidateText(el) {
    if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').trim();
    return (el.textContent || '').trim();
  }

  function placeMark(el, state) {
    const badge = document.createElement('span');
    badge.setAttribute('data-vc-mark', state);
    badge.textContent = MARK_GLYPH[state];
    badge.style.cssText = 'display:inline-block;margin-left:4px;font-weight:700;' +
      'font-size:12px;line-height:1;vertical-align:baseline;pointer-events:none;' +
      'color:' + MARK_COLOR[state] + ';';
    try {
      if (el.tagName === 'IMG') el.insertAdjacentElement('afterend', badge);
      else el.appendChild(badge);
    } catch (e) { return; }
    el.setAttribute('data-vc-scanned', state);
  }

  // Load the in-memory copy from the given stored object (or storage). Rebuilds
  // scanSeen so dedup reflects exactly what's stored — this is also how an
  // external change (e.g. Clear from the results page) is taken into account so
  // cleared entries are not resurrected, and re-detected games can be re-added.
  function applyStoredResults(r) {
    scanResults.inVault = Array.isArray(r && r.inVault) ? r.inVault : [];
    scanResults.completed = Array.isArray(r && r.completed) ? r.completed : [];
    scanResults.notInVault = Array.isArray(r && r.notInVault) ? r.notInVault : [];
    scanSeen = new Set();
    for (const arr of [scanResults.inVault, scanResults.completed, scanResults.notInVault]) {
      for (const e of arr) {
        const n = VM.normalize(e && e.name) || ((e && e.name) || '').toLowerCase();
        if (n) scanSeen.add(n);
      }
    }
  }

  async function loadScanResults() {
    if (scanResultsLoaded) return;
    scanResultsLoaded = true;
    try {
      const res = await storageGet([KEY_RESULTS]);
      if (res[KEY_RESULTS]) applyStoredResults(res[KEY_RESULTS]);
    } catch (e) { /* start empty */ }
  }

  function scheduleResultsWrite() {
    if (_scanWriteTimer) clearTimeout(_scanWriteTimer);
    _scanWriteTimer = setTimeout(() => {
      _scanWriteTimer = null;
      _lastWrittenTs = Date.now();
      storageSet({ [KEY_RESULTS]: {
        inVault: scanResults.inVault,
        completed: scanResults.completed,
        notInVault: scanResults.notInVault,
        updatedAt: _lastWrittenTs
      }}).catch(() => {});
    }, 500);
  }

  function collectResult(state, name, match, db) {
    const norm = VM.normalize(name) || name.toLowerCase();
    if (!norm || scanSeen.has(norm)) return;   // rolling dedup by normalize
    scanSeen.add(norm);
    const entry = { name: name, match: match || null, db: db || '', url: location.href };
    const bucket = state === 'done' ? scanResults.completed
                 : state === 'hit'  ? scanResults.inVault
                 : scanResults.notInVault;
    bucket.push(entry);
    scheduleResultsWrite();
  }

  // True if the element sits inside a settings/filter/nav/sidebar region — those
  // never hold a game title, so we skip them wholesale.
  function inSkippedRegion(el) {
    let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      if (SKIP_TAGS.has(n.tagName)) return true;
      const role = (n.getAttribute && n.getAttribute('role')) || '';
      if (role && SKIP_ROLE_RX.test(role)) return true;
      n = n.parentElement;
    }
    return false;
  }

  // Mark only the innermost title element: skip containers that themselves hold
  // another candidate (the inner one is the real title).
  function isLeafCandidate(el) {
    try { return !el.querySelector(SCAN_SELECTOR); } catch (e) { return true; }
  }

  function processEl(el) {
    if (!el || el.nodeType !== 1 || el.hasAttribute('data-vc-scanned')) return;
    const idx = ensureIndex();
    if (!idx) return;   // vault not ready yet — leave unscanned for a later pass
    if (inSkippedRegion(el) || !isLeafCandidate(el)) { el.setAttribute('data-vc-scanned', 'skip'); return; }
    const text = candidateText(el);
    if (isExcluded(text)) { el.setAttribute('data-vc-scanned', 'skip'); return; }
    const clean = VM.cleanGameName(text);
    if (!clean || isExcluded(clean)) { el.setAttribute('data-vc-scanned', 'skip'); return; }
    const m = idx.matchOne(clean, true, getThreshold());
    let state, matchName = null, db = '';
    if (!m) {
      state = 'miss';
    } else {
      matchName = m.item.name;
      const rawNorm = VM.normalize(m.item._raw || m.item.name);
      state = playedSet.has(rawNorm) ? 'done' : 'hit';
      db = (vaultData && vaultData.dbMap && vaultData.dbMap[rawNorm]) || '';
    }
    placeMark(el, state);
    collectResult(state, clean, matchName, db);
  }

  function onIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      if (io) io.unobserve(el);
      processEl(el);
    }
  }

  function observeCandidates(root) {
    if (!io) return;
    let els;
    try { els = (root || document).querySelectorAll(SCAN_SELECTOR); } catch (e) { return; }
    for (const el of els) {
      if (el.hasAttribute && el.hasAttribute('data-vc-scanned')) continue;
      if (inSkippedRegion(el)) continue;   // don't observe nav/aside/form regions
      io.observe(el);
    }
  }

  function onMutations(muts) {
    for (const mu of muts) {
      for (const node of mu.addedNodes) {
        if (!node || node.nodeType !== 1) continue;
        if (node.matches && node.matches(SCAN_SELECTOR) && !node.hasAttribute('data-vc-scanned')) {
          if (io) io.observe(node);
        }
        observeCandidates(node);
      }
    }
  }

  async function scanEnable() {
    if (scanOn) return;
    scanOn = true;
    await loadScanResults();
    if (!scanOn) return;   // toggled off again while loading
    io = new IntersectionObserver(onIntersect, { rootMargin: '120px 0px' });
    observeCandidates(document);
    mo = new MutationObserver(onMutations);
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }

  function removeAllMarks() {
    try {
      document.querySelectorAll('[data-vc-mark]').forEach((b) => b.remove());
      document.querySelectorAll('[data-vc-scanned]').forEach((el) => el.removeAttribute('data-vc-scanned'));
    } catch (e) { /* ignore */ }
  }

  function scanDisable() {
    if (!scanOn) return;
    scanOn = false;
    if (io) { io.disconnect(); io = null; }
    if (mo) { mo.disconnect(); mo = null; }
    removeAllMarks();   // visual cleanup only — scanResults storage is preserved
  }

  /* ─── Events ──────────────────────────────────────────────────── */
  // Stable handler refs so they can be detached when the toggle goes OFF.
  const onMouseUp = () => setTimeout(checkSelection, 0);
  const onKeyDown = (e) => { if (e.key === 'Escape') hidePanel(); };

  // Attach selection detection only while enabled — fully inert otherwise.
  function enable() {
    if (listenersOn) return;
    listenersOn = true;
    loadScanResults();   // so manual selections collect into the shared store
    document.addEventListener('selectionchange', debouncedCheck, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', hidePanel, true);
    window.addEventListener('resize', hidePanel, true);
  }
  function disable() {
    if (!listenersOn) return;
    listenersOn = false;
    document.removeEventListener('selectionchange', debouncedCheck, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', hidePanel, true);
    window.removeEventListener('resize', hidePanel, true);
    hidePanel();
  }

  // Passive flip listener — the only thing alive while OFF.
  if (STORAGE_NS && STORAGE_NS.onChanged && STORAGE_NS.onChanged.addListener) {
    STORAGE_NS.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (KEY_ENABLED in changes) {
        enabled = changes[KEY_ENABLED].newValue === true;
        if (enabled) enable(); else disable();
      }
      if (KEY_AUTOSCAN in changes) {
        autoScan = changes[KEY_AUTOSCAN].newValue === true;
        if (autoScan) scanEnable(); else scanDisable();
      }
      if (KEY_DATA in changes) {
        vaultData = changes[KEY_DATA].newValue || null;
        index = null;
        playedSet = new Set((vaultData && vaultData.playedNorms) || []);
        // Vault (re)synced — re-observe so far-unscanned candidates get evaluated.
        if (scanOn) observeCandidates(document);
      }
      // Results changed elsewhere (e.g. Clear from the results page, or another
      // tab). Refresh our in-memory copy so we don't resurrect cleared entries.
      // Skip our own write (matched by updatedAt) to avoid clobbering pending data.
      if (KEY_RESULTS in changes && scanResultsLoaded) {
        const nv = changes[KEY_RESULTS].newValue;
        if (!nv || nv.updatedAt !== _lastWrittenTs) applyStoredResults(nv || {});
      }
    });
  }

  loadState().then(() => {
    if (enabled) enable();
    if (autoScan) scanEnable();
  });
})();
