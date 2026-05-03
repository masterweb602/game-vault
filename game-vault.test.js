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

// ── Tests ────────────────────────────────────────────────────────────────────

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
