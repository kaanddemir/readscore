/** Chrome-backed PopupApi. */
import { BUILD_ID, CONTENT_RUNTIME_FILE } from '../../shared/constants';
import { fail, isResponse, makeRequest, makeSheetApply, ok, type RequestMap, type RequestType, type Response } from '../../shared/messages';
import { ATKINSON_FILES } from '../../shared/comfort';
import { loadSettings, saveSettings } from '../../shared/settings';
import type { PopupApi } from './app';

async function request<T extends RequestType>(tabId: number, type: T, payload: RequestMap[T]['payload']): Promise<Response<RequestMap[T]['data']>> {
  try {
    const res: unknown = await chrome.tabs.sendMessage(tabId, makeRequest(type, payload), { frameId: 0 });
    return isResponse(res) ? (res as Response<RequestMap[T]['data']>) : fail('NOT_INJECTED', 'No ReadScore runtime answered.');
  } catch {
    return fail('NOT_INJECTED', 'No ReadScore runtime answered.');
  }
}

/** Base64 of a packaged file (the popup is an extension page: its own files need no web accessible resources). */
async function base64Of(path: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL(path))).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function ensureRuntime(tabId: number): Promise<Response<{ injected: boolean }>> {
  const ping = await request(tabId, 'PING', null);
  if (ping.ok && ping.data.buildId === BUILD_ID) return ok({ injected: false });
  try {
    // A different build's runtime (if any) is disposed by the new runtime's injection guard.
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_RUNTIME_FILE] });
    return ok({ injected: true });
  } catch (e) {
    return fail('NOT_INJECTED', e instanceof Error ? e.message : String(e));
  }
}

export const chromeApi: PopupApi = {
  async activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  },
  ensureRuntime,
  request,
  loadSettings: () => loadSettings(chrome.storage.sync),
  saveSettings: (settings) => saveSettings(chrome.storage.sync, settings),
  fontData: () => Promise.all(ATKINSON_FILES.map((f) => base64Of(f.file))),
  async applySheet(tabId, key, css) {
    try {
      const res: unknown = await chrome.runtime.sendMessage(makeSheetApply(tabId, key, css));
      return isResponse(res) ? (res as Response<{ active: boolean }>) : fail('INTERNAL', 'No answer from the service worker.');
    } catch (e) {
      return fail('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  },
};
