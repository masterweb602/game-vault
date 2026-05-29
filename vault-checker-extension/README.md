# Vault Checker — cross-browser extension

Select one or more game names on **any** webpage and a small floating panel shows
whether each name is in your **Game Vault** — ✓ in vault (green) / ✗ not in vault (red).

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

## First-time setup (load your vault)
1. In Game Vault, export your library as JSON (Settings → Export JSON). The shape is
   `{ "version": 2, "vault": [ { "name": "..." } ], "played": [ ... ] }`.
2. Click the **Vault Checker** toolbar icon to open the popup.
3. **Paste** the JSON into the textarea (or use **Choose File** to pick the `.json`).
   You can also paste a plain list of names (one per line / comma-separated).
4. Press **Load vault**. It shows how many games were loaded.
5. Use the **Detection** switch to turn checking on/off (default **On**).
   Optionally adjust the **Fuzzy threshold** (0.50–0.95; default 0.82) and re-load.

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
popup.html / popup.js      load/clear vault, on/off toggle, threshold
vendor/browser-polyfill.js webextension-polyfill 0.12.0 (local)
icons/                     toolbar icons
```

## Notes
- The export only contains `vault` + `played`; custom databases (e.g. ps2/ps3) are not
  part of the JSON export, so they aren't checked.
- Re-export and re-load whenever your vault changes to keep results current.
- Selections are checked in the top frame only (not inside cross-origin iframes).
