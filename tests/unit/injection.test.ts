// @vitest-environment happy-dom
import { normalizeSettings } from '../../src/shared/settings';
/**
 * Content entry (src/content/index.ts): injection guard, message wiring and disposal, against a
 * fake chrome.runtime. Each import of the module is one "injection".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_GLOBAL_KEY } from '../../src/shared/constants';
import { makeRequest } from '../../src/shared/messages';
import type { RuntimeHandle } from '../../src/content/index';

type Listener = (msg: unknown, sender: unknown, send: (r: unknown) => void) => void;
const g = globalThis as typeof globalThis & { [RUNTIME_GLOBAL_KEY]?: RuntimeHandle };
let listeners: Set<Listener>;

beforeEach(() => {
  listeners = new Set();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'ext-id',
      onMessage: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
  });
});

afterEach(() => {
  g[RUNTIME_GLOBAL_KEY]?.dispose();
  delete g[RUNTIME_GLOBAL_KEY];
  vi.unstubAllGlobals();
});

async function inject(): Promise<void> {
  vi.resetModules();
  await import('../../src/content/index');
}

function send(msg: unknown): unknown {
  let out: unknown;
  for (const l of listeners) l(msg, {}, (r) => (out = r));
  return out;
}

describe('content runtime injection', () => {
  it('boots once and answers PING', async () => {
    await inject();
    expect(listeners.size).toBe(1);
    expect(send(makeRequest('PING', null))).toEqual({ ok: true, data: { buildId: 'dev' } });
  });

  it('re-injecting the same build is a no-op (no duplicate listeners)', async () => {
    await inject();
    const first = g[RUNTIME_GLOBAL_KEY];
    await inject();
    expect(listeners.size).toBe(1);
    expect(g[RUNTIME_GLOBAL_KEY]).toBe(first);
  });

  it('replaces a runtime from a different build', async () => {
    const dispose = vi.fn();
    g[RUNTIME_GLOBAL_KEY] = { buildId: 'old-build', isContextValid: () => true, dispose, sheets: {} };
    await inject();
    expect(dispose).toHaveBeenCalledOnce();
    expect(g[RUNTIME_GLOBAL_KEY]?.buildId).toBe('dev');
  });

  it('carries the applied sheet records over to the new runtime (CSS outlives an extension reload)', async () => {
    g[RUNTIME_GLOBAL_KEY] = { buildId: 'old-build', isContextValid: () => { throw new Error('invalidated'); }, dispose: vi.fn(), sheets: { comfort: '/* sheet */', calm: '/* calm */' } };
    await inject();
    expect(g[RUNTIME_GLOBAL_KEY]?.sheets).toEqual({ comfort: '/* sheet */', calm: '/* calm */' });
  });

  it('a fresh runtime starts with no applied sheet', async () => {
    await inject();
    expect(g[RUNTIME_GLOBAL_KEY]?.sheets).toEqual({});
  });

  it('replaces a same-build runtime whose extension context is gone', async () => {
    const dispose = vi.fn();
    g[RUNTIME_GLOBAL_KEY] = { buildId: 'dev', isContextValid: () => { throw new Error('invalidated'); }, dispose, sheets: {} };
    await inject();
    expect(dispose).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(1);
  });

  it('ignores foreign messages and rejects unknown ReadScore requests', async () => {
    await inject();
    expect(send({ action: 'analyze' })).toBeUndefined();
    expect(send({ rs: 'rs2', type: 'NOPE' })).toMatchObject({ ok: false, error: { code: 'INVALID_MESSAGE' } });
  });

  it('dispose removes listeners and the global; it is idempotent', async () => {
    await inject();
    const handle = g[RUNTIME_GLOBAL_KEY]!;
    handle.dispose();
    handle.dispose();
    expect(listeners.size).toBe(0);
    expect(g[RUNTIME_GLOBAL_KEY]).toBeUndefined();
  });

  it('disposes on pagehide but not on a bfcache pagehide', async () => {
    await inject();
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    expect(listeners.size).toBe(1);
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
    expect(listeners.size).toBe(0);
    expect(g[RUNTIME_GLOBAL_KEY]).toBeUndefined();
  });

  it('touches nothing in the page DOM', async () => {
    document.body.innerHTML = '<main><p>Hello</p></main>';
    const before = document.documentElement.outerHTML;
    await inject();
    const all = normalizeSettings({ modes: { focus: { enabled: true }, comfort: { enabled: true }, calm: { enabled: true } } });
    send(makeRequest('APPLY_SETTINGS', all));
    g[RUNTIME_GLOBAL_KEY]!.dispose();
    expect(document.documentElement.outerHTML).toBe(before);
  });
});
