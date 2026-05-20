import { describe, test, expect, beforeEach, vi } from 'vitest';

// ── Verbatim copy from game-vault.html <script> ──────────────────────────────
// game-vault.html is not a module and cannot be imported; functions are
// reproduced here so they can be tested without modifying the source file.

const ROMAN = {
  'i':'1','ii':'2','iii':'3','iv':'4','v':'5','vi':'6','vii':'7','viii':'8','ix':'9',
  'x':'10','xi':'11','xii':'12','xiii':'13','xiv':'14','xv':'15','xvi':'16','xvii':'17','xviii':'18','xix':'19','xx':'20'
};

const EDITION_RX = new RegExp(
  '\\b(' + [
    'definitive edition','definitive',
    'remastered','remaster',
    'complete edition','complete',
    'game of the year edition','game of the year','goty edition','goty',
    'deluxe edition','deluxe',
    'ultimate edition','ultimate',
    'gold edition','gold',
    'enhanced edition','enhanced',
    'hd remaster','hd collection','hd',
    'special edition','special',
    'collectors edition','collector edition','collectors','collector',
    'anniversary edition','anniversary',
    'directors cut','director cut',
    'extended edition','extended',
    'platinum edition','platinum',
    'season pass','all dlc',
    'standard edition','standard',
    'redux','reloaded','revisited','reborn',
    'game of the year','goty'
  ].join('|') + ')\\b', 'g');

const YEAR_RX        = /\b(19|20)\d{2}\b/g;
const YEAR_DETECT_RX = /\b(19[7-9]\d|20[0-2]\d|2030)\b/g;
const PLAYTIME_RX    = /\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi;
const PAREN_RX       = /\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g;
const APOSTROPHE_RX  = /[‘’‚‛'`´]/g;
const NON_ALPHANUM_RX = /[^a-z0-9\s]/g;
const ROMAN_RX       = /\b([ivx]+)\b/g;
const TM_RX          = /[®™©]/g;
const WS_RX          = /\s+/g;

function _stripPlaytimeAfterYear(s) {
  YEAR_DETECT_RX.lastIndex = 0;
  let end = -1, m;
  while ((m = YEAR_DETECT_RX.exec(s)) !== null) end = m.index + m[0].length;
  YEAR_DETECT_RX.lastIndex = 0;
  if (end === -1) return s;
  return s.slice(0, end) + s.slice(end).replace(PLAYTIME_RX, ' ');
}

function normalize(str) {
  if (!str) return '';
  let s = str.toLowerCase();
  s = s.replace(APOSTROPHE_RX, '');
  s = s.replace(TM_RX, ' ');
  s = s.replace(PAREN_RX, ' ');
  s = _stripPlaytimeAfterYear(s);
  s = s.replace(NON_ALPHANUM_RX, ' ');
  s = s.replace(YEAR_RX, ' ');
  s = s.replace(EDITION_RX, ' ');
  s = s.replace(ROMAN_RX, (m) => ROMAN[m] !== undefined ? ROMAN[m] : m);
  s = s.replace(WS_RX, ' ').trim();
  return s;
}

function normalizeDedup(str) {
  if (!str) return '';
  let s = str.toLowerCase();
  s = s.replace(APOSTROPHE_RX, '');
  s = s.replace(TM_RX, ' ');
  s = s.replace(PAREN_RX, ' ');
  s = _stripPlaytimeAfterYear(s);
  s = s.replace(NON_ALPHANUM_RX, ' ');
  s = s.replace(ROMAN_RX, (m) => ROMAN[m] !== undefined ? ROMAN[m] : m);
  s = s.replace(WS_RX, ' ').trim();
  return s;
}

function tokenSort(str) {
  const n = normalize(str);
  if (!n) return '';
  return n.split(' ').filter(Boolean).sort().join(' ');
}

const _levBufA = new Uint16Array(512);
const _levBufB = new Uint16Array(512);

function levenshtein(a, b, maxDist) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  if (a.length > b.length) { const t = a; a = b; b = t; }
  const al = a.length, bl = b.length;
  if (maxDist !== undefined && bl - al > maxDist) return maxDist + 1;
  const cap = bl + 1;
  let prev = cap <= 512 ? _levBufA : new Uint16Array(cap);
  let curr = cap <= 512 ? _levBufB : new Uint16Array(cap);
  for (let i = 0; i <= bl; i++) prev[i] = i;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let minRow = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      const d = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      const v = d < ins ? (d < sub ? d : sub) : (ins < sub ? ins : sub);
      curr[j] = v;
      if (v < minRow) minRow = v;
    }
    if (maxDist !== undefined && minRow > maxDist) return maxDist + 1;
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[bl];
}

function stringSim(a, b, threshold) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = a.length > b.length ? a.length : b.length;
  const minLen = a.length < b.length ? a.length : b.length;
  if (minLen / maxLen < 0.5) return 0;
  const t = threshold || 0.5;
  const maxDist = Math.floor(maxLen * (1 - t));
  const dist = levenshtein(a, b, maxDist);
  if (dist > maxDist) return 0;
  return 1 - dist / maxLen;
}

class SearchIndex {
  constructor() {
    this.items = [];
    this.byId = new Map();
    this.byNorm = new Map();
    this.byTokenSort = new Map();
    this.dups = new Map();
    this.trigrams = new Map();
    this.tokens = new Map();
    this.acronyms = new Map();
    this.tokenList = null;
    this._tokensDirty = true;
  }

  static getTrigrams(str) {
    if (!str || str.length < 2) return [];
    const padded = '  ' + str + '  ';
    const out = [];
    const seen = new Set();
    for (let i = 0; i <= padded.length - 3; i++) {
      const tg = padded.slice(i, i + 3);
      if (!seen.has(tg)) { seen.add(tg); out.push(tg); }
    }
    return out;
  }

  static getTokens(str) {
    if (!str) return [];
    return str.split(' ').filter(Boolean);
  }

  static getAcronym(tokens) {
    if (tokens.length < 2) return '';
    let s = '';
    for (let i = 0; i < tokens.length; i++) {
      const c = tokens[i][0];
      if (c) s += c;
    }
    return s;
  }

  add(item) {
    if (item._norm === undefined) item._norm = normalize(item.name);
    if (item._ts === undefined) item._ts = tokenSort(item.name);
    if (item._lower === undefined) item._lower = item.name.toLowerCase();
    const id = item.id;
    if (this.byId.has(id)) return;
    this.items.push(item);
    this.byId.set(id, item);
    const norm = item._norm;
    if (norm) {
      if (!this.byNorm.has(norm)) this.byNorm.set(norm, item);
      let g = this.dups.get(norm);
      if (!g) { g = []; this.dups.set(norm, g); }
      g.push(item);
    }
    const ts = item._ts;
    if (ts && !this.byTokenSort.has(ts)) this.byTokenSort.set(ts, item);
    for (const tg of SearchIndex.getTrigrams(norm)) {
      let s = this.trigrams.get(tg);
      if (!s) { s = new Set(); this.trigrams.set(tg, s); }
      s.add(id);
    }
    const tokens = SearchIndex.getTokens(norm);
    for (const tk of tokens) {
      let s = this.tokens.get(tk);
      if (!s) { s = new Set(); this.tokens.set(tk, s); }
      s.add(id);
    }
    this._tokensDirty = true;
    if (tokens.length >= 2) {
      const acr = SearchIndex.getAcronym(tokens);
      if (acr.length >= 2 && acr.length <= 8) {
        let s = this.acronyms.get(acr);
        if (!s) { s = new Set(); this.acronyms.set(acr, s); }
        s.add(id);
      }
    }
  }

  remove(item) {
    const id = item.id;
    if (!this.byId.has(id)) return;
    const idx = this.items.indexOf(item);
    if (idx >= 0) this.items.splice(idx, 1);
    this.byId.delete(id);
    const norm = item._norm;
    if (norm) {
      const g = this.dups.get(norm);
      if (g) {
        const di = g.indexOf(item);
        if (di >= 0) g.splice(di, 1);
        if (g.length === 0) {
          this.dups.delete(norm);
          this.byNorm.delete(norm);
        } else if (this.byNorm.get(norm) === item) {
          this.byNorm.set(norm, g[0]);
        }
      }
    }
    const ts = item._ts;
    if (ts && this.byTokenSort.get(ts) === item) {
      this.byTokenSort.delete(ts);
      for (const it of this.items) {
        if (it._ts === ts) { this.byTokenSort.set(ts, it); break; }
      }
    }
    for (const tg of SearchIndex.getTrigrams(norm)) {
      const s = this.trigrams.get(tg);
      if (s) { s.delete(id); if (!s.size) this.trigrams.delete(tg); }
    }
    const tokens = SearchIndex.getTokens(norm);
    for (const tk of tokens) {
      const s = this.tokens.get(tk);
      if (s) { s.delete(id); if (!s.size) this.tokens.delete(tk); }
    }
    this._tokensDirty = true;
    if (tokens.length >= 2) {
      const acr = SearchIndex.getAcronym(tokens);
      if (acr.length >= 2 && acr.length <= 8) {
        const s = this.acronyms.get(acr);
        if (s) { s.delete(id); if (!s.size) this.acronyms.delete(acr); }
      }
    }
  }

  clear() {
    this.items = [];
    this.byId.clear();
    this.byNorm.clear();
    this.byTokenSort.clear();
    this.dups.clear();
    this.trigrams.clear();
    this.tokens.clear();
    this.acronyms.clear();
    this._tokensDirty = true;
  }

  getCandidates(norm, limit) {
    const tgs = SearchIndex.getTrigrams(norm);
    if (tgs.length === 0) return [];
    const counts = new Map();
    for (const tg of tgs) {
      const s = this.trigrams.get(tg);
      if (!s) continue;
      for (const id of s) counts.set(id, (counts.get(id) || 0) + 1);
    }
    if (counts.size === 0) return [];
    const minHits = Math.max(1, Math.floor(tgs.length * 0.3));
    const filtered = [];
    for (const [id, c] of counts) {
      if (c >= minHits) filtered.push([id, c]);
    }
    filtered.sort((a, b) => b[1] - a[1]);
    const lim = Math.min(limit || 200, filtered.length);
    const out = new Array(lim);
    for (let i = 0; i < lim; i++) out[i] = this.byId.get(filtered[i][0]);
    return out;
  }

  matchOne(query, useFuzzy = true, threshold = 0.82) {
    const norm = normalize(query);
    if (!norm) return null;
    if (this.byNorm.has(norm)) {
      return { item: this.byNorm.get(norm), score: 1, type: 'exact' };
    }
    const ts = tokenSort(query);
    if (ts && this.byTokenSort.has(ts)) {
      return { item: this.byTokenSort.get(ts), score: 0.97, type: 'token-sort' };
    }
    if (norm.length >= 2 && norm.length <= 8 && norm.indexOf(' ') === -1) {
      const acrSet = this.acronyms.get(norm);
      if (acrSet && acrSet.size === 1) {
        const id = acrSet.values().next().value;
        const item = this.byId.get(id);
        if (item) return { item, score: 0.92, type: 'acronym' };
      }
    }
    if (!useFuzzy) return null;
    const candidates = this.getCandidates(norm, 200);
    let best = null;
    for (let i = 0; i < candidates.length; i++) {
      const it = candidates[i];
      const sim = stringSim(norm, it._norm, threshold);
      if (sim >= threshold && (!best || sim > best.score)) {
        best = { item: it, score: sim, type: 'fuzzy' };
        if (sim >= 0.99) break;
      }
    }
    return best;
  }

  search(query, opts) {
    opts = opts || {};
    const limit = opts.limit || 500;
    const norm = normalize(query);
    const lower = query.toLowerCase().trim();
    if (!norm && !lower) return [];
    const seen = new Set();
    const out = [];
    const push = (item, score, why) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      out.push({ item, score, why });
    };
    if (norm && this.byNorm.has(norm)) push(this.byNorm.get(norm), 1000, 'exact');
    if (norm) {
      const ts = tokenSort(query);
      if (ts && this.byTokenSort.has(ts)) push(this.byTokenSort.get(ts), 950, 'reorder');
    }
    if (lower) {
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        const idx = it._lower.indexOf(lower);
        if (idx === 0) push(it, 900, 'starts-with');
        else if (idx > 0) push(it, 700 - idx, 'contains');
      }
    }
    if (norm && norm !== lower) {
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        if (seen.has(it.id)) continue;
        const idx = it._norm.indexOf(norm);
        if (idx === 0) push(it, 600, 'norm-starts');
        else if (idx > 0) push(it, 500 - idx, 'norm-contains');
      }
    }
    if (norm && norm.length >= 2 && norm.length <= 8 && norm.indexOf(' ') === -1) {
      const set = this.acronyms.get(norm);
      if (set) {
        for (const id of set) {
          const it = this.byId.get(id);
          if (it) push(it, 450, 'acronym');
        }
      }
    }
    if (norm && norm.indexOf(' ') === -1 && norm.length >= 2 && out.length < limit) {
      for (const [tk, ids] of this.tokens) {
        if (tk.length > norm.length && tk.startsWith(norm)) {
          for (const id of ids) {
            const it = this.byId.get(id);
            if (it) push(it, 400, 'token-prefix');
            if (out.length >= limit) break;
          }
          if (out.length >= limit) break;
        }
      }
    }
    if (out.length < 30 && norm && norm.length >= 3) {
      const candidates = this.getCandidates(norm, 80);
      for (const it of candidates) {
        if (seen.has(it.id)) continue;
        const sim = stringSim(norm, it._norm, 0.6);
        if (sim >= 0.6) push(it, 100 + Math.floor(sim * 100), 'fuzzy');
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }
}

// ── Stubs for bulkAdd ────────────────────────────────────────────────────────

let state = { vault: [], played: [], vIndex: null, pIndex: null, customLists: {} };
let _idCounter = 0;
function newId() { return 'g_test_' + (++_idCounter); }
function scheduleSave() {}
function scheduleCustomSave() {}

function resolveTarget(target) {
  if (target === 'vault') {
    return { kind: 'vault', id: 'vault', name: 'Vault',
             items: state.vault, idx: state.vIndex, save: () => scheduleSave('vault') };
  }
  if (target === 'played') {
    return { kind: 'played', id: 'played', name: 'Played',
             items: state.played, idx: state.pIndex, save: () => scheduleSave('played') };
  }
  if (typeof target === 'string' && target.startsWith('cl-')) {
    const id = target.slice(3);
    const list = state.customLists[id];
    if (!list) return null;
    return { kind: 'custom', id, name: list.name,
             items: list.items, idx: list.index, save: () => scheduleCustomSave(id) };
  }
  return null;
}

function bulkAdd(names, target = 'vault', { dedupe = true, keepDupes = false } = {}) {
  const t = resolveTarget(target);
  if (!t) return { added: 0, addedItems: [], skipped: [], flagged: [], duplicates: [] };
  const idx = t.idx;
  const seenDedup = new Map();
  const addedItems = [];
  const skipped = [];
  const flagged = [];
  const duplicates = [];

  const detectDups = dedupe || keepDupes;

  for (const raw of names) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const nd = normalizeDedup(trimmed);
    const n  = normalize(trimmed);

    let exactDup = null;
    if (detectDups && nd) {
      if (seenDedup.has(nd)) {
        exactDup = seenDedup.get(nd);
      } else if (n && idx.byNorm.has(n)) {
        const cand = idx.byNorm.get(n);
        if (normalizeDedup(cand.name) === nd) exactDup = cand;
        else {
          const group = idx.dups.get(n);
          if (group) {
            for (const it of group) {
              if (normalizeDedup(it.name) === nd) { exactDup = it; break; }
            }
          }
        }
      }
    }

    if (exactDup) {
      duplicates.push({ input: trimmed, existing: exactDup });
      if (!keepDupes) {
        skipped.push({ input: trimmed, existing: exactDup });
        continue;
      }
    }

    const item = { id: newId(), name: trimmed, dateAdded: Date.now() + addedItems.length };
    item._norm = n;
    item._ts = tokenSort(trimmed);
    t.items.push(item);
    idx.add(item);
    if (nd) seenDedup.set(nd, item);
    addedItems.push(item);

    if (n) {
      const group = idx.dups.get(n);
      if (group && group.length > 1) {
        const neighbors = [];
        for (const other of group) {
          if (other.id === item.id) continue;
          if (normalizeDedup(other.name) !== nd) neighbors.push(other);
        }
        if (neighbors.length) flagged.push({ item, neighbors });
      }
    }
  }

  t.save();
  return { added: addedItems.length, addedItems, skipped, flagged, duplicates };
}

// ── Startup cleanup helper (verbatim copy) ─────────────────────────────────
function cleanItemNamesInPlace(arr) {
  let n = 0;
  for (const it of arr) {
    const cleaned = it.name.replace(/[�◇]/g, "'");
    if (cleaned !== it.name) { it.name = cleaned; n++; }
  }
  return n;
}

// ── Bulk-check input duplicate helpers (verbatim copies) ────────────────────
function extractInputDupGroups(lines) {
  const map = new Map();
  for (let i = 0; i < lines.length; i++) {
    const n = normalize(lines[i]);
    if (!n) continue;
    let g = map.get(n);
    if (!g) { g = { norm: n, lines: [], indices: [] }; map.set(n, g); }
    g.lines.push(lines[i]);
    g.indices.push(i);
  }
  const out = [];
  for (const g of map.values()) if (g.lines.length >= 2) out.push(g);
  return out;
}
function applyInputDups(lines, decisions) {
  const groups = extractInputDupGroups(lines);
  const removeIdx = new Set();
  for (const g of groups) {
    if (decisions.get(g.norm) !== 'merge') continue;
    for (let i = 1; i < g.indices.length; i++) removeIdx.add(g.indices[i]);
  }
  const kept = [];
  const removed = [];
  for (let i = 0; i < lines.length; i++) {
    if (removeIdx.has(i)) removed.push(lines[i]);
    else kept.push(lines[i]);
  }
  return { kept, removed };
}

// ── Duplicate-review helpers (verbatim copies) ──────────────────────────────
function findDuplicateGroups(arr) {
  const map = new Map();
  for (const it of arr) {
    const n = it._norm || normalize(it.name);
    if (!n) continue;
    let g = map.get(n);
    if (!g) { g = { norm: n, items: [] }; map.set(n, g); }
    g.items.push(it);
  }
  const out = [];
  for (const g of map.values()) if (g.items.length >= 2) out.push(g);
  return out;
}
function applyDupReview(arr, decisions) {
  const removeIds = new Set();
  const seenMerge = new Set();
  for (const it of arr) {
    const n = it._norm || normalize(it.name);
    if (!n) continue;
    if (decisions.get(n) !== 'merge') continue;
    if (seenMerge.has(n)) { removeIds.add(it); }
    else { seenMerge.add(n); }
  }
  const kept = [];
  const removed = [];
  for (const it of arr) {
    if (removeIds.has(it)) removed.push(it); else kept.push(it);
  }
  return { kept, removed };
}

// ── PWA manifest builders (verbatim copies) ─────────────────────────────────
function buildPwaIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
    + '<rect width="512" height="512" rx="80" fill="#f5a623"/>'
    + '<text x="256" y="256" text-anchor="middle" dominant-baseline="central"'
    + ' font-family="Georgia,&apos;Times New Roman&apos;,serif" font-style="italic"'
    + ' font-size="280" fill="#ffffff">GV</text>'
    + '</svg>';
}
function buildPwaManifest(startUrl) {
  const iconData = 'data:image/svg+xml;base64,' + btoa(buildPwaIcon());
  return {
    name: 'Game Vault',
    short_name: 'Vault',
    start_url: startUrl || './',
    display: 'standalone',
    background_color: '#0a0a0b',
    theme_color: '#0a0a0b',
    icons: [{ src: iconData, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
  };
}
function pwaCanInstall(protocol) {
  return protocol === 'http:' || protocol === 'https:';
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildPwaIcon()', () => {
  test('returns a single <svg> root with viewBox 0 0 512 512', () => {
    const svg = buildPwaIcon();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="0 0 512 512"');
  });

  test('uses brand accent #f5a623 for background and white "GV" glyph', () => {
    const svg = buildPwaIcon();
    expect(svg).toContain('fill="#f5a623"');
    expect(svg).toContain('>GV<');
    expect(svg).toContain('fill="#ffffff"');
  });

  test('declares xmlns so manifest icons render outside a host doc', () => {
    expect(buildPwaIcon()).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

describe('buildPwaManifest()', () => {
  test('has Game Vault / Vault names and standalone display', () => {
    const m = buildPwaManifest('./');
    expect(m.name).toBe('Game Vault');
    expect(m.short_name).toBe('Vault');
    expect(m.display).toBe('standalone');
  });

  test('theme_color and background_color match --bg', () => {
    const m = buildPwaManifest('./');
    expect(m.theme_color).toBe('#0a0a0b');
    expect(m.background_color).toBe('#0a0a0b');
  });

  test('start_url defaults to "./" when not given', () => {
    expect(buildPwaManifest().start_url).toBe('./');
    expect(buildPwaManifest('').start_url).toBe('./');
  });

  test('icon is an SVG data URI with sizes "any" and purpose "any"', () => {
    const icon = buildPwaManifest('./').icons[0];
    expect(icon.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(icon.type).toBe('image/svg+xml');
    expect(icon.sizes).toBe('any');
    expect(icon.purpose).toBe('any');
  });

  test('manifest serializes to valid JSON', () => {
    const json = JSON.stringify(buildPwaManifest('./'));
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json).name).toBe('Game Vault');
  });
});

describe('pwaCanInstall()', () => {
  test('disables install on file:// protocol', () => {
    expect(pwaCanInstall('file:')).toBe(false);
  });

  test('enables on http and https', () => {
    expect(pwaCanInstall('http:')).toBe(true);
    expect(pwaCanInstall('https:')).toBe(true);
  });

  test('disables on unknown protocols (chrome-extension, blob, data)', () => {
    expect(pwaCanInstall('chrome-extension:')).toBe(false);
    expect(pwaCanInstall('blob:')).toBe(false);
    expect(pwaCanInstall('data:')).toBe(false);
  });
});

describe('normalize()', () => {
  test('strips year and edition: "Max Payne" equals "Max: Payne 2013 Definitive Edition"', () => {
    expect(normalize('Max Payne')).toBe(normalize('Max: Payne 2013 Definitive Edition'));
  });

  test('"Max Payne" does NOT equal "Max Payne 2"', () => {
    expect(normalize('Max Payne')).not.toBe(normalize('Max Payne 2'));
  });
});

describe('normalizeDedup()', () => {
  test('"The Last of Us" does NOT equal "The Last of Us Remastered"', () => {
    expect(normalizeDedup('The Last of Us')).not.toBe(normalizeDedup('The Last of Us Remastered'));
  });
});

describe('SearchIndex.matchOne()', () => {
  test('exact match returns score 1 and type "exact"', () => {
    const idx = new SearchIndex();
    idx.add({ id: 'g_1', name: 'The Witcher 3: Wild Hunt' });

    const result = idx.matchOne('The Witcher 3: Wild Hunt');

    expect(result).not.toBeNull();
    expect(result.score).toBe(1);
    expect(result.type).toBe('exact');
  });

  test('acronym "CSGO" matches "Counter-Strike: Global Offensive"', () => {
    const idx = new SearchIndex();
    idx.add({ id: 'g_2', name: 'Counter-Strike: Global Offensive' });

    const result = idx.matchOne('CSGO');

    expect(result).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.type).toBe('acronym');
    expect(result.item.name).toBe('Counter-Strike: Global Offensive');
  });
});

describe('bulkAdd()', () => {
  beforeEach(() => {
    _idCounter = 0;
    state = { vault: [], played: [], vIndex: new SearchIndex(), pIndex: new SearchIndex(), customLists: {} };
  });

  test('exact duplicate is skipped, not added', () => {
    bulkAdd(['Max Payne']);
    const result = bulkAdd(['Max Payne']);

    expect(result.added).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].input).toBe('Max Payne');
  });

  test('edition variant is added but flagged as a near-match', () => {
    bulkAdd(['Max Payne']);
    const result = bulkAdd(['Max Payne: Definitive Edition']);

    expect(result.added).toBe(1);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].item.name).toBe('Max Payne: Definitive Edition');
    expect(result.skipped).toHaveLength(0);
  });
});

describe('resolveTarget', () => {
  beforeEach(() => {
    _idCounter = 0;
    state = { vault: [], played: [], vIndex: new SearchIndex(), pIndex: new SearchIndex(), customLists: {} };
  });

  test('vault returns vault arrays', () => {
    const t = resolveTarget('vault');
    expect(t.kind).toBe('vault');
    expect(t.items).toBe(state.vault);
    expect(t.idx).toBe(state.vIndex);
  });

  test('played returns played arrays', () => {
    const t = resolveTarget('played');
    expect(t.kind).toBe('played');
    expect(t.items).toBe(state.played);
    expect(t.idx).toBe(state.pIndex);
  });

  test('cl-<id> for known id returns the custom list', () => {
    state.customLists.ps5 = { id: 'ps5', name: 'PS5', items: [], index: new SearchIndex() };
    const t = resolveTarget('cl-ps5');
    expect(t.kind).toBe('custom');
    expect(t.id).toBe('ps5');
    expect(t.name).toBe('PS5');
    expect(t.items).toBe(state.customLists.ps5.items);
    expect(t.idx).toBe(state.customLists.ps5.index);
  });

  test('cl-<id> for unknown id returns null', () => {
    expect(resolveTarget('cl-nonexistent')).toBeNull();
  });

  test('garbage targets return null', () => {
    expect(resolveTarget('')).toBeNull();
    expect(resolveTarget('foo')).toBeNull();
    expect(resolveTarget(null)).toBeNull();
    expect(resolveTarget(undefined)).toBeNull();
    expect(resolveTarget(42)).toBeNull();
  });

  test('save callback fires for vault', () => {
    let called = null;
    const orig = scheduleSave;
    // eslint-disable-next-line no-global-assign
    scheduleSave = (n) => { called = n; };
    try { resolveTarget('vault').save(); }
    finally { scheduleSave = orig; }
    expect(called).toBe('vault');
  });
});

describe('bulkAdd to custom target', () => {
  beforeEach(() => {
    _idCounter = 0;
    state = { vault: [], played: [], vIndex: new SearchIndex(), pIndex: new SearchIndex(), customLists: {} };
    state.customLists.ps5 = { id: 'ps5', name: 'PS5', items: [], index: new SearchIndex() };
  });

  test('adds items to the custom list, not vault/played', () => {
    const r = bulkAdd(['Bloodborne', 'Demon Souls'], 'cl-ps5');
    expect(r.added).toBe(2);
    expect(state.customLists.ps5.items).toHaveLength(2);
    expect(state.vault).toHaveLength(0);
    expect(state.played).toHaveLength(0);
  });

  test('dedup applies within the custom list only', () => {
    bulkAdd(['Bloodborne'], 'cl-ps5');
    bulkAdd(['Bloodborne'], 'vault'); // not a dup against PS5 list
    const r = bulkAdd(['Bloodborne'], 'cl-ps5');
    expect(r.added).toBe(0);
    expect(r.skipped).toHaveLength(1);
    expect(state.vault).toHaveLength(1);
    expect(state.customLists.ps5.items).toHaveLength(1);
  });

  test('unknown custom id returns empty result, no throw', () => {
    const r = bulkAdd(['Anything'], 'cl-zzz');
    expect(r.added).toBe(0);
    expect(r.addedItems).toEqual([]);
    expect(state.vault).toHaveLength(0);
  });
});

describe('findDuplicateGroups()', () => {
  test('empty array returns []', () => {
    expect(findDuplicateGroups([])).toEqual([]);
  });

  test('no duplicates returns []', () => {
    const arr = [
      { id: '1', name: 'Max Payne' },
      { id: '2', name: 'The Witcher 3' },
    ];
    expect(findDuplicateGroups(arr)).toEqual([]);
  });

  test('one group of two items', () => {
    const arr = [
      { id: '1', name: 'Max Payne' },
      { id: '2', name: 'MAX PAYNE (2001)' },
    ];
    const groups = findDuplicateGroups(arr);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].items[0].id).toBe('1');
    expect(groups[0].items[1].id).toBe('2');
  });

  test('two separate groups, singletons excluded', () => {
    const arr = [
      { id: '1', name: 'Max Payne' },
      { id: '2', name: 'The Witcher 3' },
      { id: '3', name: 'Max Payne 2001' },
      { id: '4', name: 'The Witcher III' },
      { id: '5', name: 'Hades' },
    ];
    const groups = findDuplicateGroups(arr);
    expect(groups).toHaveLength(2);
    const sizes = groups.map(g => g.items.length).sort();
    expect(sizes).toEqual([2, 2]);
  });

  test('items with empty norm are skipped (never grouped)', () => {
    const arr = [
      { id: '1', name: '' },
      { id: '2', name: '   ' },
      { id: '3', name: '!!!' },
      { id: '4', name: 'Max Payne' },
      { id: '5', name: 'Max Payne' },
    ];
    const groups = findDuplicateGroups(arr);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(i => i.id)).toEqual(['4', '5']);
  });

  test('preserves insertion order within a group', () => {
    const arr = [
      { id: 'a', name: 'Max Payne (2001)' },
      { id: 'b', name: 'Max Payne' },
      { id: 'c', name: 'MAX PAYNE Definitive Edition' },
    ];
    const groups = findDuplicateGroups(arr);
    expect(groups[0].items.map(i => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('applyDupReview()', () => {
  test('all groups marked keep — array unchanged, removed empty', () => {
    const arr = [
      { id: '1', name: 'Max Payne' },
      { id: '2', name: 'Max Payne 2001' },
    ];
    const decisions = new Map([['max payne', 'keep']]);
    const { kept, removed } = applyDupReview(arr, decisions);
    expect(kept).toHaveLength(2);
    expect(removed).toHaveLength(0);
  });

  test('all groups marked merge — first kept, rest removed', () => {
    const arr = [
      { id: '1', name: 'Max Payne' },
      { id: '2', name: 'Max Payne 2001' },
      { id: '3', name: 'MAX PAYNE Definitive Edition' },
    ];
    const decisions = new Map([['max payne', 'merge']]);
    const { kept, removed } = applyDupReview(arr, decisions);
    expect(kept.map(i => i.id)).toEqual(['1']);
    expect(removed.map(i => i.id)).toEqual(['2', '3']);
  });

  test('mixed marks — only merge groups affected', () => {
    const arr = [
      { id: 'a1', name: 'Max Payne' },
      { id: 'a2', name: 'Max Payne (2001)' },
      { id: 'b1', name: 'Hades' },
      { id: 'b2', name: 'HADES' },
    ];
    const decisions = new Map([
      ['max payne', 'keep'],
      ['hades', 'merge'],
    ]);
    const { kept, removed } = applyDupReview(arr, decisions);
    expect(kept.map(i => i.id)).toEqual(['a1', 'a2', 'b1']);
    expect(removed.map(i => i.id)).toEqual(['b2']);
  });

  test('unmarked groups are treated as keep', () => {
    const arr = [
      { id: '1', name: 'Max Payne' },
      { id: '2', name: 'Max Payne 2001' },
    ];
    const { kept, removed } = applyDupReview(arr, new Map());
    expect(kept).toHaveLength(2);
    expect(removed).toHaveLength(0);
  });

  test('non-grouped items always preserved', () => {
    const arr = [
      { id: '1', name: 'Max Payne' },
      { id: '2', name: 'Max Payne 2001' },
      { id: '3', name: 'Hades' },
    ];
    const decisions = new Map([['max payne', 'merge']]);
    const { kept, removed } = applyDupReview(arr, decisions);
    expect(kept.map(i => i.id)).toEqual(['1', '3']);
    expect(removed.map(i => i.id)).toEqual(['2']);
  });

  test('preserves overall order of survivors', () => {
    const arr = [
      { id: 'a', name: 'Max Payne' },
      { id: 'b', name: 'Hades' },
      { id: 'c', name: 'Max Payne 2001' },
      { id: 'd', name: 'HADES (2020)' },
    ];
    const decisions = new Map([
      ['max payne', 'merge'],
      ['hades', 'merge'],
    ]);
    const { kept } = applyDupReview(arr, decisions);
    expect(kept.map(i => i.id)).toEqual(['a', 'b']);
  });
});

describe('cleanItemNamesInPlace()', () => {
  test('empty array returns 0', () => {
    expect(cleanItemNamesInPlace([])).toBe(0);
  });

  test('no broken chars returns 0 and does not mutate', () => {
    const arr = [{ name: "Aron's" }, { name: "Don't Starve" }, { name: 'Hades' }];
    const before = arr.map(x => x.name);
    expect(cleanItemNamesInPlace(arr)).toBe(0);
    expect(arr.map(x => x.name)).toEqual(before);
  });

  test('U+FFFD replacement char becomes apostrophe', () => {
    const arr = [{ name: 'Aron�s' }];
    expect(cleanItemNamesInPlace(arr)).toBe(1);
    expect(arr[0].name).toBe("Aron's");
  });

  test('U+25C7 white diamond becomes apostrophe', () => {
    const arr = [{ name: 'Don◇t' }];
    expect(cleanItemNamesInPlace(arr)).toBe(1);
    expect(arr[0].name).toBe("Don't");
  });

  test('mixed broken and clean items — count matches changed only', () => {
    const arr = [
      { name: "Aron's" },          // clean
      { name: 'Don�t' },      // broken
      { name: 'Hades' },           // clean
      { name: 'Foo◇s Bar' },  // broken
    ];
    expect(cleanItemNamesInPlace(arr)).toBe(2);
    expect(arr[0].name).toBe("Aron's");
    expect(arr[1].name).toBe("Don't");
    expect(arr[2].name).toBe('Hades');
    expect(arr[3].name).toBe("Foo's Bar");
  });

  test('both broken chars in same name are replaced in one pass', () => {
    const arr = [{ name: 'It�s the dev◇s game' }];
    expect(cleanItemNamesInPlace(arr)).toBe(1);
    expect(arr[0].name).toBe("It's the dev's game");
  });

  test('idempotent — second run on cleaned array returns 0', () => {
    const arr = [{ name: 'Aron�s' }, { name: 'Hades' }];
    cleanItemNamesInPlace(arr);
    expect(cleanItemNamesInPlace(arr)).toBe(0);
  });
});

describe('extractInputDupGroups()', () => {
  test('empty array returns []', () => {
    expect(extractInputDupGroups([])).toEqual([]);
  });

  test('no duplicates returns []', () => {
    const lines = ['Max Payne', 'Hades', 'The Witcher 3'];
    expect(extractInputDupGroups(lines)).toEqual([]);
  });

  test('one group of three with normalized variants', () => {
    const lines = ['Max Payne', 'MAX PAYNE (2001)', 'max payne: definitive edition'];
    const groups = extractInputDupGroups(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(3);
    expect(groups[0].indices).toEqual([0, 1, 2]);
  });

  test('multiple groups, insertion order preserved', () => {
    const lines = [
      'Max Payne',     // 0
      'Hades',         // 1
      'Max Payne 2001',// 2
      'Aron',          // 3 (singleton, ignored)
      'HADES',         // 4
    ];
    const groups = extractInputDupGroups(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0].indices).toEqual([0, 2]);
    expect(groups[1].indices).toEqual([1, 4]);
  });

  test('lines with empty norm are excluded', () => {
    const lines = ['', '   ', '!!!', 'Max Payne', 'Max Payne 2001'];
    const groups = extractInputDupGroups(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0].indices).toEqual([3, 4]);
  });

  test('indices reference original positions exactly', () => {
    const lines = ['a', 'Max Payne', 'b', 'MAX PAYNE', 'c'];
    const groups = extractInputDupGroups(lines);
    expect(groups[0].indices).toEqual([1, 3]);
    expect(groups[0].lines).toEqual(['Max Payne', 'MAX PAYNE']);
  });
});

describe('applyInputDups()', () => {
  test('all keep — input unchanged', () => {
    const lines = ['Max Payne', 'Max Payne 2001'];
    const decisions = new Map([['max payne', 'keep']]);
    const { kept, removed } = applyInputDups(lines, decisions);
    expect(kept).toEqual(['Max Payne', 'Max Payne 2001']);
    expect(removed).toEqual([]);
  });

  test('all merge — first kept per group, rest removed', () => {
    const lines = ['Max Payne', 'MAX PAYNE (2001)', 'max payne: definitive'];
    const decisions = new Map([['max payne', 'merge']]);
    const { kept, removed } = applyInputDups(lines, decisions);
    expect(kept).toEqual(['Max Payne']);
    expect(removed).toEqual(['MAX PAYNE (2001)', 'max payne: definitive']);
  });

  test('unmarked groups default to keep', () => {
    const lines = ['Max Payne', 'Max Payne 2001'];
    const { kept, removed } = applyInputDups(lines, new Map());
    expect(kept).toEqual(['Max Payne', 'Max Payne 2001']);
    expect(removed).toEqual([]);
  });

  test('mixed marks — only merge groups affected', () => {
    const lines = ['Max Payne', 'Max Payne 2001', 'Hades', 'HADES (2020)'];
    const decisions = new Map([
      ['max payne', 'keep'],
      ['hades', 'merge'],
    ]);
    const { kept, removed } = applyInputDups(lines, decisions);
    expect(kept).toEqual(['Max Payne', 'Max Payne 2001', 'Hades']);
    expect(removed).toEqual(['HADES (2020)']);
  });

  test('non-grouped lines preserved at their original positions', () => {
    const lines = ['intro', 'Max Payne', 'middle', 'Max Payne 2001', 'outro'];
    const decisions = new Map([['max payne', 'merge']]);
    const { kept, removed } = applyInputDups(lines, decisions);
    expect(kept).toEqual(['intro', 'Max Payne', 'middle', 'outro']);
    expect(removed).toEqual(['Max Payne 2001']);
  });

  test('empty/whitespace lines preserved (never removed)', () => {
    const lines = ['', 'Max Payne', '   ', 'Max Payne 2001', ''];
    const decisions = new Map([['max payne', 'merge']]);
    const { kept } = applyInputDups(lines, decisions);
    expect(kept).toEqual(['', 'Max Payne', '   ', '']);
  });
});

// ── Tag system helpers (verbatim from game-vault.html) ───────────────────────
const TAG_MAX_LEN = 24;
const TAG_RESERVED = new Set(['all']);
const TAG_ALLOWED_RX = /^[a-z0-9 _\-+]+$/;

function sanitizeTag(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed.length > TAG_MAX_LEN) return null;
  if (TAG_RESERVED.has(trimmed)) return null;
  if (!TAG_ALLOWED_RX.test(trimmed)) return null;
  return trimmed;
}

function addTagToItem(item, tag) {
  const t = sanitizeTag(tag);
  if (!t) return false;
  if (!Array.isArray(item.tags)) item.tags = [];
  if (item.tags.indexOf(t) !== -1) return false;
  item.tags.push(t);
  return true;
}

function removeTagFromItem(item, tag) {
  const t = sanitizeTag(tag);
  if (!t || !Array.isArray(item.tags)) return false;
  const i = item.tags.indexOf(t);
  if (i === -1) return false;
  item.tags.splice(i, 1);
  return true;
}

function renameTagInItems(items, oldName, newName) {
  const o = sanitizeTag(oldName);
  const n = sanitizeTag(newName);
  if (!o || !n || o === n) return 0;
  let changed = 0;
  for (const it of items) {
    if (!Array.isArray(it.tags)) continue;
    const i = it.tags.indexOf(o);
    if (i === -1) continue;
    if (it.tags.indexOf(n) !== -1) it.tags.splice(i, 1);
    else it.tags[i] = n;
    changed++;
  }
  return changed;
}

function mergeTagsInItems(items, source, target) {
  const s = sanitizeTag(source);
  const t = sanitizeTag(target);
  if (!s || !t || s === t) return 0;
  let changed = 0;
  for (const it of items) {
    if (!Array.isArray(it.tags)) continue;
    const si = it.tags.indexOf(s);
    if (si === -1) continue;
    if (it.tags.indexOf(t) === -1) it.tags[si] = t;
    else it.tags.splice(si, 1);
    changed++;
  }
  return changed;
}

function deleteTagFromItems(items, tag) {
  const t = sanitizeTag(tag);
  if (!t) return 0;
  let changed = 0;
  for (const it of items) {
    if (!Array.isArray(it.tags)) continue;
    const i = it.tags.indexOf(t);
    if (i === -1) continue;
    it.tags.splice(i, 1);
    changed++;
  }
  return changed;
}

function computeTagCounts(...lists) {
  const counts = new Map();
  for (const list of lists) {
    if (!list) continue;
    for (const it of list) {
      if (!Array.isArray(it.tags)) continue;
      for (const t of it.tags) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
  }
  return counts;
}

function filterByTagsAND(items, tagSet) {
  if (!tagSet || tagSet.size === 0) return items;
  const filters = [...tagSet];
  return items.filter(it => {
    if (!Array.isArray(it.tags) || it.tags.length === 0) return false;
    for (const t of filters) if (it.tags.indexOf(t) === -1) return false;
    return true;
  });
}

describe('sanitizeTag', () => {
  test('null/undefined/empty', () => {
    expect(sanitizeTag(null)).toBe(null);
    expect(sanitizeTag(undefined)).toBe(null);
    expect(sanitizeTag('')).toBe(null);
    expect(sanitizeTag('   ')).toBe(null);
  });
  test('lowercases', () => {
    expect(sanitizeTag('PS5')).toBe('ps5');
    expect(sanitizeTag('Single Player')).toBe('single player');
  });
  test('trims and collapses whitespace', () => {
    expect(sanitizeTag('  retro   game  ')).toBe('retro game');
  });
  test('rejects reserved word "all"', () => {
    expect(sanitizeTag('all')).toBe(null);
    expect(sanitizeTag('All')).toBe(null);
    expect(sanitizeTag('ALL ')).toBe(null);
  });
  test('rejects when over max length (24)', () => {
    expect(sanitizeTag('a'.repeat(24))).toBe('a'.repeat(24));
    expect(sanitizeTag('a'.repeat(25))).toBe(null);
  });
  test('rejects special chars', () => {
    expect(sanitizeTag('rpg/action')).toBe(null);
    expect(sanitizeTag('co-op!')).toBe(null);
    expect(sanitizeTag('100%')).toBe(null);
    expect(sanitizeTag('jrpg.classic')).toBe(null);
  });
  test('allows letters, digits, space, hyphen, underscore, plus', () => {
    expect(sanitizeTag('co-op')).toBe('co-op');
    expect(sanitizeTag('action_rpg')).toBe('action_rpg');
    expect(sanitizeTag('a+b')).toBe('a+b');
    expect(sanitizeTag('halo 4')).toBe('halo 4');
  });
});

describe('addTagToItem / removeTagFromItem', () => {
  test('adds tag, idempotent on dup', () => {
    const it = { tags: [] };
    expect(addTagToItem(it, 'PS5')).toBe(true);
    expect(it.tags).toEqual(['ps5']);
    expect(addTagToItem(it, 'ps5')).toBe(false);
    expect(addTagToItem(it, 'PS5')).toBe(false);
    expect(it.tags).toEqual(['ps5']);
  });
  test('initializes tags array if missing', () => {
    const it = {};
    addTagToItem(it, 'rpg');
    expect(it.tags).toEqual(['rpg']);
  });
  test('rejects invalid tag', () => {
    const it = { tags: [] };
    expect(addTagToItem(it, '')).toBe(false);
    expect(addTagToItem(it, 'all')).toBe(false);
    expect(it.tags).toEqual([]);
  });
  test('removes tag', () => {
    const it = { tags: ['ps5', 'rpg'] };
    expect(removeTagFromItem(it, 'ps5')).toBe(true);
    expect(it.tags).toEqual(['rpg']);
    expect(removeTagFromItem(it, 'ps5')).toBe(false);
  });
  test('remove no-op when missing tags array', () => {
    const it = {};
    expect(removeTagFromItem(it, 'ps5')).toBe(false);
  });
});

describe('renameTagInItems', () => {
  test('renames in every item that has it', () => {
    const items = [
      { tags: ['ps5', 'rpg'] },
      { tags: ['ps5'] },
      { tags: ['rpg'] }
    ];
    expect(renameTagInItems(items, 'ps5', 'playstation')).toBe(2);
    expect(items[0].tags).toEqual(['playstation', 'rpg']);
    expect(items[1].tags).toEqual(['playstation']);
    expect(items[2].tags).toEqual(['rpg']);
  });
  test('no-op when old equals new', () => {
    const items = [{ tags: ['rpg'] }];
    expect(renameTagInItems(items, 'rpg', 'rpg')).toBe(0);
    expect(items[0].tags).toEqual(['rpg']);
  });
  test('drops duplicate when target already present', () => {
    const items = [{ tags: ['ps5', 'playstation'] }];
    expect(renameTagInItems(items, 'ps5', 'playstation')).toBe(1);
    expect(items[0].tags).toEqual(['playstation']);
  });
  test('returns 0 on invalid input', () => {
    expect(renameTagInItems([{ tags: ['a'] }], '', 'b')).toBe(0);
    expect(renameTagInItems([{ tags: ['a'] }], 'a', '!!')).toBe(0);
  });
});

describe('mergeTagsInItems', () => {
  test('every source-tagged item gets target tag', () => {
    const items = [
      { tags: ['ps5'] },
      { tags: ['ps5', 'rpg'] },
      { tags: ['xbox'] }
    ];
    expect(mergeTagsInItems(items, 'ps5', 'playstation')).toBe(2);
    expect(items[0].tags).toEqual(['playstation']);
    expect(items[1].tags).toEqual(['playstation', 'rpg']);
    expect(items[2].tags).toEqual(['xbox']);
  });
  test('no duplicates when item already has target', () => {
    const items = [{ tags: ['ps5', 'playstation'] }];
    expect(mergeTagsInItems(items, 'ps5', 'playstation')).toBe(1);
    expect(items[0].tags).toEqual(['playstation']);
  });
  test('no-op when source equals target', () => {
    const items = [{ tags: ['rpg'] }];
    expect(mergeTagsInItems(items, 'rpg', 'rpg')).toBe(0);
  });
});

describe('deleteTagFromItems', () => {
  test('removes tag from all items, items remain', () => {
    const items = [
      { name: 'a', tags: ['ps5', 'rpg'] },
      { name: 'b', tags: ['ps5'] },
      { name: 'c', tags: ['rpg'] }
    ];
    expect(deleteTagFromItems(items, 'ps5')).toBe(2);
    expect(items.length).toBe(3);
    expect(items[0].tags).toEqual(['rpg']);
    expect(items[1].tags).toEqual([]);
    expect(items[2].tags).toEqual(['rpg']);
  });
  test('items without the tag are not affected', () => {
    const items = [{ tags: ['rpg'] }, { tags: [] }];
    expect(deleteTagFromItems(items, 'ps5')).toBe(0);
  });
});

describe('computeTagCounts', () => {
  test('combines counts across multiple lists', () => {
    const vault = [{ tags: ['ps5', 'rpg'] }, { tags: ['ps5'] }];
    const played = [{ tags: ['ps5', 'finished'] }];
    const counts = computeTagCounts(vault, played);
    expect(counts.get('ps5')).toBe(3);
    expect(counts.get('rpg')).toBe(1);
    expect(counts.get('finished')).toBe(1);
  });
  test('empty input yields empty map', () => {
    expect(computeTagCounts([]).size).toBe(0);
    expect(computeTagCounts([{ tags: [] }]).size).toBe(0);
  });
  test('skips items missing tags array', () => {
    const counts = computeTagCounts([{}, { tags: ['rpg'] }]);
    expect(counts.get('rpg')).toBe(1);
    expect(counts.size).toBe(1);
  });
});

describe('filterByTagsAND', () => {
  const items = [
    { name: 'a', tags: ['ps5', 'rpg'] },
    { name: 'b', tags: ['ps5', 'shooter'] },
    { name: 'c', tags: ['pc', 'rpg'] },
    { name: 'd', tags: [] },
    { name: 'e' }, // no tags array
  ];
  test('empty filter returns all items', () => {
    expect(filterByTagsAND(items, new Set()).length).toBe(items.length);
  });
  test('single-tag filter', () => {
    const r = filterByTagsAND(items, new Set(['ps5']));
    expect(r.map(x => x.name)).toEqual(['a', 'b']);
  });
  test('multi-tag AND — must have all', () => {
    const r = filterByTagsAND(items, new Set(['ps5', 'rpg']));
    expect(r.map(x => x.name)).toEqual(['a']);
  });
  test('no matches when AND impossible', () => {
    const r = filterByTagsAND(items, new Set(['ps5', 'pc']));
    expect(r).toEqual([]);
  });
  test('items without tags excluded once filter is non-empty', () => {
    const r = filterByTagsAND(items, new Set(['rpg']));
    expect(r.map(x => x.name)).toEqual(['a', 'c']);
  });
});

// ── Custom databases — id derivation + name validation ──────────────────────
// Verbatim copy from game-vault.html <script>.

const RESERVED_DB_IDS = new Set(['vault', 'played', 'settings', 'bulk-add', 'bulk-check']);
const CUSTOM_DB_NAME_MAX = 40;

function deriveCustomId(name) {
  if (typeof name !== 'string') return '';
  return name.trim().toLowerCase().normalize('NFC')
    .replace(/\s+/g, '-')
    .replace(/[\\\/:*?"<>|#]/g, '');
}

function validateCustomDbName(name, existingIds) {
  if (typeof name !== 'string') return { ok: false, error: 'নাম দাও।' };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'নাম empty।' };
  if (trimmed.length > CUSTOM_DB_NAME_MAX) {
    return { ok: false, error: 'নাম ' + CUSTOM_DB_NAME_MAX + ' char-এর বেশি।' };
  }
  const id = deriveCustomId(trimmed);
  if (!id) return { ok: false, error: 'এই নাম থেকে valid id বানানো গেল না।' };
  if (RESERVED_DB_IDS.has(id)) {
    return { ok: false, error: '"' + trimmed + '" reserved নাম — অন্যটা দাও।' };
  }
  const existing = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  if (existing.has(id)) return { ok: false, error: 'এই নামের database আগেই আছে।' };
  return { ok: true, id, name: trimmed };
}

describe('deriveCustomId', () => {
  test('lowercases ASCII', () => {
    expect(deriveCustomId('PS5')).toBe('ps5');
    expect(deriveCustomId('Xbox')).toBe('xbox');
  });
  test('trims surrounding whitespace', () => {
    expect(deriveCustomId('  Wishlist  ')).toBe('wishlist');
  });
  test('replaces internal whitespace with single dash', () => {
    expect(deriveCustomId('Switch Lite')).toBe('switch-lite');
    expect(deriveCustomId('A   B   C')).toBe('a-b-c');
  });
  test('preserves Bengali script (non-ASCII letters)', () => {
    const id = deriveCustomId('প্লে স্টেশন');
    expect(id).toBe('প্লে-স্টেশন');
    expect(id.length).toBeGreaterThan(0);
  });
  test('strips storage-unsafe punctuation', () => {
    expect(deriveCustomId('a/b\\c:d*e?f"g<h>i|j#k')).toBe('abcdefghijk');
  });
  test('keeps safe ASCII punctuation like dashes and underscores', () => {
    expect(deriveCustomId('my-list_2025')).toBe('my-list_2025');
  });
  test('non-string returns empty', () => {
    expect(deriveCustomId(null)).toBe('');
    expect(deriveCustomId(undefined)).toBe('');
    expect(deriveCustomId(42)).toBe('');
  });
  test('whitespace-only returns empty', () => {
    expect(deriveCustomId('   ')).toBe('');
  });
});

describe('validateCustomDbName', () => {
  test('accepts a fresh ASCII name', () => {
    const r = validateCustomDbName('PS5', new Set());
    expect(r.ok).toBe(true);
    expect(r.id).toBe('ps5');
    expect(r.name).toBe('PS5');
  });
  test('preserves user casing in returned name', () => {
    const r = validateCustomDbName('  My Wishlist  ', new Set());
    expect(r.ok).toBe(true);
    expect(r.id).toBe('my-wishlist');
    expect(r.name).toBe('My Wishlist');
  });
  test('rejects empty string', () => {
    const r = validateCustomDbName('', new Set());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/);
  });
  test('rejects whitespace-only', () => {
    const r = validateCustomDbName('   ', new Set());
    expect(r.ok).toBe(false);
  });
  test('rejects non-string input', () => {
    expect(validateCustomDbName(null).ok).toBe(false);
    expect(validateCustomDbName(undefined).ok).toBe(false);
    expect(validateCustomDbName(123).ok).toBe(false);
  });
  test('rejects names exceeding max length', () => {
    const long = 'a'.repeat(CUSTOM_DB_NAME_MAX + 1);
    const r = validateCustomDbName(long, new Set());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/40/);
  });
  test('accepts exactly max-length name', () => {
    const ok = 'a'.repeat(CUSTOM_DB_NAME_MAX);
    expect(validateCustomDbName(ok, new Set()).ok).toBe(true);
  });
  test('rejects each reserved id', () => {
    for (const r of ['vault', 'played', 'settings', 'bulk-add', 'bulk-check']) {
      expect(validateCustomDbName(r, new Set()).ok).toBe(false);
    }
  });
  test('reserved check is case-insensitive', () => {
    expect(validateCustomDbName('Vault', new Set()).ok).toBe(false);
    expect(validateCustomDbName('Bulk-Add', new Set()).ok).toBe(false);
  });
  test('rejects name that collides with existing id (case-insensitive)', () => {
    const existing = new Set(['ps5']);
    expect(validateCustomDbName('PS5', existing).ok).toBe(false);
    expect(validateCustomDbName('Ps5', existing).ok).toBe(false);
    expect(validateCustomDbName('ps5', existing).ok).toBe(false);
  });
  test('accepts when existing set has different ids', () => {
    const existing = new Set(['xbox', 'wishlist']);
    const r = validateCustomDbName('PS5', existing);
    expect(r.ok).toBe(true);
  });
  test('accepts existingIds as plain array', () => {
    const r = validateCustomDbName('Steam', ['xbox', 'ps5']);
    expect(r.ok).toBe(true);
    expect(r.id).toBe('steam');
  });
  test('rejects name that sanitizes to empty id', () => {
    // Only chars that get stripped: \ / : * ? " < > | #
    const r = validateCustomDbName('///***', new Set());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/valid id/);
  });
  test('accepts Bengali name', () => {
    const r = validateCustomDbName('প্লে স্টেশন', new Set());
    expect(r.ok).toBe(true);
    expect(r.id).toBe('প্লে-স্টেশন');
    expect(r.name).toBe('প্লে স্টেশন');
  });
  test('Bengali uniqueness is case/normalize-aware', () => {
    const existing = new Set(['প্লে-স্টেশন']);
    const r = validateCustomDbName('প্লে স্টেশন', existing);
    expect(r.ok).toBe(false);
  });
});

// ── filterCustomItems — pure search/sort for custom DB views ────────────────
// Verbatim copy from game-vault.html <script>.

function filterCustomItems(items, index, query, sort) {
  const trimmed = (query || '').trim();
  let result;
  if (trimmed) {
    if (items.length > 50 && index) {
      result = index.search(trimmed, { limit: 1000 }).map(r => r.item);
    } else {
      const q = trimmed.toLowerCase();
      result = items.filter(it => {
        const lower = it._lower || (it.name || '').toLowerCase();
        return lower.indexOf(q) !== -1;
      });
    }
    if (sort === 'az') result.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'za') result.sort((a, b) => b.name.localeCompare(a.name));
    else if (sort === 'oldest') result.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
    return result;
  }
  result = items.slice();
  if (sort === 'az') result.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'za') result.sort((a, b) => b.name.localeCompare(a.name));
  else if (sort === 'recent') result.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
  else if (sort === 'oldest') result.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
  return result;
}

describe('filterCustomItems', () => {
  // Build a small list that exercises substring path (≤50 items).
  function smallList() {
    const raw = [
      { id: 'a', name: 'Mass Effect', dateAdded: 100 },
      { id: 'b', name: 'Mass Effect 2', dateAdded: 300 },
      { id: 'c', name: 'Half-Life', dateAdded: 200 },
      { id: 'd', name: 'Portal 2', dateAdded: 400 }
    ];
    const idx = new SearchIndex();
    for (const it of raw) idx.add(it);
    return { items: raw, idx };
  }

  test('empty filter returns all items', () => {
    const { items, idx } = smallList();
    const r = filterCustomItems(items, idx, '', 'recent');
    expect(r.length).toBe(items.length);
  });

  test('empty filter with az sort sorts alphabetically', () => {
    const { items, idx } = smallList();
    const r = filterCustomItems(items, idx, '', 'az');
    expect(r.map(x => x.name)).toEqual(['Half-Life', 'Mass Effect', 'Mass Effect 2', 'Portal 2']);
  });

  test('empty filter with recent sort sorts newest-first', () => {
    const { items, idx } = smallList();
    const r = filterCustomItems(items, idx, '', 'recent');
    expect(r.map(x => x.name)).toEqual(['Portal 2', 'Mass Effect 2', 'Half-Life', 'Mass Effect']);
  });

  test('empty filter with oldest sort sorts oldest-first', () => {
    const { items, idx } = smallList();
    const r = filterCustomItems(items, idx, '', 'oldest');
    expect(r.map(x => x.name)).toEqual(['Mass Effect', 'Half-Life', 'Mass Effect 2', 'Portal 2']);
  });

  test('substring match on small list (case-insensitive)', () => {
    const { items, idx } = smallList();
    const r = filterCustomItems(items, idx, 'mass', 'recent');
    expect(r.map(x => x.name).sort()).toEqual(['Mass Effect', 'Mass Effect 2']);
  });

  test('substring no-match returns empty', () => {
    const { items, idx } = smallList();
    expect(filterCustomItems(items, idx, 'zzzzz', 'recent')).toEqual([]);
  });

  test('substring uses _lower if present', () => {
    // Item with a stale name capitalization but lowered _lower
    const item = { id: 'x', name: 'WeIrD CaSe', _lower: 'weird case' };
    const r = filterCustomItems([item], null, 'weird', 'recent');
    expect(r.length).toBe(1);
  });

  test('explicit az sort overrides relevance when query is given', () => {
    const { items, idx } = smallList();
    const r = filterCustomItems(items, idx, 'mass', 'az');
    expect(r.map(x => x.name)).toEqual(['Mass Effect', 'Mass Effect 2']);
  });

  test('explicit za sort overrides relevance when query is given', () => {
    const { items, idx } = smallList();
    const r = filterCustomItems(items, idx, 'mass', 'za');
    expect(r.map(x => x.name)).toEqual(['Mass Effect 2', 'Mass Effect']);
  });

  test('null index with empty query still returns sorted copy', () => {
    const items = [
      { id: 'a', name: 'Bee', dateAdded: 1 },
      { id: 'b', name: 'Apple', dateAdded: 2 }
    ];
    expect(filterCustomItems(items, null, '', 'az').map(x => x.name)).toEqual(['Apple', 'Bee']);
  });

  test('whitespace-only query treated as empty', () => {
    const { items, idx } = smallList();
    const r = filterCustomItems(items, idx, '   ', 'az');
    expect(r.length).toBe(items.length);
  });

  test('large list (>50) routes through index.search ranked path', () => {
    // Build 60 items where one is an exact match — index.search ranks it first.
    const raw = [];
    for (let i = 0; i < 59; i++) raw.push({ id: 'g' + i, name: 'Random Game ' + i, dateAdded: i });
    raw.push({ id: 'target', name: 'Bloodborne', dateAdded: 500 });
    const idx = new SearchIndex();
    for (const it of raw) idx.add(it);
    const r = filterCustomItems(raw, idx, 'bloodborne', 'recent');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].id).toBe('target');
  });

  test('sort=recent with active query preserves relevance order (does not re-sort)', () => {
    // Build >50 items; ensure index search results are not re-sorted by date.
    const raw = [];
    for (let i = 0; i < 60; i++) raw.push({ id: 'g' + i, name: 'Some Game ' + i, dateAdded: i });
    const idx = new SearchIndex();
    for (const it of raw) idx.add(it);
    const r = filterCustomItems(raw, idx, 'Some Game 0', 'recent');
    // Top hit must be 'Some Game 0' (exact starts-with), not 'Some Game 59' (most recent)
    expect(r[0].name).toBe('Some Game 0');
  });
});

// ── extractYearFromName — verbatim copy from game-vault.html ──
// (YEAR_DETECT_RX declared once at top of file)
function extractYearFromName(name) {
  if (typeof name !== 'string' || !name) return null;
  YEAR_DETECT_RX.lastIndex = 0;
  let last = null, m;
  while ((m = YEAR_DETECT_RX.exec(name)) !== null) last = m[1];
  return last === null ? null : parseInt(last, 10);
}

describe('extractYearFromName', () => {
  test('single 4-digit year', () => {
    expect(extractYearFromName('Halo Infinite 2021')).toBe(2021);
  });
  test('multiple years — last (rightmost) wins', () => {
    expect(extractYearFromName('1979 Revolution 2016')).toBe(2016);
  });
  test('three years — rightmost wins', () => {
    expect(extractYearFromName('FIFA 1999 2000 2001')).toBe(2001);
  });
  test('last wins through parentheses', () => {
    expect(extractYearFromName('Quake 1996 (Remastered 2021)')).toBe(2021);
  });
  test('two-digit shorthand is not a year', () => {
    expect(extractYearFromName('FIFA 24')).toBe(null);
  });
  test('no year returns null', () => {
    expect(extractYearFromName('The Last of Us')).toBe(null);
  });
  test('bare digit is not a year', () => {
    expect(extractYearFromName('Half-Life 2')).toBe(null);
  });
  test('year fused to letters has no word boundary — no match', () => {
    expect(extractYearFromName('NHL98')).toBe(null);
  });
  test('year at start of name', () => {
    expect(extractYearFromName('2007: Murder Was the Case')).toBe(2007);
  });
  test('below 1970 range', () => {
    expect(extractYearFromName('GTA 1969')).toBe(null);
  });
  test('above 2030 range', () => {
    expect(extractYearFromName('Game 2031')).toBe(null);
  });
  test('out-of-range 4-digit number', () => {
    expect(extractYearFromName('3030 Deathwar')).toBe(null);
  });
  test('null / undefined / empty returns null', () => {
    expect(extractYearFromName(null)).toBe(null);
    expect(extractYearFromName(undefined)).toBe(null);
    expect(extractYearFromName('')).toBe(null);
  });
  test('non-string input returns null', () => {
    expect(extractYearFromName(2021)).toBe(null);
    expect(extractYearFromName({})).toBe(null);
  });
  test('boundary years 1970 and 2030', () => {
    expect(extractYearFromName('Old Game 1970')).toBe(1970);
    expect(extractYearFromName('New Game 2030')).toBe(2030);
  });
  test('stateful regex reset between calls', () => {
    // YEAR_DETECT_RX is module-level with /g — exec must reset lastIndex
    // so consecutive calls return the same result.
    expect(extractYearFromName('Doom 2016')).toBe(2016);
    expect(extractYearFromName('Doom 2016')).toBe(2016);
    expect(extractYearFromName('Doom 2016')).toBe(2016);
  });
  test('hyphen-separated year', () => {
    expect(extractYearFromName('FIFA-2021-Edition')).toBe(2021);
  });
});

// ── Year helpers — verbatim copy from game-vault.html ──
function isValidYear(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return null;
    return (v >= 1970 && v <= 2030) ? v : null;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (!/^\d{4}$/.test(t)) return null;
    const n = parseInt(t, 10);
    return (n >= 1970 && n <= 2030) ? n : null;
  }
  return null;
}
function parseYearInput(raw) {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const v = isValidYear(t);
  return v === null ? undefined : v;
}
function resolveItemYear(item) {
  if (item && typeof item.year === 'number') return item.year;
  return extractYearFromName(item ? item.name : '');
}

describe('isValidYear', () => {
  test('integer in range', () => {
    expect(isValidYear(2024)).toBe(2024);
    expect(isValidYear(1970)).toBe(1970);
    expect(isValidYear(2030)).toBe(2030);
  });
  test('numeric string in range', () => {
    expect(isValidYear('2024')).toBe(2024);
    expect(isValidYear('  2000  ')).toBe(2000);
  });
  test('out-of-range integer rejected', () => {
    expect(isValidYear(1969)).toBe(null);
    expect(isValidYear(2031)).toBe(null);
    expect(isValidYear(0)).toBe(null);
    expect(isValidYear(-2024)).toBe(null);
  });
  test('out-of-range string rejected', () => {
    expect(isValidYear('1969')).toBe(null);
    expect(isValidYear('2031')).toBe(null);
  });
  test('non-4-digit string rejected', () => {
    expect(isValidYear('99999')).toBe(null);
    expect(isValidYear('123')).toBe(null);
    expect(isValidYear('20')).toBe(null);
  });
  test('non-numeric string rejected', () => {
    expect(isValidYear('abc')).toBe(null);
    expect(isValidYear('20.24')).toBe(null);
    expect(isValidYear('2024a')).toBe(null);
  });
  test('float rejected', () => {
    expect(isValidYear(2024.5)).toBe(null);
    expect(isValidYear(2024.0001)).toBe(null);
  });
  test('NaN / null / undefined / empty rejected', () => {
    expect(isValidYear(NaN)).toBe(null);
    expect(isValidYear(null)).toBe(null);
    expect(isValidYear(undefined)).toBe(null);
    expect(isValidYear('')).toBe(null);
  });
  test('non-primitive rejected', () => {
    expect(isValidYear({})).toBe(null);
    expect(isValidYear([])).toBe(null);
    expect(isValidYear([2024])).toBe(null);
  });
});

describe('parseYearInput', () => {
  test('empty / whitespace returns null (cleared)', () => {
    expect(parseYearInput('')).toBe(null);
    expect(parseYearInput('   ')).toBe(null);
    expect(parseYearInput(null)).toBe(null);
    expect(parseYearInput(undefined)).toBe(null);
  });
  test('valid year returns int', () => {
    expect(parseYearInput('2024')).toBe(2024);
    expect(parseYearInput('  2024  ')).toBe(2024);
    expect(parseYearInput('1970')).toBe(1970);
    expect(parseYearInput('2030')).toBe(2030);
  });
  test('garbage returns undefined (error)', () => {
    expect(parseYearInput('abc')).toBe(undefined);
    expect(parseYearInput('1969')).toBe(undefined);
    expect(parseYearInput('2031')).toBe(undefined);
    expect(parseYearInput('99999')).toBe(undefined);
    expect(parseYearInput('20.24')).toBe(undefined);
    expect(parseYearInput('2024a')).toBe(undefined);
  });
  test('clear vs error are distinct sentinels', () => {
    expect(parseYearInput('')).not.toBe(undefined);   // cleared = null
    expect(parseYearInput('xyz')).not.toBe(null);     // error = undefined
  });
});

describe('resolveItemYear', () => {
  test('manual year wins over regex from name', () => {
    expect(resolveItemYear({ name: 'Halo 2021', year: 2015 })).toBe(2015);
  });
  test('falls back to regex when year unset', () => {
    expect(resolveItemYear({ name: 'Halo 2021' })).toBe(2021);
  });
  test('returns null when neither set nor extractable', () => {
    expect(resolveItemYear({ name: 'Untitled' })).toBe(null);
  });
  test('undefined year still falls back to regex', () => {
    expect(resolveItemYear({ name: 'Halo 2021', year: undefined })).toBe(2021);
  });
  test('manual year used when name has no year', () => {
    expect(resolveItemYear({ name: 'Untitled', year: 2010 })).toBe(2010);
  });
  test('non-number year is ignored, falls back', () => {
    // Defensive: stored garbage should not break aggregation.
    expect(resolveItemYear({ name: 'Halo 2021', year: '2015' })).toBe(2021);
    expect(resolveItemYear({ name: 'Halo 2021', year: null })).toBe(2021);
  });
  test('null / undefined item returns null safely', () => {
    expect(resolveItemYear(null)).toBe(null);
    expect(resolveItemYear(undefined)).toBe(null);
  });
});

// ── pushRecentYear — verbatim copy from game-vault.html ──
function pushRecentYear(arr, year) {
  const v = isValidYear(year);
  if (v === null) return arr;
  const i = arr.indexOf(v);
  if (i !== -1) arr.splice(i, 1);
  arr.unshift(v);
  if (arr.length > 5) arr.length = 5;
  return arr;
}

describe('pushRecentYear', () => {
  test('pushes into empty array', () => {
    const a = [];
    pushRecentYear(a, 2024);
    expect(a).toEqual([2024]);
  });
  test('mutates and returns the same array', () => {
    const a = [];
    const r = pushRecentYear(a, 2024);
    expect(r).toBe(a);
  });
  test('dedupes identical year — length stays 1', () => {
    const a = [2024];
    pushRecentYear(a, 2024);
    expect(a).toEqual([2024]);
  });
  test('most-recent-first ordering', () => {
    const a = [2020, 2021];
    pushRecentYear(a, 2022);
    expect(a).toEqual([2022, 2020, 2021]);
  });
  test('caps at 5 entries — oldest dropped', () => {
    const a = [2024, 2023, 2022, 2021, 2020];
    pushRecentYear(a, 2019);
    expect(a).toEqual([2019, 2024, 2023, 2022, 2021]);
    expect(a).toHaveLength(5);
  });
  test('existing middle entry moves to front, length unchanged', () => {
    const a = [2024, 2023, 2022, 2021, 2020];
    pushRecentYear(a, 2022);
    expect(a).toEqual([2022, 2024, 2023, 2021, 2020]);
    expect(a).toHaveLength(5);
  });
  test('existing last entry moves to front', () => {
    const a = [2024, 2023, 2022];
    pushRecentYear(a, 2022);
    expect(a).toEqual([2022, 2024, 2023]);
  });
  test('numeric string accepted (validated through isValidYear)', () => {
    const a = [];
    pushRecentYear(a, '2024');
    expect(a).toEqual([2024]);
  });
  test('invalid years are rejected — array unchanged', () => {
    const baseline = [2024, 2023];
    const cases = [null, undefined, NaN, 1969, 2031, 'abc', 2024.5, '20.24', {}, []];
    for (const bad of cases) {
      const a = baseline.slice();
      pushRecentYear(a, bad);
      expect(a).toEqual(baseline);
    }
  });
  test('repeated pushes of same year stay length 1', () => {
    const a = [];
    pushRecentYear(a, 2024);
    pushRecentYear(a, 2024);
    pushRecentYear(a, 2024);
    expect(a).toEqual([2024]);
  });
  test('boundary years 1970 and 2030 accepted', () => {
    const a = [];
    pushRecentYear(a, 1970);
    pushRecentYear(a, 2030);
    expect(a).toEqual([2030, 1970]);
  });
  test('overflow with dedupe — existing entry surfaces, no truncation needed', () => {
    const a = [2024, 2023, 2022, 2021, 2020];
    pushRecentYear(a, 2020);
    expect(a).toEqual([2020, 2024, 2023, 2022, 2021]);
    expect(a).toHaveLength(5);
  });
});

// ── Notes tab helpers ────────────────────────────────────────────────────────
// Verbatim copies of countNotesStats / formatNotesBadge / makeDebouncer from
// game-vault.html. Pure functions, no DOM, so they're safe to test in isolation.

function countNotesStats(text) {
  const s = typeof text === 'string' ? text : '';
  const chars = [...s].length;
  const trimmed = s.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { words, chars };
}

function formatNotesBadge(text) {
  const s = typeof text === 'string' ? text : '';
  const chars = [...s].length;
  if (chars === 0) return '';
  if (chars >= 1000) {
    const k = chars / 1000;
    const rounded = k >= 10 ? Math.round(k) : Math.round(k * 10) / 10;
    return '(' + rounded + 'k)';
  }
  return '(' + chars + ')';
}

function makeDebouncer(fn, ms) {
  let t = null;
  return function () {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

describe('countNotesStats', () => {
  test('empty string', () => {
    expect(countNotesStats('')).toEqual({ words: 0, chars: 0 });
  });
  test('simple words', () => {
    expect(countNotesStats('hello world')).toEqual({ words: 2, chars: 11 });
  });
  test('chars include whitespace, words collapse runs', () => {
    expect(countNotesStats('  hello   world  ')).toEqual({ words: 2, chars: 17 });
  });
  test('emoji counted as one char (codepoint, not UTF-16 unit)', () => {
    // 📝 is a surrogate pair in UTF-16; [...text].length collapses it to 1
    expect(countNotesStats('📝 note')).toEqual({ words: 2, chars: 6 });
  });
  test('Bengali text counted', () => {
    const r = countNotesStats('আমি লিখি');
    expect(r.words).toBe(2);
    expect(r.chars).toBeGreaterThan(0);
  });
  test('non-string input safe', () => {
    expect(countNotesStats(null)).toEqual({ words: 0, chars: 0 });
    expect(countNotesStats(undefined)).toEqual({ words: 0, chars: 0 });
  });
});

describe('formatNotesBadge', () => {
  test('empty → empty string', () => {
    expect(formatNotesBadge('')).toBe('');
  });
  test('small content shows char count', () => {
    expect(formatNotesBadge('hello')).toBe('(5)');
    expect(formatNotesBadge('a'.repeat(50))).toBe('(50)');
    expect(formatNotesBadge('a'.repeat(999))).toBe('(999)');
  });
  test('≥1000 chars use k suffix with one decimal', () => {
    expect(formatNotesBadge('a'.repeat(1000))).toBe('(1k)');
    expect(formatNotesBadge('a'.repeat(1234))).toBe('(1.2k)');
    expect(formatNotesBadge('a'.repeat(1500))).toBe('(1.5k)');
  });
  test('≥10k drops the decimal', () => {
    expect(formatNotesBadge('a'.repeat(10000))).toBe('(10k)');
    expect(formatNotesBadge('a'.repeat(12345))).toBe('(12k)');
  });
});

describe('makeDebouncer (notes save timing)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  test('fires once after quiet period, even after many calls', () => {
    const fn = vi.fn();
    const debounced = makeDebouncer(fn, 600);
    debounced(); debounced(); debounced();
    vi.advanceTimersByTime(599);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  test('subsequent call after firing starts a new window', () => {
    const fn = vi.fn();
    const debounced = makeDebouncer(fn, 600);
    debounced();
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
    debounced();
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ── Serial-number jump helper ────────────────────────────────────────────────
// Verbatim copy of parseSerialQuery from game-vault.html. Pure — no DOM/state.

function parseSerialQuery(query) {
  if (typeof query !== 'string') return { isSerial: false };
  const s = query.trim();
  if (!/^\d+$/.test(s)) return { isSerial: false };
  const num = parseInt(s, 10);
  if (!Number.isFinite(num) || num <= 0) return { isSerial: false };
  return { isSerial: true, num };
}

describe('parseSerialQuery', () => {
  test('pure digits → serial mode', () => {
    expect(parseSerialQuery('321')).toEqual({ isSerial: true, num: 321 });
  });
  test('leading zeros stripped', () => {
    expect(parseSerialQuery('0321')).toEqual({ isSerial: true, num: 321 });
    expect(parseSerialQuery('00001')).toEqual({ isSerial: true, num: 1 });
  });
  test('whitespace trimmed', () => {
    expect(parseSerialQuery('  321  ')).toEqual({ isSerial: true, num: 321 });
    expect(parseSerialQuery('\t42\n')).toEqual({ isSerial: true, num: 42 });
  });
  test('"0" rejected — serials start at 1', () => {
    expect(parseSerialQuery('0')).toEqual({ isSerial: false });
    expect(parseSerialQuery('000')).toEqual({ isSerial: false });
  });
  test('plain text → not serial', () => {
    expect(parseSerialQuery('max')).toEqual({ isSerial: false });
  });
  test('text mixed with digits → not serial', () => {
    expect(parseSerialQuery('max 321')).toEqual({ isSerial: false });
    expect(parseSerialQuery('321 max')).toEqual({ isSerial: false });
  });
  test('empty / whitespace-only → not serial', () => {
    expect(parseSerialQuery('')).toEqual({ isSerial: false });
    expect(parseSerialQuery('   ')).toEqual({ isSerial: false });
  });
  test('decimals → not serial', () => {
    expect(parseSerialQuery('321.5')).toEqual({ isSerial: false });
  });
  test('negative numbers → not serial', () => {
    expect(parseSerialQuery('-321')).toEqual({ isSerial: false });
  });
  test('non-string input safe', () => {
    expect(parseSerialQuery(null)).toEqual({ isSerial: false });
    expect(parseSerialQuery(undefined)).toEqual({ isSerial: false });
    expect(parseSerialQuery(321)).toEqual({ isSerial: false });
  });
});

// ── Mother tab aggregation + filter ──────────────────────────────────────────
// Verbatim copies from game-vault.html. Pure functions over stateLike + rows.

function aggregateMotherList(stateLike) {
  const out = [];
  const vault = (stateLike && stateLike.vault) || [];
  for (const it of vault) {
    out.push({ item: it, sourceKind: 'vault', sourceId: null, sourceLabel: 'Vault', sourceClass: 'src-vault' });
  }
  const order = (stateLike && stateLike.customListsOrder) || [];
  const customs = (stateLike && stateLike.customLists) || {};
  for (const id of order) {
    const list = customs[id];
    if (!list || !Array.isArray(list.items)) continue;
    for (const it of list.items) {
      out.push({ item: it, sourceKind: 'custom', sourceId: id, sourceLabel: list.name, sourceClass: 'src-custom' });
    }
  }
  return out;
}

function filterMotherRows(rows, opts) {
  opts = opts || {};
  const search = (opts.search || '').trim().toLowerCase();
  const sourceFilter = opts.sourceFilter || '';
  const sort = opts.sort || 'recent';

  let result = rows;
  if (sourceFilter) {
    result = result.filter(r =>
      (sourceFilter === 'vault' && r.sourceKind === 'vault')
      || (sourceFilter.startsWith('cl-') && r.sourceKind === 'custom' && ('cl-' + r.sourceId) === sourceFilter)
    );
  }
  if (search) {
    result = result.filter(r => (r.item.name || '').toLowerCase().indexOf(search) !== -1);
  }
  result = result.slice();
  if (sort === 'az') result.sort((a, b) => a.item.name.localeCompare(b.item.name));
  else if (sort === 'za') result.sort((a, b) => b.item.name.localeCompare(a.item.name));
  else if (sort === 'recent') result.sort((a, b) => (b.item.dateAdded || 0) - (a.item.dateAdded || 0));
  else if (sort === 'oldest') result.sort((a, b) => (a.item.dateAdded || 0) - (b.item.dateAdded || 0));
  else if (sort === 'source') result.sort((a, b) => {
    const s = a.sourceLabel.localeCompare(b.sourceLabel);
    return s !== 0 ? s : a.item.name.localeCompare(b.item.name);
  });
  return result;
}

describe('aggregateMotherList', () => {
  test('empty state → empty array', () => {
    expect(aggregateMotherList({})).toEqual([]);
    expect(aggregateMotherList({ vault: [], customListsOrder: [], customLists: {} })).toEqual([]);
  });

  test('vault-only state produces vault rows', () => {
    const stateLike = {
      vault: [
        { id: 'a', name: 'Skyrim', dateAdded: 1 },
        { id: 'b', name: 'Morrowind', dateAdded: 2 }
      ],
      customListsOrder: [],
      customLists: {}
    };
    const rows = aggregateMotherList(stateLike);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sourceKind: 'vault', sourceId: null, sourceLabel: 'Vault' });
    expect(rows[0].item.name).toBe('Skyrim');
    expect(rows[1].item.name).toBe('Morrowind');
  });

  test('played is excluded even when populated', () => {
    const stateLike = {
      vault: [{ id: 'a', name: 'Skyrim' }],
      played: [{ id: 'p1', name: 'Witcher 3' }],   // should NOT appear
      customListsOrder: [],
      customLists: {}
    };
    const rows = aggregateMotherList(stateLike);
    expect(rows).toHaveLength(1);
    expect(rows[0].item.name).toBe('Skyrim');
  });

  test('custom DBs appear in customListsOrder order, after vault', () => {
    const stateLike = {
      vault: [{ id: 'v1', name: 'Vault Game' }],
      customListsOrder: ['b', 'a'],   // intentionally not alphabetical
      customLists: {
        a: { id: 'a', name: 'Alpha', items: [{ id: 'a1', name: 'Alpha Game' }] },
        b: { id: 'b', name: 'Beta',  items: [{ id: 'b1', name: 'Beta Game' }] }
      }
    };
    const rows = aggregateMotherList(stateLike);
    expect(rows.map(r => r.item.name)).toEqual(['Vault Game', 'Beta Game', 'Alpha Game']);
    expect(rows.map(r => r.sourceKind)).toEqual(['vault', 'custom', 'custom']);
    expect(rows.map(r => r.sourceId)).toEqual([null, 'b', 'a']);
    expect(rows.map(r => r.sourceLabel)).toEqual(['Vault', 'Beta', 'Alpha']);
  });

  test('same game in vault and custom → two distinct rows (no dedup)', () => {
    const game = { id: 'g1', name: 'Skyrim' };
    const stateLike = {
      vault: [game],
      customListsOrder: ['favs'],
      customLists: {
        favs: { id: 'favs', name: 'Favs', items: [game] }
      }
    };
    const rows = aggregateMotherList(stateLike);
    expect(rows).toHaveLength(2);
    expect(rows[0].sourceKind).toBe('vault');
    expect(rows[1].sourceKind).toBe('custom');
    expect(rows[1].sourceLabel).toBe('Favs');
  });

  test('empty custom DB contributes nothing', () => {
    const stateLike = {
      vault: [],
      customListsOrder: ['empty', 'has-one'],
      customLists: {
        'empty':   { id: 'empty', name: 'Empty', items: [] },
        'has-one': { id: 'has-one', name: 'HasOne', items: [{ id: 'x', name: 'X' }] }
      }
    };
    const rows = aggregateMotherList(stateLike);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceLabel).toBe('HasOne');
  });
});

describe('filterMotherRows', () => {
  // Helper to build a minimal row
  const r = (name, sourceKind, sourceId, dateAdded) => ({
    item: { id: name.toLowerCase(), name, dateAdded: dateAdded || 0 },
    sourceKind,
    sourceId,
    sourceLabel: sourceKind === 'vault' ? 'Vault' : sourceId,
    sourceClass: sourceKind === 'vault' ? 'src-vault' : 'src-custom'
  });

  const rows = [
    r('Skyrim',    'vault',  null,  100),
    r('Witcher',   'vault',  null,  200),
    r('Morrowind', 'custom', 'fav', 50),
    r('Skyrim',    'custom', 'fav', 75)   // dup name, different source
  ];

  test('no filters → returns sorted copy (recent default)', () => {
    const out = filterMotherRows(rows, {});
    expect(out.map(r => r.item.name)).toEqual(['Witcher', 'Skyrim', 'Skyrim', 'Morrowind']);
    expect(out).not.toBe(rows); // must not mutate input
  });

  test('search filters by substring on item.name (case-insensitive)', () => {
    const out = filterMotherRows(rows, { search: 'sky', sort: 'az' });
    expect(out).toHaveLength(2);
    expect(out.every(r => r.item.name === 'Skyrim')).toBe(true);
  });

  test('sourceFilter "vault" keeps only vault rows', () => {
    const out = filterMotherRows(rows, { sourceFilter: 'vault' });
    expect(out).toHaveLength(2);
    expect(out.every(r => r.sourceKind === 'vault')).toBe(true);
  });

  test('sourceFilter "cl-<id>" keeps only that custom DB', () => {
    const out = filterMotherRows(rows, { sourceFilter: 'cl-fav' });
    expect(out).toHaveLength(2);
    expect(out.every(r => r.sourceKind === 'custom' && r.sourceId === 'fav')).toBe(true);
  });

  test('sort az/za order by item.name', () => {
    const az = filterMotherRows(rows, { sort: 'az' }).map(r => r.item.name);
    expect(az).toEqual(['Morrowind', 'Skyrim', 'Skyrim', 'Witcher']);
    const za = filterMotherRows(rows, { sort: 'za' }).map(r => r.item.name);
    expect(za).toEqual(['Witcher', 'Skyrim', 'Skyrim', 'Morrowind']);
  });

  test('sort recent/oldest order by dateAdded', () => {
    const recent = filterMotherRows(rows, { sort: 'recent' }).map(r => r.item.dateAdded);
    expect(recent).toEqual([200, 100, 75, 50]);
    const oldest = filterMotherRows(rows, { sort: 'oldest' }).map(r => r.item.dateAdded);
    expect(oldest).toEqual([50, 75, 100, 200]);
  });

  test('sort source groups by sourceLabel then name', () => {
    const out = filterMotherRows(rows, { sort: 'source' });
    // 'Vault' rows (V) come after 'fav' rows alphabetically
    expect(out.map(r => r.sourceLabel + ':' + r.item.name)).toEqual([
      'fav:Morrowind', 'fav:Skyrim', 'Vault:Skyrim', 'Vault:Witcher'
    ]);
  });

  test('search + sourceFilter compose', () => {
    const out = filterMotherRows(rows, { search: 'sky', sourceFilter: 'cl-fav' });
    expect(out).toHaveLength(1);
    expect(out[0].sourceId).toBe('fav');
    expect(out[0].item.name).toBe('Skyrim');
  });
});

// ── Playtime helpers — verbatim copy from game-vault.html ─────────────────
const _PT_HOURS_RX   = /^\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i;
const _PT_MINUTES_RX = /^\s+(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i;
const _PT_BARE_RX    = /^\s+(\d+(?:\.\d+)?)\s*$/;
function extractPlaytimeFromName(name) {
  if (typeof name !== 'string' || !name) return null;
  YEAR_DETECT_RX.lastIndex = 0;
  let end = -1, m;
  while ((m = YEAR_DETECT_RX.exec(name)) !== null) end = m.index + m[0].length;
  YEAR_DETECT_RX.lastIndex = 0;
  if (end === -1) return null;
  const tail = name.slice(end);
  let mt = _PT_HOURS_RX.exec(tail);
  if (mt) return { hours: parseFloat(mt[1]), minutes: 0 };
  mt = _PT_MINUTES_RX.exec(tail);
  if (mt) return { hours: 0, minutes: Math.round(parseFloat(mt[1])) };
  mt = _PT_BARE_RX.exec(tail);
  if (mt) return { hours: parseFloat(mt[1]), minutes: 0 };
  return null;
}

function totalPlaytimeHours(items) {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;
    const p = extractPlaytimeFromName(it.name);
    if (!p) continue;
    total += p.hours + p.minutes / 60;
  }
  return total;
}

function formatTotalHours(hours) {
  const h = Number(hours) || 0;
  const label = h === 1 ? 'hour' : 'hours';
  const txt = h.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return txt + ' ' + label;
}

function formatGamePlaytime(playtime) {
  if (!playtime) return '';
  const h = Number(playtime.hours) || 0;
  const mn = Number(playtime.minutes) || 0;
  if (h === 0 && mn === 0) return '';
  if (h === 0 && mn < 60) return mn + (mn === 1 ? ' minute' : ' minutes');
  if (mn === 0) return h + (h === 1 ? ' hour' : ' hours');
  const combined = parseFloat((h + mn / 60).toFixed(2));
  return combined + (combined === 1 ? ' hour' : ' hours');
}

function getPlaytimeForSort(item) {
  const p = extractPlaytimeFromName(item && item.name);
  return p ? p.hours + p.minutes / 60 : 0;
}

describe('extractPlaytimeFromName', () => {
  test('hours suffix h', () => {
    expect(extractPlaytimeFromName('Black Mesa 2020 15h')).toEqual({ hours: 15, minutes: 0 });
  });
  test('decimal hours suffix h', () => {
    expect(extractPlaytimeFromName('Some Game 2023 4.5h')).toEqual({ hours: 4.5, minutes: 0 });
  });
  test('hours full word', () => {
    expect(extractPlaytimeFromName('Game 2020 10 hours')).toEqual({ hours: 10, minutes: 0 });
  });
  test('hour singular', () => {
    expect(extractPlaytimeFromName('Game 2020 1 hour')).toEqual({ hours: 1, minutes: 0 });
  });
  test('hr abbreviation', () => {
    expect(extractPlaytimeFromName('Game 2020 7 hr')).toEqual({ hours: 7, minutes: 0 });
  });
  test('minutes with min suffix', () => {
    expect(extractPlaytimeFromName('Halo 2024 45 min')).toEqual({ hours: 0, minutes: 45 });
  });
  test('minutes full word', () => {
    expect(extractPlaytimeFromName('Some Game 2023 56 minute')).toEqual({ hours: 0, minutes: 56 });
  });
  test('minutes single letter m', () => {
    expect(extractPlaytimeFromName('Game 2020 30m')).toEqual({ hours: 0, minutes: 30 });
  });
  test('bare number defaults to hours', () => {
    expect(extractPlaytimeFromName('Some Game 2012 45')).toEqual({ hours: 45, minutes: 0 });
  });
  test('bare decimal defaults to hours', () => {
    expect(extractPlaytimeFromName('Some Game 2023 4.5')).toEqual({ hours: 4.5, minutes: 0 });
  });
  test('no year → null', () => {
    expect(extractPlaytimeFromName('No Year Game 5h')).toBeNull();
  });
  test('year but no time → null', () => {
    expect(extractPlaytimeFromName('Halo Infinite 2024')).toBeNull();
  });
  test('no year no time → null', () => {
    expect(extractPlaytimeFromName('Halo Infinite')).toBeNull();
  });
  test('number embedded in title is not playtime', () => {
    expect(extractPlaytimeFromName('Halo 3 2024')).toBeNull();
  });
  test('multiple years — rightmost anchors playtime', () => {
    expect(extractPlaytimeFromName('FIFA 1999 2000 2001 5h')).toEqual({ hours: 5, minutes: 0 });
  });
  test('first time pattern wins, second ignored', () => {
    expect(extractPlaytimeFromName('Halo 2024 5h 10min')).toEqual({ hours: 5, minutes: 0 });
  });
  test('unknown suffix → null', () => {
    expect(extractPlaytimeFromName('Halo 2024 5x')).toBeNull();
  });
  test('zero hours', () => {
    expect(extractPlaytimeFromName('Halo 2024 0h')).toEqual({ hours: 0, minutes: 0 });
  });
  test('zero bare number', () => {
    expect(extractPlaytimeFromName('Halo 2024 0')).toEqual({ hours: 0, minutes: 0 });
  });
  test('whitespace-only after year → null', () => {
    expect(extractPlaytimeFromName('Halo 2024   ')).toBeNull();
  });
  test('non-string input → null', () => {
    expect(extractPlaytimeFromName(null)).toBeNull();
    expect(extractPlaytimeFromName(undefined)).toBeNull();
    expect(extractPlaytimeFromName(123)).toBeNull();
    expect(extractPlaytimeFromName({})).toBeNull();
    expect(extractPlaytimeFromName('')).toBeNull();
  });
  test('decimal minutes rounded to int', () => {
    expect(extractPlaytimeFromName('Halo 2024 30.5 min')).toEqual({ hours: 0, minutes: 31 });
  });
});

describe('normalize() — playtime stripping', () => {
  test('strips "5h" after year', () => {
    expect(normalize('Halo 2024 5h')).toBe('halo');
  });
  test('strips "45 min" after year', () => {
    expect(normalize('Halo 2024 45 min')).toBe('halo');
  });
  test('strips "2.5 hours" after year', () => {
    expect(normalize('Game 2020 2.5 hours')).toBe('game');
  });
  test('preserves number-in-title (Halo 3 2024)', () => {
    expect(normalize('Halo 3 2024')).toBe('halo 3');
  });
  test('preserves bare trailing number after year', () => {
    expect(normalize('Halo 2024 45')).toBe('halo 45');
  });
  test('does not strip "5h" when no year present', () => {
    expect(normalize('No Year 5h')).toBe('no year 5h');
  });
});

describe('normalizeDedup() — playtime stripping', () => {
  test('strips "5h" after year', () => {
    const a = normalizeDedup('Halo 2024 5h');
    const b = normalizeDedup('Halo 2024');
    expect(a).toBe(b);
  });
  test('strips "45 min" after year', () => {
    expect(normalizeDedup('Halo 2024 45 min')).toBe(normalizeDedup('Halo 2024'));
  });
  test('preserves year (unlike normalize)', () => {
    expect(normalizeDedup('Halo 2024 5h')).toBe('halo 2024');
  });
  test('preserves number-in-title', () => {
    expect(normalizeDedup('Halo 3 2024')).toBe('halo 3 2024');
  });
});

describe('totalPlaytimeHours', () => {
  test('empty array → 0', () => {
    expect(totalPlaytimeHours([])).toBe(0);
  });
  test('non-array → 0', () => {
    expect(totalPlaytimeHours(null)).toBe(0);
    expect(totalPlaytimeHours(undefined)).toBe(0);
  });
  test('single item with hours', () => {
    expect(totalPlaytimeHours([{ name: 'Halo 2024 5h' }])).toBe(5);
  });
  test('multiple items hours', () => {
    expect(totalPlaytimeHours([
      { name: 'Halo 2024 5h' },
      { name: 'Doom 2020 10 hours' },
    ])).toBe(15);
  });
  test('mixes hours and minutes', () => {
    // 5h + 30min = 5.5h
    expect(totalPlaytimeHours([
      { name: 'Halo 2024 5h' },
      { name: 'Doom 2020 30 min' },
    ])).toBeCloseTo(5.5, 5);
  });
  test('items without playtime contribute 0', () => {
    expect(totalPlaytimeHours([
      { name: 'Halo 2024 5h' },
      { name: 'No Year Game' },
      { name: 'Halo Infinite 2024' },
    ])).toBe(5);
  });
  test('null items skipped', () => {
    expect(totalPlaytimeHours([null, { name: 'Game 2020 3h' }, undefined])).toBe(3);
  });
});

describe('formatTotalHours', () => {
  test('zero', () => {
    expect(formatTotalHours(0)).toBe('0 hours');
  });
  test('one — singular', () => {
    expect(formatTotalHours(1)).toBe('1 hour');
  });
  test('plural', () => {
    expect(formatTotalHours(5)).toBe('5 hours');
  });
  test('decimal preserved', () => {
    expect(formatTotalHours(25.5)).toBe('25.5 hours');
  });
  test('thousands separator', () => {
    expect(formatTotalHours(1500)).toBe('1,500 hours');
  });
  test('non-numeric → 0 hours', () => {
    expect(formatTotalHours(null)).toBe('0 hours');
    expect(formatTotalHours(undefined)).toBe('0 hours');
    expect(formatTotalHours(NaN)).toBe('0 hours');
  });
});

describe('formatGamePlaytime', () => {
  test('null → empty string', () => {
    expect(formatGamePlaytime(null)).toBe('');
  });
  test('undefined → empty string', () => {
    expect(formatGamePlaytime(undefined)).toBe('');
  });
  test('zero values → empty string', () => {
    expect(formatGamePlaytime({ hours: 0, minutes: 0 })).toBe('');
  });
  test('hours only — integer', () => {
    expect(formatGamePlaytime({ hours: 5, minutes: 0 })).toBe('5 hours');
  });
  test('hours only — singular', () => {
    expect(formatGamePlaytime({ hours: 1, minutes: 0 })).toBe('1 hour');
  });
  test('hours only — decimal', () => {
    expect(formatGamePlaytime({ hours: 5.5, minutes: 0 })).toBe('5.5 hours');
  });
  test('minutes only — plural', () => {
    expect(formatGamePlaytime({ hours: 0, minutes: 45 })).toBe('45 minutes');
  });
  test('minutes only — singular', () => {
    expect(formatGamePlaytime({ hours: 0, minutes: 1 })).toBe('1 minute');
  });
  test('minutes only — 30', () => {
    expect(formatGamePlaytime({ hours: 0, minutes: 30 })).toBe('30 minutes');
  });
  test('combined — clean half', () => {
    expect(formatGamePlaytime({ hours: 2, minutes: 30 })).toBe('2.5 hours');
  });
  test('combined — quarter hour', () => {
    expect(formatGamePlaytime({ hours: 5, minutes: 15 })).toBe('5.25 hours');
  });
  test('combined rounds to exactly 1 → singular hour', () => {
    expect(formatGamePlaytime({ hours: 0, minutes: 60 })).toBe('1 hour');
  });
});

describe('getPlaytimeForSort', () => {
  test('item with hours', () => {
    expect(getPlaytimeForSort({ name: 'Halo 2024 5h' })).toBe(5);
  });
  test('item with decimal hours', () => {
    expect(getPlaytimeForSort({ name: 'Halo 2024 4.5h' })).toBe(4.5);
  });
  test('item with minutes converts to fractional hours', () => {
    expect(getPlaytimeForSort({ name: 'Halo 2024 30 min' })).toBe(0.5);
  });
  test('item with bare number defaults to hours', () => {
    expect(getPlaytimeForSort({ name: 'Halo 2024 12' })).toBe(12);
  });
  test('item without playtime → 0', () => {
    expect(getPlaytimeForSort({ name: 'Halo Infinite 2024' })).toBe(0);
  });
  test('item without year → 0', () => {
    expect(getPlaytimeForSort({ name: 'No Year Game 5h' })).toBe(0);
  });
  test('null item → 0', () => {
    expect(getPlaytimeForSort(null)).toBe(0);
  });
  test('undefined item → 0', () => {
    expect(getPlaytimeForSort(undefined)).toBe(0);
  });
  test('item with no name → 0', () => {
    expect(getPlaytimeForSort({})).toBe(0);
  });
  test('sort comparator — desc orders by playtime, ties by name', () => {
    const items = [
      { name: 'Zelda 2024 5h' },
      { name: 'Halo 2024 10h' },
      { name: 'Aero 2024 5h' },
      { name: 'Doom 2024' },
    ];
    items.sort((a, b) => {
      const d = getPlaytimeForSort(b) - getPlaytimeForSort(a);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    expect(items.map(i => i.name)).toEqual([
      'Halo 2024 10h',     // 10h
      'Aero 2024 5h',      // 5h, name 'A' < 'Z'
      'Zelda 2024 5h',     // 5h
      'Doom 2024',         // 0h last
    ]);
  });
  test('sort comparator — asc puts 0-hour items first', () => {
    const items = [
      { name: 'Halo 2024 10h' },
      { name: 'Doom 2024' },
      { name: 'Aero 2024 5h' },
    ];
    items.sort((a, b) => {
      const d = getPlaytimeForSort(a) - getPlaytimeForSort(b);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    expect(items.map(i => i.name)).toEqual([
      'Doom 2024',         // 0h first
      'Aero 2024 5h',      // 5h
      'Halo 2024 10h',     // 10h
    ]);
  });
});

// ── stripDisplayMetadata — verbatim copy from game-vault.html ──
function stripDisplayMetadata(name) {
  if (typeof name !== 'string' || !name) return '';
  YEAR_DETECT_RX.lastIndex = 0;
  let idx = -1, m;
  while ((m = YEAR_DETECT_RX.exec(name)) !== null) idx = m.index;
  YEAR_DETECT_RX.lastIndex = 0;
  if (idx === -1) return name.trim();
  const head = name.slice(0, idx).trim();
  return head === '' ? name.trim() : head;
}

describe('stripDisplayMetadata', () => {
  test('strips year + trailing playtime (minutes)', () => {
    expect(stripDisplayMetadata('Better Than Dead 2026 57 min')).toBe('Better Than Dead');
  });
  test('strips year + trailing playtime (hours)', () => {
    expect(stripDisplayMetadata('Halo Infinite 2024 5h')).toBe('Halo Infinite');
  });
  test('number in title is preserved when year is at end', () => {
    expect(stripDisplayMetadata('Halo 3 2024')).toBe('Halo 3');
  });
  test('rightmost year wins — leading year-like number stays', () => {
    expect(stripDisplayMetadata('1979 Revolution 2016')).toBe('1979 Revolution');
  });
  test('no year — identity (with trim)', () => {
    expect(stripDisplayMetadata('Halo 3')).toBe('Halo 3');
    expect(stripDisplayMetadata('Halo Infinite')).toBe('Halo Infinite');
  });
  test('empty / null / undefined returns empty string', () => {
    expect(stripDisplayMetadata('')).toBe('');
    expect(stripDisplayMetadata(null)).toBe('');
    expect(stripDisplayMetadata(undefined)).toBe('');
  });
  test('non-string input returns empty string', () => {
    expect(stripDisplayMetadata(2024)).toBe('');
    expect(stripDisplayMetadata({})).toBe('');
  });
  test('pure year name — empty-fallback returns trimmed original', () => {
    expect(stripDisplayMetadata('2024')).toBe('2024');
  });
  test('leading-year title — empty-fallback returns trimmed original', () => {
    expect(stripDisplayMetadata('2007: Murder Was the Case')).toBe('2007: Murder Was the Case');
  });
  test('whitespace around name is trimmed', () => {
    expect(stripDisplayMetadata('  Halo Infinite 2024 5h  ')).toBe('Halo Infinite');
    expect(stripDisplayMetadata('   Halo 3   ')).toBe('Halo 3');
  });
  test('multiple years — slice anchors on rightmost', () => {
    expect(stripDisplayMetadata('FIFA 1999 2000 2001 5h')).toBe('FIFA 1999 2000');
  });
});

// ── Field-first reader + migration — verbatim copy from game-vault.html ──
function getPlaytimeForItem(item) {
  if (!item) return null;
  const p = item.playtime;
  if (p && (typeof p.hours === 'number' || typeof p.minutes === 'number')) {
    const h = Number(p.hours) || 0;
    const mn = Number(p.minutes) || 0;
    if (h === 0 && mn === 0) return null;
    return { hours: h, minutes: mn };
  }
  return extractPlaytimeFromName(item.name);
}

function migrateItem(item) {
  if (!item || typeof item.name !== 'string') return { changed: false, conflict: false };
  let changed = false, conflict = false;

  const nameYear = extractYearFromName(item.name);
  const namePlaytime = extractPlaytimeFromName(item.name);

  if (typeof item.year !== 'number') {
    if (nameYear !== null) { item.year = nameYear; changed = true; }
  } else if (nameYear !== null && nameYear !== item.year) {
    conflict = true;
  }

  if (!item.playtime && namePlaytime) {
    item.playtime = namePlaytime;
    changed = true;
  }

  const cleaned = stripDisplayMetadata(item.name);
  if (cleaned !== item.name) { item.name = cleaned; changed = true; }

  return { changed, conflict };
}

describe('migrateItem', () => {
  test('extracts year + playtime, strips name, marks changed', () => {
    const it = { name: 'Halo Infinite 2024 5h' };
    const r = migrateItem(it);
    expect(r).toEqual({ changed: true, conflict: false });
    expect(it.year).toBe(2024);
    expect(it.playtime).toEqual({ hours: 5, minutes: 0 });
    expect(it.name).toBe('Halo Infinite');
  });
  test('manual item.year wins; playtime still extracted; name still stripped; conflict flagged', () => {
    const it = { name: 'Halo 2024 45 min', year: 2023 };
    const r = migrateItem(it);
    expect(r.conflict).toBe(true);
    expect(r.changed).toBe(true);
    expect(it.year).toBe(2023);
    expect(it.playtime).toEqual({ hours: 0, minutes: 45 });
    expect(it.name).toBe('Halo');
  });
  test('plain name with no year/playtime — no-op', () => {
    const it = { name: 'Just a name' };
    const r = migrateItem(it);
    expect(r).toEqual({ changed: false, conflict: false });
    expect(it.year).toBeUndefined();
    expect(it.playtime).toBeUndefined();
    expect(it.name).toBe('Just a name');
  });
  test('year-only name → year extracted, no playtime field, name stripped', () => {
    const it = { name: 'Tetris 1984' };
    const r = migrateItem(it);
    expect(r.changed).toBe(true);
    expect(r.conflict).toBe(false);
    expect(it.year).toBe(1984);
    expect(it.playtime).toBeUndefined();
    expect(it.name).toBe('Tetris');
  });
  test('playtime without year anchor → no extraction (year is the anchor)', () => {
    const it = { name: 'No Year Game 5h' };
    const r = migrateItem(it);
    expect(r).toEqual({ changed: false, conflict: false });
    expect(it.year).toBeUndefined();
    expect(it.playtime).toBeUndefined();
    expect(it.name).toBe('No Year Game 5h');
  });
  test('item already structured (year set, plain name) — no-op', () => {
    const it = { name: 'Halo', year: 2024 };
    const r = migrateItem(it);
    expect(r).toEqual({ changed: false, conflict: false });
    expect(it.year).toBe(2024);
    expect(it.name).toBe('Halo');
  });
  test('idempotent — second call returns changed=false', () => {
    const it = { name: 'Halo Infinite 2024 5h' };
    migrateItem(it);
    const r2 = migrateItem(it);
    expect(r2).toEqual({ changed: false, conflict: false });
    expect(it.year).toBe(2024);
    expect(it.playtime).toEqual({ hours: 5, minutes: 0 });
    expect(it.name).toBe('Halo Infinite');
  });
  test('bare fractional number after year → hours-only playtime', () => {
    const it = { name: 'X 2024 0.75' };
    const r = migrateItem(it);
    expect(r.changed).toBe(true);
    expect(it.playtime).toEqual({ hours: 0.75, minutes: 0 });
    expect(it.year).toBe(2024);
    expect(it.name).toBe('X');
  });
  test('manual playtime wins; year still extracted; name still stripped', () => {
    const it = { name: 'X 2024 5h', playtime: { hours: 10, minutes: 0 } };
    const r = migrateItem(it);
    expect(r.changed).toBe(true);
    expect(it.playtime).toEqual({ hours: 10, minutes: 0 });
    expect(it.year).toBe(2024);
    expect(it.name).toBe('X');
  });
  test('empty / null / non-string name — no throw, no-op', () => {
    expect(migrateItem({ name: '' })).toEqual({ changed: false, conflict: false });
    expect(migrateItem(null)).toEqual({ changed: false, conflict: false });
    expect(migrateItem({ name: 2024 })).toEqual({ changed: false, conflict: false });
    expect(migrateItem(undefined)).toEqual({ changed: false, conflict: false });
  });
  test('whitespace-only trim counts as changed', () => {
    const it = { name: '  Halo  ' };
    const r = migrateItem(it);
    expect(r.changed).toBe(true);
    expect(it.name).toBe('Halo');
  });
  test('manual year matches name year — no conflict flagged', () => {
    const it = { name: 'Halo 2024 5h', year: 2024 };
    const r = migrateItem(it);
    expect(r.conflict).toBe(false);
    expect(r.changed).toBe(true);
    expect(it.year).toBe(2024);
    expect(it.playtime).toEqual({ hours: 5, minutes: 0 });
    expect(it.name).toBe('Halo');
  });
});

describe('getPlaytimeForItem', () => {
  test('field wins over name extraction', () => {
    const it = { name: 'X 2024 5h', playtime: { hours: 10, minutes: 0 } };
    expect(getPlaytimeForItem(it)).toEqual({ hours: 10, minutes: 0 });
  });
  test('falls back to name when no field set', () => {
    const it = { name: 'X 2024 5h' };
    expect(getPlaytimeForItem(it)).toEqual({ hours: 5, minutes: 0 });
  });
  test('treats {hours:0, minutes:0} field as null', () => {
    const it = { name: 'X', playtime: { hours: 0, minutes: 0 } };
    expect(getPlaytimeForItem(it)).toBeNull();
  });
  test('null when both field and name lack playtime', () => {
    expect(getPlaytimeForItem({ name: 'Plain' })).toBeNull();
  });
  test('null / undefined input returns null', () => {
    expect(getPlaytimeForItem(null)).toBeNull();
    expect(getPlaytimeForItem(undefined)).toBeNull();
  });
  test('non-number field shape falls back to name extraction', () => {
    // hours:'5' and minutes:undefined both fail the typeof===number guard,
    // so the reader falls back to extractPlaytimeFromName(item.name) — null here.
    const it = { name: 'X', playtime: { hours: '5', minutes: undefined } };
    expect(getPlaytimeForItem(it)).toBeNull();
  });
});

// ── parsePlaytimeInput — verbatim copy from game-vault.html ──
function parsePlaytimeInput(hoursStr, minutesStr) {
  const h = String(hoursStr == null ? '' : hoursStr).trim();
  const m = String(minutesStr == null ? '' : minutesStr).trim();
  if (h === '' && m === '') return null;
  let hF = 0, mI = 0;
  if (h !== '') {
    const n = Number(h);
    if (!isFinite(n) || n < 0) return null;
    hF = n;
  }
  if (m !== '') {
    const n = Number(m);
    if (!isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
    mI = n;
  }
  const totalMin = Math.round(hF * 60) + mI;
  if (totalMin === 0) return null;
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
}

describe('parsePlaytimeInput', () => {
  test('both empty → null', () => {
    expect(parsePlaytimeInput('', '')).toBeNull();
    expect(parsePlaytimeInput('  ', '  ')).toBeNull();
    expect(parsePlaytimeInput(null, undefined)).toBeNull();
  });
  test('hours only, valid int → {hours, minutes:0}', () => {
    expect(parsePlaytimeInput('5', '')).toEqual({ hours: 5, minutes: 0 });
  });
  test('minutes only, valid → {hours:0, minutes}', () => {
    expect(parsePlaytimeInput('', '30')).toEqual({ hours: 0, minutes: 30 });
  });
  test('both filled → combined', () => {
    expect(parsePlaytimeInput('2', '15')).toEqual({ hours: 2, minutes: 15 });
  });
  test('decimal hours → fractional part becomes minutes', () => {
    expect(parsePlaytimeInput('5.5', '')).toEqual({ hours: 5, minutes: 30 });
  });
  test('decimal hours + minutes → carry into next hour', () => {
    expect(parsePlaytimeInput('5.5', '30')).toEqual({ hours: 6, minutes: 0 });
  });
  test('minutes overflow → carry into hours', () => {
    expect(parsePlaytimeInput('5', '90')).toEqual({ hours: 6, minutes: 30 });
  });
  test('invalid / negative input → null (silent)', () => {
    expect(parsePlaytimeInput('abc', '')).toBeNull();
    expect(parsePlaytimeInput('', 'xyz')).toBeNull();
    expect(parsePlaytimeInput('-1', '0')).toBeNull();
    expect(parsePlaytimeInput('5', '-10')).toBeNull();
    expect(parsePlaytimeInput('5', '30.5')).toBeNull(); // decimal minutes rejected
  });
});

// ── sortYearItems — verbatim copy from game-vault.html ──
function sortYearItems(rows, mode) {
  const out = rows.slice();
  if (mode === 'playtime-desc') {
    out.sort((a, b) => {
      const d = getPlaytimeForSort(b.item) - getPlaytimeForSort(a.item);
      return d !== 0 ? d : a.item.name.localeCompare(b.item.name);
    });
  } else if (mode === 'playtime-asc') {
    out.sort((a, b) => {
      const d = getPlaytimeForSort(a.item) - getPlaytimeForSort(b.item);
      return d !== 0 ? d : a.item.name.localeCompare(b.item.name);
    });
  } else if (mode === 'az') {
    out.sort((a, b) => a.item.name.localeCompare(b.item.name));
  } else if (mode === 'za') {
    out.sort((a, b) => b.item.name.localeCompare(a.item.name));
  }
  return out;
}

describe('sortYearItems', () => {
  const mk = (name) => ({
    item: { name },
    sourceLabel: 'V',
    sourceClass: 'src-vault',
    sourceKind: 'vault',
    sourceId: null,
  });

  test('default preserves input order', () => {
    const rows = [mk('Zelda 2024 5h'), mk('Aero 2024 10h'), mk('Doom 2024')];
    expect(sortYearItems(rows, 'default').map(r => r.item.name))
      .toEqual(['Zelda 2024 5h', 'Aero 2024 10h', 'Doom 2024']);
  });

  test('playtime-desc orders by hours desc, ties by name asc', () => {
    const rows = [mk('Zelda 2024 5h'), mk('Halo 2024 10h'), mk('Aero 2024 5h'), mk('Doom 2024')];
    expect(sortYearItems(rows, 'playtime-desc').map(r => r.item.name))
      .toEqual(['Halo 2024 10h', 'Aero 2024 5h', 'Zelda 2024 5h', 'Doom 2024']);
  });

  test('playtime-asc puts no-playtime items first', () => {
    const rows = [mk('Halo 2024 10h'), mk('Doom 2024'), mk('Aero 2024 5h')];
    expect(sortYearItems(rows, 'playtime-asc').map(r => r.item.name))
      .toEqual(['Doom 2024', 'Aero 2024 5h', 'Halo 2024 10h']);
  });

  test('az sorts by item.name', () => {
    const rows = [mk('Zelda'), mk('Aero'), mk('Mario')];
    expect(sortYearItems(rows, 'az').map(r => r.item.name))
      .toEqual(['Aero', 'Mario', 'Zelda']);
  });

  test('za reverses az', () => {
    const rows = [mk('Aero'), mk('Zelda'), mk('Mario')];
    expect(sortYearItems(rows, 'za').map(r => r.item.name))
      .toEqual(['Zelda', 'Mario', 'Aero']);
  });

  test('empty array returns empty', () => {
    expect(sortYearItems([], 'playtime-desc')).toEqual([]);
  });

  test('does not mutate caller array', () => {
    const rows = [mk('Zelda'), mk('Aero')];
    const before = rows.map(r => r.item.name);
    sortYearItems(rows, 'az');
    expect(rows.map(r => r.item.name)).toEqual(before);
  });
});

// ── Phase 9A: parseLinesWithYearHeaders + parseTrailingDate ───────────────
// Verbatim copy from game-vault.html (Phase 9A)

const _DATE_NUM_PREFIX_RX  = /^\s*\d+\.?(?:\s+|$)/;
const _DATE_PLUS_SUFFIX_RX = /\s*\++\s*$/;
const _DATE_URL_RX         = /^\s*https?:\/\//i;
const _DATE_LICENSE_RX     = /^\s*[A-Za-z0-9]+(?:-[A-Za-z0-9]+){2,}\b/;
const _DATE_YEAR_ONLY_RX   = /^\s*(?:19|20)\d{2}\s*$/;
const _DATE_WORD_YEAR_RX   = /^[A-Za-z]+\s+(?:19|20)\d{2}$/;
const _DATE_ONLY_PUNCT_RX  = /^[\s,.\-_:]*$/;
const _MONTHS = {
  jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4,
  may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8,
  sep:9, sept:9, september:9, oct:10, october:10, nov:11, november:11,
  dec:12, december:12
};
const _MONTH_TOKEN_RX = /\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i;

function parseTrailingDate(name) {
  if (typeof name !== 'string' || !name) return { cleanedName: name, month: null, day: null };
  const firstMatch = _MONTH_TOKEN_RX.exec(name);
  if (!firstMatch) return { cleanedName: name, month: null, day: null };
  const month = _MONTHS[firstMatch[0].toLowerCase()];
  if (!month) return { cleanedName: name, month: null, day: null };

  const cut = firstMatch.index;
  let cleaned = name.slice(0, cut);
  if (cleaned.trim() === '') {
    return { cleanedName: name.trim(), month: null, day: null };
  }
  const tail = name.slice(cut);

  let day = null;
  let dayBeforeMatched = false;
  const ma = /^[A-Za-z]+[\s,.\-]*(\d{1,2})\b/.exec(tail);
  if (ma) {
    const d = parseInt(ma[1], 10);
    if (d >= 1 && d <= 31) day = d;
  }
  if (day === null) {
    const mb = /(?:^|[,.\-])\s*(\d{1,2})\s*[,.\-\s]*$/.exec(cleaned);
    if (mb) {
      const d = parseInt(mb[1], 10);
      if (d >= 1 && d <= 31) { day = d; dayBeforeMatched = true; }
    }
  }

  cleaned = cleaned.replace(/\s*(?:19|20)\d{2}\s*$/, '');
  if (dayBeforeMatched) {
    cleaned = cleaned.replace(/[\s,.\-]+\d{1,2}\s*[,.\-\s]*$/, '');
  }
  cleaned = cleaned.replace(/[\s,.\-]+$/, '').trim();
  if (!cleaned) cleaned = name.trim();
  return { cleanedName: cleaned, month, day };
}

function parseLinesWithYearHeaders(rawLines) {
  const HEADER_RX = /^\s*(19[7-9]\d|20[0-2]\d|2030)\s*$/;
  const entries = [];
  let currentYear = null;
  let headers = 0;
  for (const raw of rawLines) {
    if (typeof raw !== 'string') continue;
    const line = raw.replace(/^﻿/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    const hm = HEADER_RX.exec(trimmed);
    if (hm) { currentYear = parseInt(hm[1], 10); headers++; continue; }

    if (_DATE_URL_RX.test(trimmed)) continue;
    if (_DATE_LICENSE_RX.test(trimmed)) continue;

    let work = trimmed.replace(_DATE_NUM_PREFIX_RX, '').replace(_DATE_PLUS_SUFFIX_RX, '').trim();
    if (!work) continue;

    const { cleanedName, month, day } = parseTrailingDate(work);
    const name = cleanedName.trim();
    if (!name) continue;
    if (_DATE_ONLY_PUNCT_RX.test(name)) continue;
    if (_DATE_YEAR_ONLY_RX.test(name)) continue;
    if (_DATE_WORD_YEAR_RX.test(name)) continue;

    entries.push({ name, date: { year: currentYear, month, day } });
  }
  return { entries, headers };
}

describe('parseLinesWithYearHeaders (Phase 9A)', () => {
  const parse = (lines) => parseLinesWithYearHeaders(lines).entries;

  test('strips number prefix and trailing + under year header', () => {
    expect(parse(['2013', '1. Far Cry +'])).toEqual([
      { name: 'Far Cry', date: { year: 2013, month: null, day: null } }
    ]);
  });

  test('parses month + day after game name (dots separator)', () => {
    expect(parse(['2020', '168. The Amazing Spiderman 2......Oct 12'])).toEqual([
      { name: 'The Amazing Spiderman 2', date: { year: 2020, month: 10, day: 12 } }
    ]);
  });

  test('parses day before month (dots separator)', () => {
    expect(parse(['2020', '169. Warhammer 40,000: Space Marine....13 oct'])).toEqual([
      { name: 'Warhammer 40,000: Space Marine', date: { year: 2020, month: 10, day: 13 } }
    ]);
  });

  test('parses full month name with dash separator', () => {
    expect(parse(['2021', '184. Transformers: Fall of Cybertron - january 12'])).toEqual([
      { name: 'Transformers: Fall of Cybertron', date: { year: 2021, month: 1, day: 12 } }
    ]);
  });

  test('parses date with comma + multiple dashes', () => {
    expect(parse(['2020', '176. Rage ,december--- 2'])).toEqual([
      { name: 'Rage', date: { year: 2020, month: 12, day: 2 } }
    ]);
  });

  test('month appears twice — takes first occurrence', () => {
    expect(parse(['2021', '189. Recore january 24 january'])).toEqual([
      { name: 'Recore', date: { year: 2021, month: 1, day: 24 } }
    ]);
  });

  test('header year wins over inline year', () => {
    expect(parse(['2025', '276. Eternal dread 2 2019 dec 15'])).toEqual([
      { name: 'Eternal dread 2', date: { year: 2025, month: 12, day: 15 } }
    ]);
  });

  test('parses short month + day', () => {
    expect(parse(['2021', '207. Transformers: The Game Nov 20'])).toEqual([
      { name: 'Transformers: The Game', date: { year: 2021, month: 11, day: 20 } }
    ]);
  });

  test('skips one-word + year line', () => {
    expect(parse(['abanson 2007'])).toEqual([]);
  });

  test('skips URL line', () => {
    expect(parse(['https://mrantifun.net/threads/1234'])).toEqual([]);
  });

  test('skips license key line (3+ dashed segments + trailing junk)', () => {
    expect(parse(['3xwg7-rwzpn-Ltb2q-4yzq4 ----idm key'])).toEqual([]);
  });

  test('skips bare number prefix (empty after strip)', () => {
    expect(parse(['1.'])).toEqual([]);
  });

  test('plain game without date under year header', () => {
    expect(parse(['2019', 'Halo Reach'])).toEqual([
      { name: 'Halo Reach', date: { year: 2019, month: null, day: null } }
    ]);
  });

  test('number prefix without period', () => {
    expect(parse(['2013', '3 Far Cry'])).toEqual([
      { name: 'Far Cry', date: { year: 2013, month: null, day: null } }
    ]);
  });

  test('back-compat: year header applies year to subsequent items', () => {
    const r = parse(['2013', 'Crysis 2', 'Bioshock Infinite']);
    expect(r).toEqual([
      { name: 'Crysis 2', date: { year: 2013, month: null, day: null } },
      { name: 'Bioshock Infinite', date: { year: 2013, month: null, day: null } }
    ]);
  });
});

// ── Phase 9C: groupByReleaseYear ──────────────────────────────────────────
// Verbatim copy from game-vault.html (Phase 9C). Relies on getPlaytimeForItem
// already defined earlier in the test file.

function groupByReleaseYear(items) {
  if (!Array.isArray(items)) return [];
  const counts = new Map();
  const hours  = new Map();
  for (const it of items) {
    if (!it) continue;
    const y = Number(it.year);
    if (!Number.isFinite(y)) continue;
    counts.set(y, (counts.get(y) || 0) + 1);
    const p = getPlaytimeForItem(it);
    if (p) hours.set(y, (hours.get(y) || 0) + p.hours + p.minutes / 60);
  }
  const out = [];
  for (const [year, count] of counts) {
    out.push({ year, count, hours: hours.get(year) || 0 });
  }
  out.sort((a, b) => a.year - b.year);
  return out;
}

describe('groupByReleaseYear (Phase 9C)', () => {
  test('groups items by item.year, counting occurrences', () => {
    const items = [
      { name: 'A', year: 1999 },
      { name: 'B', year: 1999 },
      { name: 'C', year: 2010 }
    ];
    expect(groupByReleaseYear(items)).toEqual([
      { year: 1999, count: 2, hours: 0 },
      { year: 2010, count: 1, hours: 0 }
    ]);
  });

  test('skips items without finite item.year', () => {
    const items = [
      { name: 'A', year: 2010 },
      { name: 'B' },
      { name: 'C', year: undefined },
      { name: 'D', year: 'abc' }
    ];
    expect(groupByReleaseYear(items)).toEqual([
      { year: 2010, count: 1, hours: 0 }
    ]);
  });

  test('sums playtime hours per year', () => {
    const items = [
      { name: 'A', year: 2010, playtime: { hours: 5, minutes: 0  } },
      { name: 'B', year: 2010, playtime: { hours: 0, minutes: 30 } },
      { name: 'C', year: 2015, playtime: { hours: 2, minutes: 0  } }
    ];
    expect(groupByReleaseYear(items)).toEqual([
      { year: 2010, count: 2, hours: 5.5 },
      { year: 2015, count: 1, hours: 2   }
    ]);
  });

  test('returns [] for empty input', () => {
    expect(groupByReleaseYear([])).toEqual([]);
    expect(groupByReleaseYear(null)).toEqual([]);
    expect(groupByReleaseYear(undefined)).toEqual([]);
  });

  test('result is sorted ascending by year', () => {
    const items = [
      { name: 'A', year: 2010 },
      { name: 'B', year: 1999 },
      { name: 'C', year: 2020 }
    ];
    const years = groupByReleaseYear(items).map(b => b.year);
    expect(years).toEqual([1999, 2010, 2020]);
  });
});

describe('bulkAdd keepDupes (Phase 11)', () => {
  beforeEach(() => {
    _idCounter = 0;
    state = { vault: [], played: [], vIndex: new SearchIndex(), pIndex: new SearchIndex(), customLists: {} };
  });

  test('keepDupes=false: existing-DB match stays skipped (unchanged) and recorded in duplicates', () => {
    bulkAdd(['Max Payne']);
    const r = bulkAdd(['Max Payne']);
    expect(r.added).toBe(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].input).toBe('Max Payne');
    expect(r.duplicates[0].existing.name).toBe('Max Payne');
  });

  test('keepDupes=true: existing-DB match IS added; duplicates records it; skipped stays empty', () => {
    bulkAdd(['Max Payne']);
    const r = bulkAdd(['Max Payne'], 'vault', { keepDupes: true });
    expect(r.added).toBe(1);
    expect(r.skipped).toHaveLength(0);
    expect(r.duplicates).toHaveLength(1);
    expect(state.vault).toHaveLength(2);
  });

  test('within-paste dup with keepDupes=true: both added, 2nd in duplicates pointing at 1st', () => {
    const r = bulkAdd(['Halo', 'Halo'], 'vault', { keepDupes: true });
    expect(r.added).toBe(2);
    expect(r.skipped).toHaveLength(0);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].input).toBe('Halo');
    expect(r.duplicates[0].existing).toBe(r.addedItems[0]);
    expect(state.vault).toHaveLength(2);
  });

  test('brand-new games: added normally, duplicates stays empty', () => {
    const r = bulkAdd(['Doom', 'Quake', 'Halo'], 'vault', { keepDupes: true });
    expect(r.added).toBe(3);
    expect(r.duplicates).toHaveLength(0);
    expect(r.skipped).toHaveLength(0);
  });
});
