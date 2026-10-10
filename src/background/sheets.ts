/**
 * Page stylesheet controller (service worker). Each mode that needs inserted CSS owns one sheet per
 * document, identified by a key: Comfort and Calm (USER origin), Focus (AUTHOR origin, see SHEET_ORIGIN).
 *
 * - The active sheets are recorded on the page runtime handle (`sheets[key]`), so they live and die with
 *   the document: after a reload or navigation the CSS and the record are gone together.
 * - Every insert/remove targets the exact documentId read in the same pass, so a navigation in the
 *   middle of an update can never leave CSS in the next page.
 * - Requests are serialized per tab and key and coalesced: each pass applies the newest requested sheet.
 * - Order is insert new, then remove old, so the page never flashes unstyled between values.
 * - Keys are independent: changing Calm never touches the Comfort sheet and vice versa.
 */
import { RUNTIME_GLOBAL_KEY } from '../shared/constants';
import { fail, ok, SHEET_ORIGIN, type Response, type SheetKey } from '../shared/messages';

export interface SheetResult {
  /** True when this key's sheet is active in the tab's document after the request. */
  active: boolean;
}

/** The subset of chrome.scripting used here (lets tests pass a fake). */
export interface ScriptingApi {
  executeScript: typeof chrome.scripting.executeScript;
  insertCSS: typeof chrome.scripting.insertCSS;
  removeCSS: typeof chrome.scripting.removeCSS;
}

interface Probe {
  has: boolean;
  css: string | null;
}
type Handle = { sheets?: Partial<Record<string, string | null>>; restyle?: (key: string) => void } | undefined;

export function createSheetController(scripting: ScriptingApi) {
  const latest = new Map<string, string | null>();
  const chains = new Map<string, Promise<unknown>>();

  async function readState(tabId: number, key: SheetKey): Promise<{ probe: Probe; documentId: string | undefined }> {
    const [r] = await scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (global: string, k: string) => {
        const h = (globalThis as unknown as Record<string, Handle>)[global];
        return { has: !!h, css: h?.sheets?.[k] ?? null };
      },
      args: [RUNTIME_GLOBAL_KEY, key],
    });
    return { probe: (r?.result as Probe | undefined) ?? { has: false, css: null }, documentId: r?.documentId };
  }

  async function pass(tabId: number, key: SheetKey): Promise<Response<SheetResult>> {
    const id = `${tabId}:${key}`;
    const css = latest.get(id) ?? null;
    let state;
    try {
      state = await readState(tabId, key);
    } catch (e) {
      return fail('NOT_INJECTED', e instanceof Error ? e.message : String(e));
    }
    if (!state.probe.has || !state.documentId) return fail('NOT_INJECTED', 'No ReadScore runtime in this tab.');
    const old = state.probe.css;
    if (old === css) return ok({ active: css !== null });
    const target = { tabId, documentIds: [state.documentId] };
    const origin = SHEET_ORIGIN[key];
    try {
      if (css) await scripting.insertCSS({ target, css, origin });
      if (old) await scripting.removeCSS({ target, css: old, origin });
      await scripting.executeScript({
        target,
        func: (global: string, k: string, value: string | null) => {
          const h = (globalThis as unknown as Record<string, Handle>)[global];
          if (!h) return;
          h.sheets = { ...h.sheets, [k]: value };
          h.restyle?.(k); // shadow trees: see RuntimeHandle.restyle
        },
        args: [RUNTIME_GLOBAL_KEY, key, css],
      });
      return ok({ active: css !== null });
    } catch (e) {
      // The document went away mid update (navigation/close): its CSS went with it. Nothing is left behind.
      return fail('NOT_INJECTED', e instanceof Error ? e.message : String(e));
    }
  }

  /** Requests `css` (null = remove) for the tab's `key` sheet. Resolves with the state after the request's pass. */
  function apply(tabId: number, key: SheetKey, css: string | null): Promise<Response<SheetResult>> {
    const id = `${tabId}:${key}`;
    latest.set(id, css);
    const run = (chains.get(id) ?? Promise.resolve()).then(() => pass(tabId, key));
    const tail = run.catch(() => undefined);
    chains.set(id, tail);
    void tail.then(() => {
      if (chains.get(id) === tail) (chains.delete(id), latest.delete(id));
    });
    return run;
  }

  return { apply };
}
