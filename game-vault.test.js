import { describe, test, expect, beforeEach } from 'vitest';

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
const PAREN_RX       = /\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g;
const APOSTROPHE_RX  = /[‘’‚‛'`´]/g;
const NON_ALPHANUM_RX = /[^a-z0-9\s]/g;
const ROMAN_RX       = /\b([ivx]+)\b/g;
const TM_RX          = /[®™©]/g;
const WS_RX          = /\s+/g;

function normalize(str) {
  if (!str) return '';
  let s = str.toLowerCase();
  s = s.replace(APOSTROPHE_RX, '');
  s = s.replace(TM_RX, ' ');
  s = s.replace(PAREN_RX, ' ');
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

function bulkAdd(names, target = 'vault', { dedupe = true } = {}) {
  const t = resolveTarget(target);
  if (!t) return { added: 0, addedItems: [], skipped: [], flagged: [] };
  const idx = t.idx;
  const seenDedup = new Map();
  const addedItems = [];
  const skipped = [];
  const flagged = [];

  for (const raw of names) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const nd = normalizeDedup(trimmed);
    const n  = normalize(trimmed);

    let exactDup = null;
    if (dedupe && nd) {
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
      skipped.push({ input: trimmed, existing: exactDup });
      continue;
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
  return { added: addedItems.length, addedItems, skipped, flagged };
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
const YEAR_DETECT_RX = /\b(19[7-9]\d|20[0-2]\d|2030)\b/g;
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
