# Game Vault → Claude Code Guide

Game Vault project-টা Claude Code-এ improve করার জন্য একটা step-by-step guide। শুরু থেকে শেষ পর্যন্ত।

---

## ১. কী কী ফাইল লাগবে

Claude Code-এ project শুরু করার আগে, একটা folder বানাও PC-তে। নাম দাও যেমন `game-vault-project`। সেই folder-এ ৩টা ফাইল রাখো:

| ফাইল | কোথায় পাবে | কেন দরকার |
|---|---|---|
| `game-vault.html` | Settings tab → "📦 HTML + my data" বাটন থেকে download | মূল source code + তোমার current data |
| `game-vault-spec.md` | আমি আগে যেটা বানিয়েছি | architecture + design intent বুঝতে |
| `CLAUDE.md` | নিচে template দিচ্ছি | Claude Code কে রুলস বলে দেওয়ার জন্য |

CSV file আলাদা করে দিতে হবে না — HTML file-এ data embedded থাকবে।

---

## ২. CLAUDE.md template (folder-এ এই নামে save করো)

এই file-টা Claude Code automatic পড়বে যখন folder-এ ঢুকবে। তাই rules আগে থেকে set হয়ে থাকবে।

```markdown
# Game Vault — Project Rules

## What this is
Single-file HTML game library app with fuzzy search, bulk operations,
and persistent storage. Bengali UI with English technical terms.

## Hard rules — never break these
- DO NOT rewrite in React, TypeScript, Vue, or any framework
- DO NOT split into multiple files unless explicitly asked
- DO NOT remove Bengali UI text
- DO NOT change the storage backend without explicit permission
- DO NOT touch the normalize() / normalizeDedup() / SearchIndex logic
  without showing me the change first
- Keep portable single-file deliverable working

## Style
- Vanilla JS, no build step required
- Inline CSS, inline JS
- Code style: short variable names, comments where logic is non-obvious
- Match existing patterns — see existing code first

## Workflow
- Before any code change, explain what you'll do and wait for my approval
- For new features, suggest where in the file to add (preserve grouping)
- After change, syntax-check the JS block before declaring done
- Don't add dependencies unless I approve

## Read before working
- game-vault-spec.md — full architecture and design decisions
```

---

## ৩. Claude Code চালু করা

### Setup (একবার)
```bash
# Node.js install করা থাকলে:
npm install -g @anthropic-ai/claude-code

# তারপর folder-এ যাও:
cd path/to/game-vault-project

# Claude Code চালাও:
claude
```

### প্রথম কথা যা বলবে

```
এই folder-এ আমার একটা game library web app আছে।
game-vault.html main source। game-vault-spec.md architecture।
CLAUDE.md rules।

প্রথম কাজ: spec.md আর CLAUDE.md পড়ো। তারপর
game-vault.html-এর structure বুঝতে file-এ glance করো।
কোনো edit করবে না — শুধু আমাকে summary দাও তুমি কী বুঝলে।
```

এতে Claude Code পুরো context-এ ঢুকবে। তুমি দেখবে সে ঠিকঠাক বুঝেছে কিনা।

---

## ৪. Step-by-step task instructions (priority order)

### Task 1: Test suite (সবচেয়ে দরকার)

```
Vitest দিয়ে test suite add করো। শুধু test file বানাও,
source code edit করবে না।

যেগুলো test করতে হবে:
1. normalize() — "Max Payne" ↔ "Max: Payne 2013 Definitive Edition" same
2. normalize() — "Max Payne" ≠ "Max Payne 2"
3. normalizeDedup() — "Last of Us" ≠ "Last of Us Remastered"
4. tokenSort() — word reorder
5. Roman numerals — II = 2
6. SearchIndex.matchOne() — exact, fuzzy, acronym (CSGO → Counter-Strike: GO)
7. bulkAdd() — exact dup skipping, fuzzy flagging
8. CSV round-trip — export then import preserves data
9. Levenshtein early termination

setup এ একটু কঠিন হতে পারে কারণ source HTML-এ embedded।
Possible approach: HTML থেকে <script> extract করে eval করার একটা
helper বানাও test/helpers/load-app.js-এ।

কাজ শুরু করার আগে plan দেখাও।
```

### Task 2: Code modularize (internal organization, single file রাখবে)

```
game-vault.html-এর JS block-টা logical sections-এ ভাগ করো।
তবে এখনো single file রাখবে। শুধু সেকশন headers ও grouping
improve করবে।

বর্তমান section markers (যেমন /* ─── Storage layer ─── */)
preserve করো। কোনো নতুন build tooling add করবে না।
```

### Task 3: IndexedDB upgrade (যদি library বড় হয়)

```
localStorage backend-টা IndexedDB দিয়ে replace করো।
কিন্তু:
- Storage object-এর public API (get, set, del, available, label)
  same রাখবে — কোনো caller code change করবে না
- localStorage থেকে existing data IndexedDB-তে migrate হবে
  first run এ
- Dexie.js use করো — CDN থেকে import, build step add করবে না
- artifact storage tier (window.storage) untouched থাকবে

Plan দেখাও আগে।
```

### Task 4: Web Worker-এ search engine

```
SearchIndex-এর fuzzy match logic একটা Web Worker-এ move করো।
- Main thread freeze হবে না bulk check-এর সময়
- API surface একই থাকবে — caller code change করবে না
- Single-file portability রাখতে Worker-টা inline blob হিসেবে create করবে
- Worker-এ Levenshtein, trigram, normalize সব duplicate করতে হবে

Specifically: idx.matchOne() async হবে, bulk-check chunks parallelize হবে।

Plan দেখাও আগে।
```

### Task 5: PWA (offline + install)

```
এই app-টা PWA বানাও:
- manifest.json (inline data URI ব্যবহার করতে পারো single-file রাখতে)
- Service worker (inline blob)
- Offline-first: একবার load হলে network ছাড়াই চলবে
- Install button browser-এ আসবে (Android-এ "Add to Home Screen")

Single HTML file constraint বজায় রাখবে।
```

---

## ৫. কখন কী জিজ্ঞেস করবে / instruction দিবে

| পরিস্থিতি | কী বলবে |
|---|---|
| নতুন feature | "Plan first, code after my approval" |
| Bug | "Reproduce steps: ..., expected: ..., actual: ..." |
| Performance issue | "Profile করে বলো কোথায় slow। Fix-এর আগে measurement দেখাও।" |
| Refactor | "Behavior preserve করতে হবে। Test suite আগে রান করে দেখাও কিছু ভাঙছে কিনা।" |
| সে যদি rewrite করতে চায় | "STOP. Just edit existing code. No rewrite." |

---

## ৬. Common mistakes — এড়িয়ে চলবে

### ❌ ভুল ভাবে যা বললে কাজ ভেঙে যাবে

> "Improve the project"
> → vague। সে যা ইচ্ছে rewrite করবে।

> "Make it modern"
> → React/TypeScript-এ চলে যাবে।

> "Fix all bugs"
> → কোন bug? specifically বলতে হবে।

### ✅ ঠিক ভাবে বলা

> "Add a Vitest test for the normalize() function with these specific cases: [list]। কোনো source code edit করবে না।"

> "search input লাগে slow। 50000+ items এ 200ms+ delay। profile করো, কোথায় bottleneck দেখাও।"

> "Settings tab-এ একটা new card add করো 'Backup to clipboard' নামে। JSON-টা clipboard-এ copy হবে।"

---

## ৭. সবচেয়ে ভালো single-prompt template

প্রতিটা task-এর জন্য এই pattern ব্যবহার করো:

```
[কাজের নাম]

Context:
- কী file-এ change করতে হবে
- কোন function/section

Requirement:
- ১) ...
- ২) ...
- ৩) ...

Constraints:
- single HTML file রাখবে
- existing API/UI ভাঙবে না
- Bengali text untouched

Workflow:
1. Plan দেখাও আগে
2. আমি approve করলে code change করো
3. শেষে syntax check + behavior verify

কোনো question থাকলে এখনই জিজ্ঞেস করো।
```

---

## ৮. একটা সম্পূর্ণ session-এর example

```
You: এই folder-এ গেম লাইব্রেরির app আছে। CLAUDE.md, spec.md
     আর game-vault.html আছে। সব পড়ে বলো structure।

CC:  [reads files] OK, structure বুঝলাম। 5টা tab আছে: Vault,
     Played, Bulk Add, Bulk Check, Settings। SearchIndex class
     trigram-based fuzzy match করে। Storage 3-tier...

You: ভালো। প্রথম কাজ: Vitest দিয়ে test setup। শুধু:
     - package.json with vitest
     - test/normalize.test.js with 10 cases
     - test/helpers/load-app.js to extract <script> from HTML
     game-vault.html ফাইলে কোনো change করবে না।

CC:  Plan: [outline]. শুরু করবো?

You: হ্যাঁ।

CC:  [creates files] Done। `npm test` চালাও, সব pass হবে।

You: ধন্যবাদ। এখন next task: ...
```

---

## ৯. Important — যা মনে রাখবে

- **Claude Code-এ memory নাই session-এর বাইরে।** নতুন session শুরু হলে পুরোটা আবার বুঝিয়ে দিতে হবে। তাই CLAUDE.md ফাইলটা গুরুত্বপূর্ণ।

- **প্রতিটা কাজ আলাদা session-এ করা ভালো।** এক session-এ অনেক কাজ দিলে গন্ডগোল হয়।

- **git ব্যবহার করো।** প্রতিটা session শুরুর আগে `git commit` করে রাখো। Claude Code কিছু ভেঙে ফেললে `git reset` দিয়ে undo করতে পারবে।

- **প্রথম session-এ ছোট কাজ দিয়ে test করো।** যেমন "একটা comment add করো line 100-এ" — এতে দেখবে সে file ঠিকঠাক handle করছে কিনা।

- **Tokens limit আছে।** বড় file বার বার read করালে cost বাড়বে। তাই specific section read করতে বলো — "view lines 1700-1800" এর মতো।
