/**
 * Calm CSS: pure, deterministic functions of the Calm settings (Phase 1.5 validated approaches).
 *
 * Reduce motion: the "finish" variant. Animations and transitions still run and still fire their end
 * events (menus and dialogs that wait for transitionend/animationend keep working), but take 0.01 ms.
 * Never animation-play-state: paused or transition: none: Phase 1.5 showed both leave content invisible
 * and break menus and dialogs.
 *
 * Blur: applies to elements the page runtime marked with CALM_MARK (large visuals only). A visual is
 * clear while it is hovered (CALM_REVEAL, set by the runtime's point in rectangle test), while it or a
 * link or button tile around it has keyboard focus, or while Show all images is on (CALM_SHOW_ALL on the root).
 * clip-path keeps the blur inside the visual's box; filters never change layout.
 */
import type { CalmSettings } from './settings';

export const CALM_MARK = 'data-rs-calm';
export const CALM_REVEAL = 'data-rs-calm-reveal';
export const CALM_SHOW_ALL = 'data-rs-calm-show-all';
export const CALM_CSS_MARKER = '/* ReadScore Calm */';

export const BLUR_PX = { light: 6, strong: 16 } as const;

export const MOTION_CSS =
  '*, *::before, *::after { animation-duration: 0.01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; transition-delay: 0s !important; scroll-behavior: auto !important; }';

const REVEAL = `:not([${CALM_REVEAL}], :focus-visible, :is(a, button, [role="button"]):focus-visible *)`;

function blurRule(px: number, root: string): string {
  return `${root}[${CALM_MARK}]${REVEAL} { filter: blur(${px}px) !important; clip-path: inset(0) !important; }`;
}

/** Document level USER stylesheet, or null when Calm has nothing to apply. */
export function buildCalmCss(c: CalmSettings): string | null {
  if (!c.enabled || (!c.reduceMotion && !c.blurImages)) return null;
  const rules = [CALM_CSS_MARKER];
  if (c.reduceMotion) rules.push(MOTION_CSS);
  if (c.blurImages) rules.push(blurRule(BLUR_PX[c.blurStrength], `:root:not([${CALM_SHOW_ALL}]) `));
  return rules.join('\n');
}

/**
 * Stylesheet adopted into each open shadow root (document USER CSS does not reach shadow trees).
 * Show all images is a page state the runtime knows, so it is written into the text directly.
 */
export function buildCalmShadowCss(c: CalmSettings, showAll: boolean): string {
  if (!c.enabled) return '';
  const rules: string[] = [];
  if (c.reduceMotion) rules.push(MOTION_CSS);
  if (c.blurImages && !showAll) rules.push(blurRule(BLUR_PX[c.blurStrength], ''));
  return rules.join('\n');
}
