/**
 * Comfort in the page runtime.
 *
 * The document sheet is USER origin CSS that only an extension context can insert
 * (chrome.scripting.insertCSS), so the service worker owns it (src/background/sheets.ts). USER CSS does
 * not reach into shadow trees, so this side carries the same rules into open shadow roots, the approach
 * Calm uses: ONE constructed stylesheet, adopted by every open shadow root (nested ones included).
 *
 * - Discovery: one walk on enable, then only the subtrees a MutationObserver reports as added, batched
 *   every SCAN_DEBOUNCE_MS. No rescans of the whole document.
 * - Updates swap in a new shared sheet in every root, and restyleShadow() re-adopts an equal one after the
 *   service worker changed the USER sheet (see RuntimeHandle.restyle in src/content/index.ts).
 * - disable() removes the sheet from every root and disconnects the observer.
 * - The bundled font (Atkinson Hyperlegible) is registered here with the FontFace API from bytes the popup
 *   sends once (COMFORT_FONT): no network load, so a page CSP font-src cannot block it, and no web
 *   accessible resources. The faces are in document.fonts only while Comfort uses that font; document
 *   fonts are also used inside shadow trees.
 * - Closed shadow roots and cross origin frames are out of reach by design.
 */
import { ATKINSON_FAMILY, ATKINSON_FILES, buildComfortCss } from '../../shared/comfort';
import type { ComfortSettings, ModeSettings } from '../../shared/settings';
import type { Mode } from '../mode';

export const SCAN_DEBOUNCE_MS = 200;

export interface ComfortMode extends Mode {
  /** Open shadow roots that currently carry the Comfort sheet (tests, diagnostics). */
  shadowRoots(): number;
  /** The bundled font's bytes (base64 per file, ATKINSON_FILES order). Kept for the document's life. */
  setFontData(data: string[]): void;
  /** Bundled font faces currently registered in document.fonts. */
  fontFaces(): number;
  /** Test hook: process pending added subtrees now. */
  flushNow(): void;
}

export function createComfortMode(doc: Document = document): ComfortMode {
  const win = doc.defaultView!;
  let sheet: CSSStyleSheet | null = null;
  const roots = new Set<ShadowRoot>();
  let mo: MutationObserver | null = null;
  const pending = new Set<Element>();
  let timer = 0;
  let settings: ComfortSettings | null = null;
  let fontData: string[] | null = null;
  let faces: FontFace[] = [];

  /** Registers the bundled faces while Comfort is on with that font; removes them otherwise. */
  function syncFont(): void {
    const want = !!settings && settings.font === 'atkinson' && !!fontData;
    if (want && !faces.length) {
      try {
        faces = ATKINSON_FILES.map((f, i) => {
          const bin = win.atob(fontData![i] ?? '');
          const bytes = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
          const face = new win.FontFace(ATKINSON_FAMILY, bytes.buffer, { weight: String(f.weight), style: f.style, display: 'swap' });
          doc.fonts.add(face);
          return face;
        });
      } catch {
        faces = []; // bad data: the font stack falls back to system fonts
      }
    } else if (!want && faces.length) {
      for (const f of faces) doc.fonts.delete(f);
      faces = [];
    }
  }

  function adopt(sr: ShadowRoot): void {
    if (!sheet || roots.has(sr)) return;
    sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
    roots.add(sr);
    mo?.observe(sr, { childList: true, subtree: true });
    scan(sr);
  }
  /** Adopts into every open shadow root in `root` (nested roots via adopt → scan). */
  function scan(root: ParentNode): void {
    if (root instanceof Element && root.shadowRoot) adopt(root.shadowRoot);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) adopt(el.shadowRoot);
  }
  function flush(): void {
    timer = 0;
    for (const el of pending) if (el.isConnected) scan(el);
    pending.clear();
  }

  function enable(s: ModeSettings): void {
    settings = s as ComfortSettings;
    syncFont();
    sheet = new win.CSSStyleSheet();
    sheet.replaceSync(buildComfortCss(s as ComfortSettings) ?? '');
    mo = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof win.Element) pending.add(n);
      if (pending.size && !timer) timer = win.setTimeout(flush, SCAN_DEBOUNCE_MS);
    });
    mo.observe(doc.documentElement, { childList: true, subtree: true });
    scan(doc);
  }

  function update(s: ModeSettings): void {
    settings = s as ComfortSettings;
    syncFont();
    if (!sheet) return;
    // Swap in a new sheet rather than replaceSync on the adopted one: Chrome does not always restyle
    // shadow trees after an adopted sheet's rules change in place (the old text size stayed applied).
    const next = new win.CSSStyleSheet();
    next.replaceSync(buildComfortCss(settings) ?? '');
    for (const sr of roots) sr.adoptedStyleSheets = sr.adoptedStyleSheets.map((x) => (x === sheet ? next : x));
    sheet = next;
  }

  function disable(): void {
    mo?.disconnect();
    mo = null;
    if (timer) win.clearTimeout(timer);
    timer = 0;
    pending.clear();
    for (const sr of roots) sr.adoptedStyleSheets = sr.adoptedStyleSheets.filter((x) => x !== sheet);
    roots.clear();
    sheet = null;
    settings = null;
    syncFont();
  }

  return { id: 'comfort', enable, update, disable, setFontData: (d) => ((fontData = d), syncFont()), restyleShadow: () => settings && update(settings), fontFaces: () => faces.length, shadowRoots: () => roots.size, flushNow: () => (timer && win.clearTimeout(timer), flush()) };
}
