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
}

// ── Stubs for bulkAdd ────────────────────────────────────────────────────────

let state = { vault: [], played: [], vIndex: null, pIndex: null };
let _idCounter = 0;
function newId() { return 'g_test_' + (++_idCounter); }
function scheduleSave() {}

function bulkAdd(names, target = 'vault', { dedupe = true } = {}) {
  const idx = target === 'vault' ? state.vIndex : state.pIndex;
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
    state[target].push(item);
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

  scheduleSave(target);
  return { added: addedItems.length, addedItems, skipped, flagged };
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
    state = { vault: [], played: [], vIndex: new SearchIndex(), pIndex: new SearchIndex() };
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
