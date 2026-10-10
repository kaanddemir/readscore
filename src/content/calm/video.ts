/**
 * Pause background videos (part of Reduce motion), Phase 1.5 "gesture window" guard.
 *
 * Scope is deliberately narrow so Calm never becomes a video blocker:
 * - Only MUTED media (muted or volume 0) is ever paused: muted autoplay is how sites run background
 *   and decorative video. Media with sound is never touched.
 * - A play counts as the user's when a trusted pointerdown or keydown happened in the last
 *   GESTURE_WINDOW_MS (navigator.userActivation stays "active" for seconds after any click and was
 *   measured as unreliable in Phase 1.5). Pointer and keyboard both count, so native and custom
 *   players driven by mouse, touch or keys work.
 * - A medium the user played once is remembered and never paused again (rebuffering, ads, loops).
 * - `play` does not bubble out of shadow roots, so the listener is also added to each open shadow root.
 * - Disabling stops guarding; it never resumes or alters media itself.
 */
export const GESTURE_WINDOW_MS = 1000;

export interface VideoStats {
  pausedOnEnable: number;
  pausedLater: number;
  allowed: number;
}

const isQuiet = (m: HTMLMediaElement) => m.muted || m.volume === 0;

export function createVideoGuard(doc: Document = document) {
  const win = doc.defaultView!;
  let lastGesture = -Infinity;
  let userPlayed = new WeakSet<HTMLMediaElement>();
  const targets = new Set<Document | ShadowRoot>();
  const stats: VideoStats = { pausedOnEnable: 0, pausedLater: 0, allowed: 0 };
  let on = false;

  const onGesture = (e: Event) => {
    if (e.isTrusted) lastGesture = win.performance.now();
  };
  const onPlay = (e: Event) => {
    const m = e.target;
    if (!(m instanceof win.HTMLMediaElement)) return;
    if (userPlayed.has(m)) return;
    if (win.performance.now() - lastGesture < GESTURE_WINDOW_MS) {
      userPlayed.add(m);
      stats.allowed++;
      return;
    }
    if (!isQuiet(m)) return;
    m.pause();
    stats.pausedLater++;
  };

  function listenOn(t: Document | ShadowRoot): void {
    if (targets.has(t)) return;
    targets.add(t);
    t.addEventListener('play', onPlay, true);
  }
  function media(root: Document | ShadowRoot): HTMLMediaElement[] {
    return [...root.querySelectorAll<HTMLMediaElement>('video, audio')];
  }
  function openShadowRoots(root: Document | ShadowRoot, out: ShadowRoot[] = []): ShadowRoot[] {
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) (out.push(el.shadowRoot), openShadowRoots(el.shadowRoot, out));
    return out;
  }

  function enable(): void {
    if (on) return;
    on = true;
    for (const type of ['pointerdown', 'keydown']) win.addEventListener(type, onGesture, true);
    listenOn(doc);
    const roots = openShadowRoots(doc);
    roots.forEach(listenOn);
    for (const m of [doc, ...roots].flatMap(media)) if (!m.paused && isQuiet(m)) (m.pause(), stats.pausedOnEnable++);
  }

  /** Called by the image module's observer pass for shadow roots attached later. */
  function addShadowRoot(sr: ShadowRoot): void {
    if (on) listenOn(sr);
  }

  function disable(): void {
    if (!on) return;
    on = false;
    for (const type of ['pointerdown', 'keydown']) win.removeEventListener(type, onGesture, true);
    for (const t of targets) t.removeEventListener('play', onPlay, true);
    targets.clear();
    userPlayed = new WeakSet();
  }

  return { enable, disable, addShadowRoot, stats: (): VideoStats => ({ ...stats }), get active() { return on; }, get listeners() { return targets.size; } };
}
