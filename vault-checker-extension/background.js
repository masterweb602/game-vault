/* background.js — event-driven MV3 service worker.
 * Sole job: register the "Check in Vault" context menu and forward the selected
 * text to the page's content script. No persistent state and no listeners that
 * run continuously — the worker sleeps when idle and wakes only on the menu
 * click (or install/startup to (re)create the menu). */
(function () {
  'use strict';

  const api = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome
            : (typeof browser !== 'undefined' && browser.runtime) ? browser : null;
  if (!api || !api.contextMenus) return;

  const MENU_ID = 'vc-check';

  function createMenu() {
    try {
      api.contextMenus.removeAll(() => {
        void api.runtime.lastError;   // ignore "nothing to remove"
        api.contextMenus.create({
          id: MENU_ID,
          title: 'Check in Vault',
          contexts: ['selection']
        }, () => { void api.runtime.lastError; });
      });
    } catch (e) { /* ignore */ }
  }

  if (api.runtime.onInstalled) api.runtime.onInstalled.addListener(createMenu);
  if (api.runtime.onStartup) api.runtime.onStartup.addListener(createMenu);

  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
    const text = info.selectionText || '';
    try {
      // Sending to the content script needs no extra permission. If the page has
      // no content script (chrome:// etc.), lastError is set — swallow it.
      api.tabs.sendMessage(tab.id, { type: 'vc-check', text: text }, () => {
        void api.runtime.lastError;
      });
    } catch (e) { /* ignore */ }
  });
})();
