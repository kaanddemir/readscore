import { describe, expect, it } from 'vitest';
import { createSheetController, type ScriptingApi } from '../../src/background/sheets';

/** Fake chrome.scripting: one document per tab with a runtime handle; records CSS operations. */
function fakeScripting(opts: { runtime?: boolean } = {}) {
  const docs = new Map<number, { id: string; handle: { sheets: Record<string, string | null> } | undefined; sheets: string[] }>();
  const log: string[] = [];
  const origins: string[] = [];
  const doc = (tabId: number) => {
    if (!docs.has(tabId)) docs.set(tabId, { id: `doc-${tabId}-1`, handle: opts.runtime === false ? undefined : { sheets: {} }, sheets: [] });
    return docs.get(tabId)!;
  };
  const check = (t: chrome.scripting.InjectionTarget) => {
    const d = doc(t.tabId);
    if (t.documentIds && !t.documentIds.includes(d.id)) throw new Error('No document with id');
    return d;
  };
  const api: ScriptingApi = {
    executeScript: (async (inj: { target: chrome.scripting.InjectionTarget; func: (...a: unknown[]) => unknown; args?: unknown[] }) => {
      const d = check(inj.target);
      const result = inj.func(...(inj.args ?? []));
      return [{ documentId: d.id, frameId: 0, result }];
    }) as unknown as ScriptingApi['executeScript'],
    insertCSS: (async (i: chrome.scripting.CSSInjection) => (check(i.target).sheets.push(i.css!), log.push(`insert ${i.css}`), origins.push(`${i.css}:${i.origin}`))) as unknown as ScriptingApi['insertCSS'],
    removeCSS: (async (i: chrome.scripting.CSSInjection) => {
      const d = check(i.target);
      d.sheets = d.sheets.filter((s) => s !== i.css);
      log.push(`remove ${i.css}`);
      origins.push(`-${i.css}:${i.origin}`);
    }) as unknown as ScriptingApi['removeCSS'],
  };
  return { api, docs, doc, log, origins };
}

// The injected funcs read globalThis[key]; point the test global at the fake document's handle.
function withGlobal<T>(f: ReturnType<typeof fakeScripting>, tabId: number, run: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  Object.defineProperty(g, '__readScoreV2__', { configurable: true, get: () => f.doc(tabId).handle });
  return run().finally(() => delete g.__readScoreV2__);
}

describe('page stylesheet controller (service worker)', () => {
  it('Focus paints with AUTHOR origin (USER ::highlight rules are never painted); Comfort and Calm stay USER', async () => {
    const f = fakeScripting();
    const c = createSheetController(f.api);
    await withGlobal(f, 1, async () => {
      await c.apply(1, 'focus', 'F1');
      await c.apply(1, 'comfort', 'C1');
      await c.apply(1, 'calm', 'K1');
      await c.apply(1, 'focus', null);
    });
    expect(f.origins).toEqual(['F1:AUTHOR', 'C1:USER', 'K1:USER', '-F1:AUTHOR']);
    expect(f.doc(1).sheets).toEqual(['C1', 'K1']);
  });

  it('keys are independent: Calm and Comfort sheets never replace each other', async () => {
    const f = fakeScripting();
    const c = createSheetController(f.api);
    await withGlobal(f, 1, async () => {
      await c.apply(1, 'comfort', 'C1');
      await c.apply(1, 'calm', 'K1');
      await c.apply(1, 'calm', 'K2');
      await c.apply(1, 'comfort', null);
    });
    expect(f.doc(1).sheets).toEqual(['K2']);
    expect(f.doc(1).handle!.sheets).toEqual({ comfort: null, calm: 'K2' });
  });

  it('insert, then update (insert new before removing old), then remove: record follows the sheet', async () => {
    const f = fakeScripting();
    const c = createSheetController(f.api);
    await withGlobal(f, 1, async () => {
      expect(await c.apply(1, 'comfort', 'A')).toEqual({ ok: true, data: { active: true } });
      expect(await c.apply(1, 'comfort', 'B')).toEqual({ ok: true, data: { active: true } });
      expect(f.doc(1).sheets).toEqual(['B']);
      expect(f.doc(1).handle!.sheets.comfort).toBe('B');
      expect(await c.apply(1, 'comfort', null)).toEqual({ ok: true, data: { active: false } });
    });
    expect(f.doc(1).sheets).toEqual([]);
    expect(f.doc(1).handle!.sheets.comfort).toBeNull();
    expect(f.log).toEqual(['insert A', 'insert B', 'remove A', 'remove B']);
  });

  it('after each change the page runtime is asked to restyle that key in shadow trees (not on a no-op)', async () => {
    const f = fakeScripting();
    const c = createSheetController(f.api);
    const restyled: string[] = [];
    Object.assign(f.doc(1).handle!, { restyle: (k: string) => restyled.push(k) });
    await withGlobal(f, 1, async () => {
      await c.apply(1, 'comfort', 'C1');
      await c.apply(1, 'comfort', 'C1');
      await c.apply(1, 'calm', 'K1');
      await c.apply(1, 'comfort', null);
    });
    expect(restyled).toEqual(['comfort', 'calm', 'comfort']);
  });

  it('same sheet twice is a no-op', async () => {
    const f = fakeScripting();
    const c = createSheetController(f.api);
    await withGlobal(f, 1, async () => {
      await c.apply(1, 'comfort', 'A');
      await c.apply(1, 'comfort', 'A');
    });
    expect(f.log).toEqual(['insert A']);
  });

  it('rapid requests are serialized and coalesced: only the newest sheet ends up applied', async () => {
    const f = fakeScripting();
    const c = createSheetController(f.api);
    await withGlobal(f, 1, async () => {
      const all = await Promise.all(['A', 'B', 'C', 'D'].map((s) => c.apply(1, 'comfort', s)));
      expect(all.every((r) => r.ok)).toBe(true);
    });
    expect(f.doc(1).sheets).toEqual(['D']);
    expect(f.log.filter((l) => l.startsWith('insert'))).toEqual(['insert D']);
  });

  it('no runtime in the tab: fails and inserts nothing', async () => {
    const f = fakeScripting({ runtime: false });
    const c = createSheetController(f.api);
    const r = await withGlobal(f, 1, () => c.apply(1, 'comfort', 'A'));
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_INJECTED' } });
    expect(f.doc(1).sheets).toEqual([]);
  });

  it('navigation between read and insert: the new document receives nothing', async () => {
    const f = fakeScripting();
    const c = createSheetController(f.api);
    const orig = f.api.insertCSS;
    f.api.insertCSS = (async (i: chrome.scripting.CSSInjection) => {
      f.doc(1).id = 'doc-1-2'; // the tab navigated after the state was read
      return (orig as unknown as (x: chrome.scripting.CSSInjection) => Promise<void>)(i);
    }) as unknown as ScriptingApi['insertCSS'];
    const r = await withGlobal(f, 1, () => c.apply(1, 'comfort', 'A'));
    expect(r.ok).toBe(false);
    expect(f.doc(1).sheets).toEqual([]);
  });
});
