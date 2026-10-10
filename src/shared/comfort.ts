/**
 * Comfort CSS: a pure, deterministic function of the Comfort settings.
 * Applied by the service worker with chrome.scripting.insertCSS({ origin: 'USER' }), the approach
 * validated in Phase 1: USER origin !important wins over page styles, including inline !important,
 * and removeCSS with the identical string restores the page exactly.
 *
 * Scope (Phase 1): reading text elements only. Code, form controls, editable regions, SVG,
 * navigation, menus and toolbars are excluded so interface text is not resized or spaced.
 */
import type { ComfortSettings } from './settings';

/** Reading text that receives spacing and the minimum size. */
export const COMFORT_TEXT = 'p, li, dd, dt, blockquote, figcaption, td, th';
/** Headings additionally receive the font family (never spacing or size changes). */
export const COMFORT_HEADINGS = 'h1, h2, h3, h4, h5, h6';
/** Never changed: code, forms, editable content, graphics and interface regions. */
export const COMFORT_EXCLUDE =
  'pre, pre *, code, kbd, samp, textarea, input, select, button, [contenteditable], [contenteditable] *, svg, svg *, nav *, [role="navigation"] *, [role="menu"] *, [role="menubar"] *, [role="toolbar"] *, [role="tablist"] *';

/** Inline text inside reading blocks that may carry its own (smaller) size: it gets the minimum too.
 *  small, sub, sup and code keep their sizes (they are meant to be smaller or are not prose). */
export const COMFORT_INLINE = 'a, span, em, strong, b, i, u, s, mark, cite, q, abbr, time, var, dfn';
/** Interface pieces inside text that keep their size: badges, chips, pills, labels and icons. */
export const COMFORT_BADGES = '[class*="badge" i], [class*="chip" i], [class*="pill" i], [class*="label" i], [class*="icon" i], [aria-hidden="true"]';

/** The bundled Atkinson Hyperlegible family name (unique, so it never collides with a page font). */
export const ATKINSON_FAMILY = 'ReadScore Atkinson Hyperlegible';

/** Font stacks. Sans and serif are system fonts; Atkinson Hyperlegible is bundled and registered by the
 *  page runtime with the FontFace API (src/content/comfort). Site default writes no font rule. */
export const COMFORT_FONT_STACKS = {
  sans: "Verdana, 'DejaVu Sans', 'Segoe UI', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  atkinson: `'${ATKINSON_FAMILY}', 'Atkinson Hyperlegible', Verdana, Arial, sans-serif`,
} as const;

/** Bundled font files (dist/fonts), with their style. SIL Open Font License 1.1 (fonts/OFL.txt).
 *  Registered from their bytes (FontFace API), not loaded by URL: no network request, no web accessible
 *  resources, and a page Content Security Policy (font-src) cannot block them. */
export const ATKINSON_FILES = [
  { file: 'fonts/AtkinsonHyperlegible-Regular.ttf', weight: 400, style: 'normal' },
  { file: 'fonts/AtkinsonHyperlegible-Bold.ttf', weight: 700, style: 'normal' },
  { file: 'fonts/AtkinsonHyperlegible-Italic.ttf', weight: 400, style: 'italic' },
  { file: 'fonts/AtkinsonHyperlegible-BoldItalic.ttf', weight: 700, style: 'italic' },
] as const;

/**
 * Controls that sit inside reading elements (e.g. GitHub's `li > a.btn` Fork/Star buttons) inherit the
 * spacing; these get it back to normal. Heuristic by role/class: CSS cannot see "looks like a button".
 */
export const COMFORT_CONTROLS = '[role="button"], [role="tab"], [role="menuitem"], [aria-haspopup], [class*="btn" i], [class*="button" i]';

export const COMFORT_CSS_MARKER = '/* ReadScore Comfort */';

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** Returns the stylesheet for these settings, or null when Comfort is off. */
export function buildComfortCss(c: ComfortSettings): string | null {
  if (!c.enabled) return null;
  const not = `:not(${COMFORT_EXCLUDE})`;
  const text = `:is(${COMFORT_TEXT})${not}`;
  const rules = [COMFORT_CSS_MARKER];
  // Spacing, font and size are independent: Site spacing writes no spacing rule at all.
  if (c.preset !== 'site') {
    rules.push(
      `${text} { line-height: ${num(c.lineHeight)} !important; letter-spacing: ${num(c.letterSpacing)}em !important; word-spacing: ${num(c.wordSpacing)}em !important; }`,
      `p${not} { margin-block-end: ${num(c.paragraphSpacing)}em !important; }`,
      `:is(${COMFORT_TEXT}) :is(${COMFORT_CONTROLS}) { letter-spacing: normal !important; word-spacing: normal !important; }`,
    );
  }
  if (c.font !== 'site') rules.push(`:is(${COMFORT_TEXT}, ${COMFORT_HEADINGS})${not} { font-family: ${COMFORT_FONT_STACKS[c.font]} !important; }`);
  if (c.minSize !== 'off') {
    // A minimum, never a fixed size: max(1em, N) keeps text that is already larger than N (relative to
    // its parent). Inline text with its own smaller size inside reading blocks is lifted as well.
    const min = `font-size: max(1em, ${c.minSize}px) !important;`;
    rules.push(`${text} { ${min} }`, `:is(${COMFORT_TEXT})${not} :is(${COMFORT_INLINE})${not}:not(${COMFORT_CONTROLS}, ${COMFORT_BADGES}) { ${min} }`);
  }
  return rules.join('\n');
}
