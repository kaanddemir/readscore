/**
 * Service worker:
 *  - removes ReadScore 1.x storage on install/update, so no 1.x preference leaks into 2.0;
 *  - owns the inserted stylesheets of Comfort, Calm (USER origin) and Focus (AUTHOR), which need an extension
 *    context and must finish even when the popup closes mid update (src/background/sheets.ts).
 * The worker never receives page content: only a tab id and the stylesheet built from settings.
 */
import { fail, isSheetApply } from '../shared/messages';
import { LEGACY_KEYS } from '../shared/settings';
import { createSheetController } from './sheets';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove([...LEGACY_KEYS]).catch(() => {});
});

const sheets = createSheetController(chrome.scripting);

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (!isSheetApply(msg)) return false;
  // Only our own extension pages (the popup) may drive page stylesheets; content scripts and pages may not.
  if (sender.id !== chrome.runtime.id || sender.tab) {
    sendResponse(fail('INVALID_MESSAGE', 'Not allowed.'));
    return false;
  }
  sheets
    .apply(msg.payload.tabId, msg.payload.key, msg.payload.css)
    .then(sendResponse)
    .catch((e: unknown) => sendResponse(fail('INTERNAL', e instanceof Error ? e.message : String(e))));
  return true; // async response
});
