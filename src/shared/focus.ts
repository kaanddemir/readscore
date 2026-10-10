/**
 * Focus CSS and constants (Phase 1 validated approach).
 *
 * The paragraph is painted with the CSS Custom Highlight API: the page text is never wrapped or
 * replaced. The `::highlight()` rules MUST be AUTHOR origin: Phase 1 showed that USER origin rules are
 * reported by getComputedStyle but never painted. Paint is verified with screenshot pixels.
 *
 * Each colour sets both the background and the text colour, so the highlighted paragraph keeps a WCAG
 * AA contrast (>= 4.5:1) on light and dark pages alike. All four rules are static: the runtime picks the
 * highlight name of the chosen colour, so a colour change repaints without touching any sheet.
 */
import { FOCUS_COLORS, type FocusColor, type FocusSettings } from './settings';

export const FOCUS_HL_PREFIX = 'rs-focus-';
export const focusHighlightName = (c: FocusColor) => `${FOCUS_HL_PREFIX}${c}`;
export const FOCUS_HL_NAMES = FOCUS_COLORS.map(focusHighlightName);
export const FOCUS_CSS_MARKER = '/* ReadScore Focus */';

/** Highlight colours (sRGB): background and text. Contrast is checked in tests/unit/focus.test.ts. */
export const FOCUS_PALETTE: Readonly<Record<FocusColor, { bg: readonly number[]; fg: readonly number[] }>> = Object.freeze({
  yellow: { bg: [255, 236, 163], fg: [26, 26, 26] },
  blue: { bg: [207, 226, 255], fg: [11, 31, 58] },
  green: { bg: [206, 240, 212], fg: [14, 42, 22] },
  dark: { bg: [32, 34, 38], fg: [244, 244, 245] },
});

const rgb = (c: readonly number[]) => `rgb(${c.join(', ')})`;

/** The highlight paint rules (document or shadow root scope). */
export const FOCUS_PAINT_CSS = FOCUS_COLORS.map((c) => `::highlight(${focusHighlightName(c)}) { background-color: ${rgb(FOCUS_PALETTE[c].bg)}; color: ${rgb(FOCUS_PALETTE[c].fg)}; }`).join(' ');

/** The document AUTHOR sheet for Focus, or null when Focus is off. Static: it does not depend on options. */
export function buildFocusCss(f: FocusSettings): string | null {
  return f.enabled ? `${FOCUS_CSS_MARKER} ${FOCUS_PAINT_CSS}` : null;
}

/** Follow scroll reading line, as a share of the viewport height ("the middle of the screen"). */
export const READING_LINE = 0.5;
