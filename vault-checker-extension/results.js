/* results.js — full-page view of the Vault Checker scan results.
 * Reads `scanResults` from chrome.storage.local and renders three lists
 * (Not in vault / In vault / Completed), each with a count, a Copy button
 * (names only, one per line) and a per-list Clear. A global Clear all too.
 * Live-updates via chrome.storage.onChanged. Read/write only — no matching. */
(function () {
  'use strict';

  const S = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local
          : (typeof browser !== 'undefined' && browser.storage) ? browser.storage.local : null;
  const STORAGE_NS = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage
                   : (typeof browser !== 'undefined' && browser.storage) ? browser.storage : null;
  const RT = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime
           : (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : null;
  const KEY = 'scanResults';

  // Section key → { title, elementId }. Order here = render order on the page.
  const SECTIONS = [
    { key: 'notInVault', title: 'Not in vault', el: 'sec-notInVault' },
    { key: 'inVault',    title: 'In vault',     el: 'sec-inVault' },
    { key: 'completed',  title: 'Completed',    el: 'sec-completed' }
  ];

  const $ = (id) => document.getElementById(id);
  const metaEl = $('meta');

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

  function getData(cb) {
    storageGet([KEY]).then((res) => {
      const r = res[KEY] || {};
      cb({
        inVault: Array.isArray(r.inVault) ? r.inVault : [],
        completed: Array.isArray(r.completed) ? r.completed : [],
        notInVault: Array.isArray(r.notInVault) ? r.notInVault : [],
        updatedAt: r.updatedAt || 0
      });
    }).catch(() => cb({ inVault: [], completed: [], notInVault: [], updatedAt: 0 }));
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  function flash(btn, msg) {
    const orig = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = orig; }, 1200);
  }

  // Write back one list emptied (or all), with a fresh updatedAt so content
  // scripts treat it as an external change and don't resurrect the data.
  function clearList(key) {
    getData((d) => {
      if (key === 'all') { d.inVault = []; d.completed = []; d.notInVault = []; }
      else d[key] = [];
      storageSet({ [KEY]: {
        inVault: d.inVault, completed: d.completed, notInVault: d.notInVault, updatedAt: Date.now()
      }}).catch(() => {});
      // onChanged will re-render.
    });
  }

  function renderSection(sec, items) {
    const host = $(sec.el);
    host.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'sec-head';
    const dot = document.createElement('span'); dot.className = 'sec-dot';
    const title = document.createElement('span'); title.className = 'sec-title'; title.textContent = sec.title;
    const count = document.createElement('span'); count.className = 'sec-count'; count.textContent = '(' + items.length + ')';
    const actions = document.createElement('div'); actions.className = 'sec-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button'; copyBtn.textContent = 'Copy';
    copyBtn.disabled = items.length === 0;
    copyBtn.addEventListener('click', () => {
      copyText(items.map((e) => e.name).join('\n'));
      flash(copyBtn, 'Copied');
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button'; clearBtn.className = 'danger'; clearBtn.textContent = 'Clear';
    clearBtn.disabled = items.length === 0;
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear the "' + sec.title + '" list (' + items.length + ' items)?')) clearList(sec.key);
    });

    actions.appendChild(copyBtn);
    actions.appendChild(clearBtn);
    head.appendChild(dot); head.appendChild(title); head.appendChild(count); head.appendChild(actions);
    host.appendChild(head);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nothing here yet.';
      host.appendChild(empty);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'list';
    for (const e of items) {
      const li = document.createElement('li');
      li.className = 'item';
      let nameNode;
      if (e.url) {
        nameNode = document.createElement('a');
        nameNode.href = e.url; nameNode.target = '_blank'; nameNode.rel = 'noopener noreferrer';
        nameNode.title = e.url;
      } else {
        nameNode = document.createElement('span');
        nameNode.className = 'nm';
      }
      nameNode.textContent = e.name;
      li.appendChild(nameNode);
      if (e.db) {
        const db = document.createElement('span');
        db.className = 'db';
        db.textContent = '— ' + e.db;
        li.appendChild(db);
      }
      ul.appendChild(li);
    }
    host.appendChild(ul);
  }

  function render(d) {
    const lists = { notInVault: d.notInVault, inVault: d.inVault, completed: d.completed };
    for (const sec of SECTIONS) renderSection(sec, lists[sec.key]);
    const total = d.inVault.length + d.completed.length + d.notInVault.length;
    metaEl.textContent = total + ' total' + (d.updatedAt ? ' · updated ' + new Date(d.updatedAt).toLocaleString() : '');
    $('clear-all').disabled = total === 0;
  }

  $('clear-all').addEventListener('click', () => {
    getData((d) => {
      const total = d.inVault.length + d.completed.length + d.notInVault.length;
      if (total === 0) return;
      if (confirm('Clear ALL results (' + total + ' items across the three lists)?')) clearList('all');
    });
  });

  if (STORAGE_NS && STORAGE_NS.onChanged && STORAGE_NS.onChanged.addListener) {
    STORAGE_NS.onChanged.addListener((changes, area) => {
      if (area === 'local' && (KEY in changes)) getData(render);
    });
  }

  if (!S) {
    metaEl.textContent = 'Storage unavailable.';
  } else {
    getData(render);
  }
})();
