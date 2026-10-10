/**
 * Content runtime entry. Bundled as an IIFE and injected on demand with chrome.scripting.
 *
 * Injection guard:
 *  - same build already running and its extension context is valid → no-op (no duplicate listeners)
 *  - anything else already running (older build, reloaded extension) → dispose it, then boot this one
 * The runtime disposes itself on pagehide (except bfcache, where the document may come back).
 */
import { BUILD_ID, RUNTIME_GLOBAL_KEY } from '../shared/constants';
import { fail, isOurs, isRequest, type Response } from '../shared/messages';
import { createRuntime } from './runtime';

export interface RuntimeHandle {
  buildId: string;
  isContextValid: () => boolean;
  dispose: () => void;
  /**
   * Stylesheets currently inserted into THIS document, by key (comfort, calm, focus).
   * Written only by the service worker (src/background/sheets.ts), in the same isolated world.
   * They live and die with the document, exactly like the inserted CSS, so the two cannot drift.
   */
  sheets: Partial<Record<string, string | null>>;
  /**
   * Called by the service worker after it changed sheet `key`. Chrome does not restyle open shadow trees
   * when an inserted USER sheet changes, and that sheet's !important rules outrank the mode's adopted
   * shadow sheet: re-adopting the mode's shadow sheets makes the shadow trees pick up the new values.
   */
  restyle?: (key: string) => void;
}

type GuardedGlobal = typeof globalThis & { [RUNTIME_GLOBAL_KEY]?: RuntimeHandle };

function contextValid(): boolean {
  try {
    return typeof chrome.runtime?.id === 'string';
  } catch {
    return false;
  }
}

function boot(carried: RuntimeHandle['sheets']): RuntimeHandle {
  const runtime = createRuntime(BUILD_ID);

  const onMessage = (msg: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (r: Response<unknown>) => void): void => {
    if (!isOurs(msg)) return; // not ours: leave it to other listeners
    if (!isRequest(msg)) {
      sendResponse(fail('INVALID_MESSAGE', 'Unknown ReadScore request.'));
      return;
    }
    try {
      sendResponse(runtime.handle(msg));
    } catch (e) {
      sendResponse(fail('INTERNAL', e instanceof Error ? e.message : String(e)));
    }
    // Handlers are synchronous: no `return true`.
  };

  const onPageHide = (e: PageTransitionEvent): void => {
    if (!e.persisted) dispose();
  };

  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener('pagehide', onPageHide);

  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    runtime.dispose();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // extension context invalidated
    }
    window.removeEventListener('pagehide', onPageHide);
    const g = globalThis as GuardedGlobal;
    if (g[RUNTIME_GLOBAL_KEY] === handle) delete g[RUNTIME_GLOBAL_KEY];
  }

  const handle: RuntimeHandle = { buildId: BUILD_ID, isContextValid: contextValid, dispose, sheets: carried, restyle: (key) => runtime.restyleShadow(key) };
  return handle;
}

function safeValid(handle: RuntimeHandle): boolean {
  try {
    return handle.isContextValid();
  } catch {
    return false;
  }
}

(() => {
  const g = globalThis as GuardedGlobal;
  const existing = g[RUNTIME_GLOBAL_KEY];
  if (existing && existing.buildId === BUILD_ID && safeValid(existing)) return;
  // Inserted CSS outlives an extension reload/update; carry the record over so it can still be removed.
  const old = existing?.sheets;
  const carried: RuntimeHandle['sheets'] = old && typeof old === 'object' ? Object.fromEntries(Object.entries(old).filter(([, v]) => typeof v === 'string')) : {};
  if (existing) {
    try {
      existing.dispose();
    } catch {
      // previous runtime belonged to an invalidated context
    }
  }
  g[RUNTIME_GLOBAL_KEY] = boot(carried);
})();
