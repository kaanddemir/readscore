// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { makeRequest, type Request } from '../../src/shared/messages';
import { DEFAULT_SETTINGS, MODE_IDS, normalizeSettings, type ModeId } from '../../src/shared/settings';
import type { Mode } from '../../src/content/mode';
import { createDefaultModes, createRuntime } from '../../src/content/runtime';

/** A mode that records its calls and fails if the runtime breaks the lifecycle contract. */
function recordingMode(id: ModeId, log: string[]): Mode {
  let on = false;
  return {
    id,
    enable() {
      if (on) throw new Error(`${id}: enable while on`);
      on = true;
      log.push(`${id}:enable`);
    },
    update() {
      if (!on) throw new Error(`${id}: update while off`);
      log.push(`${id}:update`);
    },
    disable() {
      if (!on) throw new Error(`${id}: disable while off`);
      on = false;
      log.push(`${id}:disable`);
    },
  };
}

function setup() {
  const log: string[] = [];
  const modes = Object.fromEntries(MODE_IDS.map((id) => [id, recordingMode(id, log)])) as Record<ModeId, Mode>;
  return { log, rt: createRuntime('test-build', modes) };
}

const apply = (on: Partial<Record<ModeId, boolean>>): Request =>
  makeRequest('APPLY_SETTINGS', normalizeSettings({ modes: Object.fromEntries(Object.entries(on).map(([k, v]) => [k, { enabled: v }])) }));

describe('runtime', () => {
  it('answers PING and GET_STATE', () => {
    const { rt } = setup();
    expect(rt.handle(makeRequest('PING', null))).toEqual({ ok: true, data: { buildId: 'test-build' } });
    expect(rt.handle(makeRequest('GET_STATE', null))).toEqual({ ok: true, data: { buildId: 'test-build', activeModes: [] } });
  });

  it('follows enable → update → disable and never calls out of order', () => {
    const { rt, log } = setup();
    rt.handle(apply({ focus: true }));
    rt.handle(apply({ focus: true }));
    rt.handle(apply({ focus: false }));
    rt.handle(apply({ focus: false }));
    expect(log).toEqual(['focus:enable', 'focus:update', 'focus:disable']);
  });

  it('modes are independent and reported in a stable order', () => {
    const { rt } = setup();
    const res = rt.handle(apply({ calm: true, focus: true }));
    expect(res).toEqual({ ok: true, data: { buildId: 'test-build', activeModes: ['focus', 'calm'] } });
  });

  it('applying defaults changes nothing', () => {
    const { rt, log } = setup();
    rt.handle(makeRequest('APPLY_SETTINGS', DEFAULT_SETTINGS));
    expect(log).toEqual([]);
  });

  it('malformed settings payloads are normalized (nothing turns on)', () => {
    const { rt, log } = setup();
    rt.handle({ rs: 'rs2', type: 'APPLY_SETTINGS', payload: { modes: 'garbage' } } as unknown as Request);
    expect(log).toEqual([]);
  });

  it('dispose disables every active mode once, and later requests fail', () => {
    const { rt, log } = setup();
    rt.handle(apply({ focus: true, comfort: true }));
    rt.dispose();
    rt.dispose();
    expect(log).toEqual(['focus:enable', 'comfort:enable', 'comfort:disable', 'focus:disable']);
    expect(rt.handle(makeRequest('PING', null))).toMatchObject({ ok: false, error: { code: 'NOT_INJECTED' } });
  });

  it('a mode that throws on disable does not keep the others on', () => {
    const log: string[] = [];
    const modes = Object.fromEntries(MODE_IDS.map((id) => [id, recordingMode(id, log)])) as Record<ModeId, Mode>;
    modes.comfort = { ...modes.comfort, disable: () => { throw new Error('boom'); } };
    const rt = createRuntime('b', modes);
    rt.handle(apply({ focus: true, comfort: true }));
    rt.dispose();
    expect(log).toContain('focus:disable');
  });

  it('default modes run their full lifecycle and leave the DOM untouched', () => {
    document.body.innerHTML = '<main><p>Hello</p><img width="300" height="200"></main>';
    const before = document.documentElement.outerHTML;
    const rt = createRuntime('b', createDefaultModes());
    expect(rt.handle(apply({ focus: true, comfort: true, calm: true }))).toMatchObject({ ok: true, data: { activeModes: ['focus', 'comfort', 'calm'] } });
    rt.dispose();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it('a mode that throws on enable is reported off and cleaned up; the others still start', () => {
    const log: string[] = [];
    const modes = Object.fromEntries(MODE_IDS.map((id) => [id, recordingMode(id, log)])) as Record<ModeId, Mode>;
    let undone = false;
    modes.focus = { id: 'focus', enable: () => { throw new Error('boom'); }, update() {}, disable: () => void (undone = true) };
    const rt = createRuntime('b', modes);
    expect(rt.handle(apply({ focus: true, comfort: true, calm: true }))).toMatchObject({ ok: true, data: { activeModes: ['comfort', 'calm'] } });
    expect(undone).toBe(true);
    expect(log).toEqual(['comfort:enable', 'calm:enable']);
  });

  it('FOCUS_PAUSE is a page state: only while Focus is on, reported in GET_STATE, gone when Focus is off', () => {
    document.body.innerHTML = '<main>' + '<p>Paragraph text that is long enough to be read as a block.</p>'.repeat(4) + '</main>';
    Object.defineProperty(window, 'CSS', { value: { highlights: new Map() }, configurable: true });
    (window as unknown as { Highlight: unknown }).Highlight = class {};
    const rt = createRuntime('b', createDefaultModes());
    const pause = (paused: boolean) => rt.handle(makeRequest('FOCUS_PAUSE', { paused }));
    expect(pause(true)).toMatchObject({ ok: true, data: {} });
    expect((pause(true) as { data: { focus?: unknown } }).data.focus).toBeUndefined(); // Focus off: ignored
    rt.handle(apply({ focus: true }));
    const st = rt.handle(makeRequest('GET_STATE', null)) as { data: { focus: { status: string } } };
    expect(['active', 'empty']).toContain(st.data.focus.status); // happy-dom has no layout
    expect(pause(true)).toMatchObject({ data: { focus: { status: 'paused' } } });
    expect(rt.handle(apply({ focus: true }))).toMatchObject({ data: { focus: { status: 'paused' } } }); // reapplying keeps the pause
    rt.handle(apply({ focus: false }));
    expect((rt.handle(makeRequest('GET_STATE', null)) as { data: { focus?: unknown } }).data.focus).toBeUndefined();
    rt.dispose();
  });

  it('CALM_SHOW_ALL is a page state: works only while Calm blurs, reported in GET_STATE, reset by disable', () => {
    document.body.innerHTML = '<img width="300" height="200">';
    const rt = createRuntime('b', createDefaultModes());
    const showAll = (on: boolean) => rt.handle(makeRequest('CALM_SHOW_ALL', { on }));
    expect(showAll(true)).toMatchObject({ ok: true, data: { calm: { showAll: false } } }); // Calm off: ignored
    rt.handle(makeRequest('APPLY_SETTINGS', normalizeSettings({ modes: { calm: { enabled: true, blurImages: true } } })));
    expect(showAll(true)).toMatchObject({ ok: true, data: { calm: { showAll: true, blurActive: true } } });
    expect(rt.handle(makeRequest('GET_STATE', null))).toMatchObject({ data: { calm: { showAll: true } } });
    rt.handle(makeRequest('APPLY_SETTINGS', normalizeSettings({ modes: { calm: { enabled: false } } })));
    expect(rt.handle(makeRequest('GET_STATE', null))).toMatchObject({ data: { calm: { showAll: false, blurActive: false } } });
    rt.dispose();
  });
});
