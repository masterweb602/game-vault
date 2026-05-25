# Game Vault — Claude Code Rules

## Project Info
- Single HTML file game library app
- Fuzzy search engine with SearchIndex class
- Bengali UI (keep all Bengali text)
- No frameworks, no build step
- Persistent storage (localStorage / artifact storage)
- PWA: inline **blob** manifest (absolute `start_url`/`scope`, 192/512 PNG icons via canvas) + a companion **`sw.js`** (network-first, has a `fetch` handler) so Chrome's `beforeinstallprompt` fires and "Install as app" works one-tap on Android. `sw.js` is the ONE allowed second file (user-approved) — the app HTML itself stays single-file. Downloaded portable copies ship without `sw.js`, so install there falls back to the browser ⋮ menu.

## Rules — NEVER BREAK THESE
1. Single file থাকবে HTML হিসেবে
2. React/TypeScript/Vue কোনো framework add করবে না
3. Bengali UI text remove করবে না
4. normalize() / SearchIndex logic ছুঁবে না বলে না দিলে
5. File-এ কোনো change করার আগে PLAN দেখাবে, আমার OK লাগবে

## How to work
- Read game-vault-spec.md first
- Look at existing code patterns, match them
- Small, focused changes only
- After each change: syntax check করবে

## When I ask for something
- "Test suite add করো" = শুধু test file, source code edit না
- "Feature add করো" = বলে দিব কোথায় যুক্ত করবে
- "Bug fix করো" = reproduce steps বলব, fix করার আগে plan দেখাবে

## Example good task
"Vitest দিয়ে test add করো normalize() এর জন্য। শুধু test file, 
game-vault.html edit করবে না।"

## Example bad task (avoid)
"Improve the code" → vague
"Make it modern" → don't rewrite
"Fix everything" → be specific