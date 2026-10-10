/**
 * Per-tab runtime: owns the modes, applies settings to them in the lifecycle order the Mode
 * contract promises, and answers requests. Chrome wiring (listeners, injection guard) is in index.ts,
 * so this module is testable without a browser.
 */
import { MODE_IDS, normalizeSettings, type ModeId } from '../shared/settings';
import { fail, ok, type Request, type Response, type RuntimeState } from '../shared/messages';
import type { Mode } from './mode';
import { createCalmMode, type CalmMode } from './calm';
import { createComfortMode, type ComfortMode } from './comfort';
import { createFocusMode, type FocusMode } from './focus';

export interface Runtime {
  handle(req: Request): Response<unknown>;
  state(): RuntimeState;
  /** Turns every active mode off. Idempotent. */
  dispose(): void;
  /** Re-applies the shadow root sheets of mode `id`, if it is on. */
  restyleShadow(id: string): void;
}

export function createDefaultModes(): Record<ModeId, Mode> {
  return { focus: createFocusMode(), comfort: createComfortMode(), calm: createCalmMode() };
}

export function createRuntime(buildId: string, modes: Record<ModeId, Mode> = createDefaultModes()): Runtime {
  const active = new Set<ModeId>();
  let disposed = false;

  const calmState = (): RuntimeState['calm'] => {
    const m = modes.calm as Partial<CalmMode>;
    if (!m.state) return undefined;
    const c = m.state();
    return { blurActive: c.blurActive, motionActive: c.motionActive, showAll: c.showAll, marked: c.images.marked };
  };
  const focusState = (): RuntimeState['focus'] => {
    const m = modes.focus as Partial<FocusMode>;
    if (!m.state || !active.has('focus')) return undefined;
    const f = m.state();
    return { status: f.status, blocks: f.stats.blocks, index: f.index, stats: { ...f.stats } };
  };
  const state = (): RuntimeState => ({ buildId, activeModes: MODE_IDS.filter((id) => active.has(id)), calm: calmState(), focus: focusState() });

  function apply(raw: unknown): RuntimeState {
    const settings = normalizeSettings(raw);
    for (const id of MODE_IDS) {
      const want = settings.modes[id];
      const on = active.has(id);
      // Modes are independent: one failing never blocks the others. A mode that fails to start is
      // cleaned up and reported off, so the popup never claims an effect that is not there.
      try {
        if (want.enabled && !on) {
          active.add(id);
          modes[id].enable(want);
        } else if (want.enabled && on) {
          modes[id].update(want);
        } else if (!want.enabled && on) {
          active.delete(id);
          modes[id].disable();
        }
      } catch {
        if (want.enabled && active.has(id)) {
          active.delete(id);
          try {
            modes[id].disable();
          } catch {
            // nothing more to undo
          }
        }
      }
    }
    return state();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const id of [...active].reverse()) {
      active.delete(id);
      try {
        modes[id].disable();
      } catch {
        // One failing mode must not keep the others on the page.
      }
    }
  }

  function handle(req: Request): Response<unknown> {
    if (disposed) return fail('NOT_INJECTED', 'This ReadScore runtime has been disposed.');
    switch (req.type) {
      case 'PING':
        return ok({ buildId });
      case 'GET_STATE':
        return ok(state());
      case 'APPLY_SETTINGS':
        return ok(apply(req.payload));
      case 'CALM_SHOW_ALL': {
        const m = modes.calm as Partial<CalmMode>;
        const on = !!(req.payload as { on?: unknown } | null)?.on;
        if (active.has('calm') && m.setShowAll) m.setShowAll(on);
        return ok(state());
      }
      case 'FOCUS_PAUSE': {
        const m = modes.focus as Partial<FocusMode>;
        const paused = !!(req.payload as { paused?: unknown } | null)?.paused;
        if (active.has('focus') && m.setPaused) m.setPaused(paused);
        return ok(state());
      }
      case 'COMFORT_FONT': {
        const m = modes.comfort as Partial<ComfortMode>;
        const data = (req.payload as { data?: unknown } | null)?.data;
        if (m.setFontData && Array.isArray(data) && data.every((d) => typeof d === 'string')) m.setFontData(data as string[]);
        return ok(state());
      }
    }
  }

  function restyleShadow(id: string): void {
    if (disposed || !active.has(id as ModeId)) return;
    try {
      modes[id as ModeId].restyleShadow?.();
    } catch {
      // the document sheets are already right; only shadow trees may keep the previous value
    }
  }

  return { handle, state, dispose, restyleShadow };
}
