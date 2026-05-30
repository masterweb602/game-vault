# Vault Checker — cross-browser extension

Select one or more game names on **any** webpage and a small floating panel shows
each name's status against your **Game Vault**:

- **✓ completed** (teal) — in the vault **and** marked Played
- **✓ in vault** (green) — present but not yet played
- **✗ not in vault** (red) — not found

Works on **Chromium** (Chrome / Edge / Brave / Opera) and **Firefox**, Manifest V3.

## How it works
- The matching logic (`match-engine.js`) is a **verbatim copy** of Game Vault's
  `normalize()` / `normalizeDedup()` / `SearchIndex.matchOne()` pipeline, including the
  fuzzy threshold (default **0.82**). So whatever the vault treats as "the same game",
  this extension agrees with.
- Cross-browser via the bundled **`webextension-polyfill`** (`vendor/browser-polyfill.js`,
  local — no CDN). All code uses the promise-based `browser.*` API.
- **No background/service worker** — everything lives in the content script + popup.
- Your vault list is stored **offline** in `browser.storage.local`. Nothing leaves your
  machine.

## Off by default
The extension ships **OFF**. Nothing runs — no selection detection, no syncing —
until you open the popup and flip the **Detection** switch **On**. When OFF both
content scripts are fully inert. State is saved in `chrome.storage.local`
(`enabled`, default `false`).

## Auto-scan
A separate **Auto-scan** toggle (also OFF by default) marks game names *inline* on
any page as you scroll. When On it watches page structure (links, list items,
headings, card/title text, image alt) with an `IntersectionObserver` +
`MutationObserver` — **passive, no polling** — filters out non-games (UI/nav
words, platforms, years/dates, scores, company names, pure numbers/gibberish),
cleans each name and matches it against your vault, then places a small inline
mark: green **✓** in vault · teal **✓** completed · red **✗** not in vault.

- Independent of **Detection** — manual text selection is unaffected; you can run
  either, both, or neither.
- Fully inert when off (no observers, no page changes). Turning it off removes all
  inline marks.
- Detected names are accumulated into three lists in `chrome.storage.local`
  (`scanResults`, with each entry's source URL) for an upcoming results view.
  This data is **preserved** when you toggle Auto-scan off.

## Auto-sync (recommended — no manual upload)
The extension syncs your **full game database** straight from a Game Vault page
(vault + played + every custom DB), so you never have to export/upload by hand,
and it stays fresh as you add/remove games.

1. Open your **Game Vault** — either the local file (`…/game-vault.html`) or the
   hosted copy (`https://masterweb602.github.io/game-vault/…`).
2. Click the **Vault Checker** toolbar icon and flip **Detection On**.
3. That's it — the popup shows **“Synced from Game Vault: N games · last synced …”**.
   Each game is stored with its source database and `played` flag; names are the
   cleaned base names (year/playtime stripped) so matching is accurate.
4. **Live updates:** while a Game Vault tab is open, adding/deleting a game
   re-syncs automatically (via a page event + the cross-tab storage event +
   on tab focus — no polling).

> **Local file users:** for sync to work on a `file://` Game Vault page you must
> enable **“Allow access to file URLs”** on the extension's details page
> (`chrome://extensions` → Vault Checker → **Details** → *Allow access to file URLs*).
> The hosted GitHub Pages copy needs no such permission.

## Manual load (fallback)
You can still load a vault by hand (e.g. on a device without the Game Vault page):
1. In Game Vault → Settings → **Export for Vault Checker** (`{ "version": 3,
   "type": "mother", "games": [ { "name": "...", "played": false } ] }`).
2. Open the popup, **paste** the JSON (or **Choose File**), press **Load vault**.
   You can also paste a plain list of names (one per line / comma-separated).
3. Optionally adjust the **Fuzzy threshold** (0.50–0.95; default 0.82) and re-load.

Then on any page: select text (a name, or several names separated by new lines /
commas) and the panel appears near the selection. Click the **×**, press **Esc**, or
click away to dismiss.

## Load it in Chrome / Edge / Brave / Opera (Chromium)
1. Go to `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `vault-checker-extension` folder.
4. The **Vault Checker** icon appears in the toolbar. (Pin it if needed.)

## Load it in Firefox
1. Go to `about:debugging`.
2. Click **This Firefox** → **Load Temporary Add-on…**.
3. Select the `manifest.json` file inside `vault-checker-extension`.
4. The extension loads until you restart Firefox (temporary add-ons are session-only).

## Files
```
manifest.json              MV3 manifest (Chrome + Firefox)
match-engine.js            verbatim Game Vault matching pipeline (do not edit)
content.js                 selection detection + Shadow-DOM result panel
sync.js                    auto-sync the game DB from a Game Vault page
popup.html / popup.js      load/clear vault, on/off toggle, threshold
vendor/browser-polyfill.js webextension-polyfill 0.12.0 (local)
icons/                     toolbar icons
```

## Notes
- Auto-sync covers the **full** database — vault + played + every custom DB
  (e.g. ps2/ps3) — with each game's source database recorded.
- With auto-sync you don't need to re-export; live updates keep results current.
  The manual export/load remains available as a fallback.
- Selections are checked in the top frame only (not inside cross-origin iframes).
