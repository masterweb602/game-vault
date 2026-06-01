/* match-engine.js — VERBATIM copy of Game Vault's matching pipeline.
 *
 * Copied unchanged from game-vault.html (the main-thread copies):
 *   normalize / normalizeDedup / tokenSort, levenshtein / stringSim,
 *   _lastNumericToken / _dedupTokensDiffer, and class SearchIndex (incl. matchOne).
 *
 * This guarantees the extension's "same game" decision is identical to what the
 * vault considers a match (default fuzzy threshold 0.82). DO NOT edit the logic
 * here — keep it byte-for-byte in sync with game-vault.html.
 *
 * Exposed as `self.VaultMatch` so both content.js and popup.js can use it.
 */
(function (root) {
  'use strict';

  const ROMAN = {
    'i':'1','ii':'2','iii':'3','iv':'4','v':'5','vi':'6','vii':'7','viii':'8','ix':'9',
    'x':'10','xi':'11','xii':'12','xiii':'13','xiv':'14','xv':'15','xvi':'16','xvii':'17','xviii':'18','xix':'19','xx':'20'
  };

  // Combined edition keyword regex (longest match first inside groups)
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

  const YEAR_RX = /\b(19|20)\d{2}\b/g;
  const YEAR_DETECT_RX = /\b(19[7-9]\d|20[0-2]\d|2030)\b/g;
  const PLAYTIME_RX = /\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi;
  const PAREN_RX = /\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g;
  const APOSTROPHE_RX = /[‘’‚‛'`´]/g;
  const NON_ALPHANUM_RX = /[^a-z0-9\s]/g;
  const ROMAN_RX = /\b([ivx]+)\b/g;
  const TM_RX = /[®™©]/g;
  const WS_RX = /\s+/g;

  // Strip playtime tokens (5h, 45 min, 2.5 hours...) that appear AFTER
  // the rightmost detected year. Anchoring on the year avoids damaging
  // titles like "24 Hours Later".
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
    s = s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ');
    s = s.replace(/\b(third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/g, m => ({third:'3',fourth:'4',fifth:'5',sixth:'6',seventh:'7',eighth:'8',ninth:'9',tenth:'10'})[m]);
    s = s.replace(APOSTROPHE_RX, '');     // remove apostrophes (Assassin's → Assassins)
    s = s.replace(TM_RX, ' ');
    s = s.replace(PAREN_RX, ' ');         // strip (...) [...] {...}
    s = _stripPlaytimeAfterYear(s);       // strip "5h"/"2.5 hours" before NON_ALPHANUM breaks decimals
    s = s.replace(NON_ALPHANUM_RX, ' ');  // collapse special chars
    s = s.replace(YEAR_RX, ' ');          // remove years
    s = s.replace(EDITION_RX, ' ');       // strip edition keywords
    // Roman numerals → digits
    s = s.replace(ROMAN_RX, (m) => ROMAN[m] !== undefined ? ROMAN[m] : m);
    s = s.replace(WS_RX, ' ').trim();
    return s;
  }

  // Light normalization for dedup — keeps edition words & years so
  // "The Last of Us" ≠ "The Last of Us Remastered" in bulk add.
  // Only used for duplicate checking, NOT for fuzzy matching.
  function normalizeDedup(str) {
    if (!str) return '';
    let s = str.toLowerCase();
    s = s.replace(APOSTROPHE_RX, '');
    s = s.replace(TM_RX, ' ');
    s = s.replace(PAREN_RX, ' ');
    s = _stripPlaytimeAfterYear(s);       // strip "5h"/"2.5 hours" before NON_ALPHANUM breaks decimals
    s = s.replace(NON_ALPHANUM_RX, ' ');
    // Roman numerals → digits (so "II" and "2" still match)
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
    // Always put shorter string in inner loop for cache-friendliness
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
    // Cap maxDist using threshold (e.g., threshold 0.6 means we tolerate up to 40% errors)
    const t = threshold || 0.5;
    const maxDist = Math.floor(maxLen * (1 - t));
    const dist = levenshtein(a, b, maxDist);
    if (dist > maxDist) return 0;
    return 1 - dist / maxLen;
  }

  // Phase 15 follow-up: helpers for matchOne sequel/edition guards.
  // _lastNumericToken protects against trailing-digit fuzzy collisions
  // (Devil May Cry 4/5, Aliens 2021 12/13). _dedupTokensDiffer separates
  // year-only diffs ("Halo 3" vs "Halo 3 2024") from edition diffs
  // ("Freedom Wars 2014" vs "Freedom Wars Remastered 2025").
  function _lastNumericToken(normStr) {
    if (!normStr) return null;
    const tokens = normStr.split(' ');
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(tokens[i])) return tokens[i];
    }
    return null;
  }

  function _dedupTokensDiffer(a, b) {
    const aSet = new Set(a.split(' ').filter(Boolean));
    const bSet = new Set(b.split(' ').filter(Boolean));
    const isYear = (t) => /^(19|20)\d{2}$/.test(t);
    for (const t of aSet) if (!bSet.has(t) && !isYear(t)) return true;
    for (const t of bSet) if (!aSet.has(t) && !isYear(t)) return true;
    return false;
  }

  /* ─── SearchIndex with trigram + token + acronym ─── */
  class SearchIndex {
    constructor() {
      this.items = [];                  // ordered list (insertion order)
      this.byId = new Map();            // id → item
      this.byNorm = new Map();          // norm → first item
      this.byTokenSort = new Map();     // token-sorted → first item
      this.dups = new Map();            // norm → [items]
      this.trigrams = new Map();        // trigram → Set<id>
      this.tokens = new Map();          // token → Set<id>
      this.acronyms = new Map();        // acronym → Set<id>
      this.tokenList = null;            // sorted token list cache (for prefix scan)
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
      if (this.byId.has(id)) return; // already indexed

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

      // Trigrams
      for (const tg of SearchIndex.getTrigrams(norm)) {
        let s = this.trigrams.get(tg);
        if (!s) { s = new Set(); this.trigrams.set(tg, s); }
        s.add(id);
      }

      // Tokens
      const tokens = SearchIndex.getTokens(norm);
      for (const tk of tokens) {
        let s = this.tokens.get(tk);
        if (!s) { s = new Set(); this.tokens.set(tk, s); }
        s.add(id);
      }
      this._tokensDirty = true;

      // Acronym (only meaningful for 2+ tokens, length 2-8)
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
        // Try to find another item with same token-sort to promote
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

    rebuild(items) {
      this.clear();
      for (const it of items) this.add(it);
    }

    // Trigram-based candidate selection — returns top K items by trigram overlap
    getCandidates(norm, limit) {
      const tgs = SearchIndex.getTrigrams(norm);
      if (tgs.length === 0) return [];

      const counts = new Map();
      for (const tg of tgs) {
        const s = this.trigrams.get(tg);
        if (!s) continue;
        for (const id of s) {
          counts.set(id, (counts.get(id) || 0) + 1);
        }
      }
      if (counts.size === 0) return [];

      // Filter: require at least ~30% trigram overlap with query
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
      const queryDedup = normalizeDedup(query);
      const queryLastNum = _lastNumericToken(norm);

      // Fix A: byNorm/tokenSort can be false positives when YEAR_RX or EDITION_RX
      // strip a discriminating word. Keep the hit only when dedup norms either
      // match outright, or differ by year tokens only.
      const _safeExact = (item, score, type) => {
        const candDedup = normalizeDedup(item.name);
        if (candDedup === queryDedup) return { item, score, type };
        if (_dedupTokensDiffer(queryDedup, candDedup)) return null;
        return { item, score, type };
      };

      if (this.byNorm.has(norm)) {
        const r = _safeExact(this.byNorm.get(norm), 1, 'exact');
        if (r) return r;
      }

      const ts = tokenSort(query);
      if (ts && this.byTokenSort.has(ts)) {
        const r = _safeExact(this.byTokenSort.get(ts), 0.97, 'token-sort');
        if (r) return r;
      }

      // Acronym shortcut: if query is 2-8 chars, no spaces, and matches acronym
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
        // Fix B: reject fuzzy candidate whose trailing numeric token differs
        // (Devil May Cry 4 ≠ 5; Aliens 2021 12 ≠ 13).
        if (queryLastNum !== _lastNumericToken(it._norm)) continue;
        const sim = stringSim(norm, it._norm, threshold);
        if (sim >= threshold && (!best || sim > best.score)) {
          best = { item: it, score: sim, type: 'fuzzy' };
          if (sim >= 0.99) break; // can't get better
        }
      }
      // Fix A safety for fuzzy hits with score ≈ 1 (identical _norm), catches the
      // year+edition strip case where _norm matches but dedup-by-edition disagrees.
      if (best && best.score >= 0.999) {
        const candDedup = normalizeDedup(best.item.name);
        if (candDedup !== queryDedup && _dedupTokensDiffer(queryDedup, candDedup)) {
          best = null;
        }
      }
      return best;
    }
  }

  /* ─── cleanGameName — strip year-anchored trailing meta for MATCHING ─────
   * The vault stores names with a trailing "[year][playtime]" bracket block or
   * a plain " <year> <hours>" suffix (e.g. "Crimson Desert 2025 30"). normalize()
   * removes the year but leaves the bare playtime number ("crimson desert 30"),
   * so a clean selection "Crimson Desert" never matches. cleanGameName lifts that
   * meta off BEFORE normalize runs. It is YEAR-ANCHORED: it only strips when a
   * valid 1970–2030 year token is present, so bare game numbers survive intact
   * ("Portal 2", "Devil May Cry 5"). "Devil May Cry 5 2019 20" → "Devil May Cry 5".
   *
   * parseNameMeta + parsePlainMeta are copied verbatim from game-vault.html
   * (Phase 12 name-meta migration). DO NOT use these to mutate the user's vault —
   * they only build the extension's matching copy / the cleaned export. */
  const _NAMEMETA_BRACKET_RX = /\[([^\]]*)\]/g;
  const _NAMEMETA_YEAR_RX    = /^\s*(19[7-9]\d|20[0-2]\d|2030)\s*$/;
  const _NAMEMETA_HOURS_RX   = /^\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*$/i;
  const _NAMEMETA_MINUTES_RX = /^\s*(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\s*$/i;
  function parseNameMeta(name) {
    if (typeof name !== 'string' || !name) {
      return { cleanName: '', year: null, hours: null };
    }
    let year = null, hours = null;
    let yearConsumed = false, ptConsumed = false;
    const cleaned = name.replace(_NAMEMETA_BRACKET_RX, (full, inner) => {
      if (!yearConsumed) {
        const ym = _NAMEMETA_YEAR_RX.exec(inner);
        if (ym) { year = parseInt(ym[1], 10); yearConsumed = true; return ' '; }
      }
      if (!ptConsumed) {
        const hm = _NAMEMETA_HOURS_RX.exec(inner);
        if (hm) { hours = parseFloat(hm[1]);          ptConsumed = true; return ' '; }
        const mm = _NAMEMETA_MINUTES_RX.exec(inner);
        if (mm) { hours = parseFloat(mm[1]) / 60;      ptConsumed = true; return ' '; }
      }
      return full;
    });
    const cleanName = cleaned.replace(/\s+/g, ' ').trim();
    return { cleanName, year, hours };
  }

  const _PLAINMETA_RX = /^(.*?)\s+(19[7-9]\d|20[0-2]\d|2030)\s+(\d+(?:\.\d+)?)\s*$/;
  function parsePlainMeta(name) {
    if (typeof name !== 'string' || !name) {
      return { cleanName: '', year: null, hours: null };
    }
    const m = _PLAINMETA_RX.exec(name);
    if (!m) return { cleanName: name.trim(), year: null, hours: null };
    return {
      cleanName: m[1].trim(),
      year: parseInt(m[2], 10),
      hours: parseFloat(m[3])
    };
  }

  // Returns the base name with year-anchored trailing meta removed. Bracket
  // parser first; fall back to the plain parser only if the bracket parser
  // found nothing. If neither matched, the name passes through untouched.
  function cleanGameName(name) {
    if (typeof name !== 'string' || !name) return '';
    let m = parseNameMeta(name);
    if (m.year === null && m.hours === null) m = parsePlainMeta(name);
    const metaMatched = m.year !== null || m.hours !== null;
    return (metaMatched && m.cleanName) ? m.cleanName : name;
  }

  root.VaultMatch = {
    normalize: normalize,
    normalizeDedup: normalizeDedup,
    tokenSort: tokenSort,
    levenshtein: levenshtein,
    stringSim: stringSim,
    cleanGameName: cleanGameName,
    SearchIndex: SearchIndex,
    DEFAULT_THRESHOLD: 0.82
  };
})(typeof self !== 'undefined' ? self : this);
