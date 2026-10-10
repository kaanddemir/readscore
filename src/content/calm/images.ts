/**
 * Calm page side visuals (Phase 1.5 validated approach): Blur images marking and reveal, plus the
 * stylesheet adopted into open shadow roots (motion and blur rules) while Calm is on.
 *
 * - Selection: large visuals only (≥ 48px short side and ≥ 96×96 area), never a background box that
 *   carries text. Inside labels, menus, tabs, switches and form fields nothing is selected. Inside a
 *   button (or role=button) only raster visuals are: sites wrap image and video thumbnails in clickable
 *   tiles (Google's image cards), while a large svg in a button is an icon or a control graphic.
 *   Only the visual is blurred, never the tile or its text. Size cannot tell
 *   decoration from meaning, so large logos, charts and diagrams can be selected: reveal paths exist
 *   for exactly that reason (hover, keyboard focus, Show all images).
 * - Marking: one data attribute per selected element; the USER stylesheet (service worker) does the
 *   blur. Removing the marks restores the page.
 * - Dynamic content: a MutationObserver collects ADDED subtrees and changed src/srcset/style targets and
 *   evaluates only those, batched every SCAN_DEBOUNCE_MS; image `load` events (lazy loading) are caught
 *   in the capture phase. No full document rescans after enable.
 * - Open shadow roots: document USER CSS does not reach them, so a constructed stylesheet is adopted into
 *   each one (removed on disable, see dispose order note below).
 * - Hover reveal: point in rectangle over the cached marked list on pointermove/pointerdown/scroll,
 *   throttled to one test per animation frame, so images under transparent covering links work too.
 */
import { CALM_MARK, CALM_REVEAL, CALM_SHOW_ALL, buildCalmShadowCss } from '../../shared/calm';
import type { CalmSettings } from '../../shared/settings';

export const MIN_SIDE = 48;
export const MIN_AREA = 96 * 96;
export const SCAN_DEBOUNCE_MS = 200;
/** Never blurred inside these: form controls and widgets whose content is the control itself. */
const CONTROL_SEL = '[role="menuitem"], [role="tab"], [role="switch"], label, summary, select, input, textarea';
/** Clickable tiles: a raster thumbnail inside is a picture, an svg inside is a control graphic. */
const BUTTON_SEL = 'button, [role="button"]';
const VISUAL_SEL = 'img, svg, video, canvas, picture, [style*="background"]';
export type Kind = 'img' | 'svg' | 'video' | 'canvas' | 'bg';

export interface ImageStats {
  marked: number;
  shadowRoots: number;
  scanMs: number;
  observerBatches: number;
  observerMs: number;
  revealTests: number;
  revealMs: number;
}

const roundMs = (n: number) => Math.round(n * 100) / 100;

function hasText(el: Element): boolean {
  return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().length > 0;
}
function bgImage(el: Element): boolean {
  const b = getComputedStyle(el).backgroundImage;
  return b !== 'none' && b.includes('url(');
}

/** The visual kind of `el` if it is a blur candidate kind (size and context checked separately). */
export function kindOf(el: Element): Kind | null {
  const tag = el.localName;
  if (tag === 'img') return 'img';
  if (tag === 'svg') return el.parentElement?.closest('svg') ? null : 'svg';
  if (tag === 'video') return 'video';
  if (tag === 'canvas') return 'canvas';
  if (tag === 'picture') return null; // its <img> is the visual
  return bgImage(el) ? 'bg' : null;
}

/** Selection rule. Returns the kind to mark, or null. Reads layout (one rect + computed style). */
export function select(el: Element): Kind | null {
  const kind = kindOf(el);
  if (!kind) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  if (Math.min(r.width, r.height) < MIN_SIDE || r.width * r.height < MIN_AREA) return null;
  if (el.closest(CONTROL_SEL)) return null;
  if (kind === 'svg' && el.closest(BUTTON_SEL)) return null;
  if (kind === 'bg' && hasText(el)) return null; // blurring the box would blur its text
  return kind;
}

export function createImageBlur(doc: Document = document, onShadowRoot?: (sr: ShadowRoot) => void) {
  const win = doc.defaultView!;
  let settings: CalmSettings | null = null;
  let showAll = false;
  let marked = new Set<Element>();
  const roots = new Map<ShadowRoot, CSSStyleSheet>();
  let mo: MutationObserver | null = null;
  const pending = new Set<Node>();
  let timer = 0;
  let revealed: Element | null = null;
  let last: { x: number; y: number } | null = null;
  let raf = 0;
  const stats: ImageStats = { marked: 0, shadowRoots: 0, scanMs: 0, observerBatches: 0, observerMs: 0, revealTests: 0, revealMs: 0 };

  // ── marking ──
  function consider(el: Element): void {
    if (!settings?.blurImages || marked.has(el)) return;
    const kind = select(el);
    if (!kind) return;
    el.setAttribute(CALM_MARK, kind);
    marked.add(el);
  }
  function scanTree(root: ParentNode & Node): void {
    if (root instanceof Element) consider(root);
    for (const el of root.querySelectorAll(VISUAL_SEL)) consider(el);
    // Backgrounds set by stylesheets are invisible to the attribute selector: check block containers
    // without text cheaply (only those with a computed background image are selected).
    for (const el of root.querySelectorAll('div, section, figure, a, span, header')) if (!marked.has(el) && !el.firstChild?.nodeValue?.trim()) consider(el);
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const sr = (el as Element).shadowRoot;
      if (sr && !roots.has(sr)) adoptInto(sr);
    }
  }

  // ── open shadow roots ──
  function adoptInto(sr: ShadowRoot): void {
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(settings ? buildCalmShadowCss(settings, showAll) : '');
    sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
    roots.set(sr, sheet);
    onShadowRoot?.(sr);
    observe(sr);
    scanTree(sr);
  }
  function refreshShadowSheets(): void {
    const css = settings ? buildCalmShadowCss(settings, showAll) : '';
    // New sheets, not replaceSync in place: Chrome does not always restyle a shadow tree after its adopted
    // sheet changes in place (see src/content/comfort/index.ts).
    for (const [sr, old] of roots) {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
      sr.adoptedStyleSheets = sr.adoptedStyleSheets.map((s) => (s === old ? sheet : s));
      roots.set(sr, sheet);
    }
  }

  // ── dynamic content: added subtrees only, batched ──
  function flush(): void {
    timer = 0;
    const t = performance.now();
    stats.observerBatches++;
    for (const n of pending) if (n.isConnected && (n instanceof Element || n instanceof ShadowRoot)) scanTree(n);
    pending.clear();
    for (const el of marked) if (!el.isConnected) (marked.delete(el), el === revealed && (revealed = null)); // removed nodes: forget
    stats.observerMs += performance.now() - t;
    stats.marked = marked.size;
  }
  function queue(n: Node): void {
    pending.add(n);
    if (!timer) timer = win.setTimeout(flush, SCAN_DEBOUNCE_MS);
  }
  function observe(target: Node): void {
    mo?.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'class'] });
  }
  const onLoad = (e: Event) => {
    if (e.target instanceof Element && e.target.localName === 'img') queue(e.target);
  };

  // ── hover / touch reveal: point in rectangle, one test per frame ──
  function revealAt(x: number, y: number): void {
    const t = performance.now();
    let hit: Element | null = null;
    if (x >= 0) {
      for (const el of marked) {
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          hit = el;
          break;
        }
      }
    }
    if (hit !== revealed) {
      revealed?.removeAttribute(CALM_REVEAL);
      hit?.setAttribute(CALM_REVEAL, '');
      revealed = hit;
    }
    stats.revealTests++;
    stats.revealMs += performance.now() - t;
  }
  const schedule = () => {
    if (!raf) raf = win.requestAnimationFrame(() => ((raf = 0), revealAt(last ? last.x : -1, last ? last.y : -1)));
  };
  const onPointer = (e: PointerEvent) => ((last = { x: e.clientX, y: e.clientY }), schedule());
  const onLeave = () => ((last = null), schedule());

  function enable(next: CalmSettings): void {
    settings = next;
    const t = performance.now();
    mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach((n) => n instanceof Element && queue(n));
        else queue(r.target);
      }
    });
    observe(doc.documentElement);
    scanTree(doc.documentElement);
    stats.scanMs = performance.now() - t;
    stats.marked = marked.size;
    doc.addEventListener('load', onLoad, true);
    win.addEventListener('pointermove', onPointer, { capture: true, passive: true });
    win.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
    doc.documentElement.addEventListener('pointerleave', onLeave);
    doc.addEventListener('scroll', schedule, { capture: true, passive: true });
  }

  function unmarkAll(): void {
    for (const el of marked) (el.removeAttribute(CALM_MARK), el.removeAttribute(CALM_REVEAL));
    marked = new Set();
    revealed = null;
  }

  /** Blur turned off: marks and Show all go, shadow sheets keep the motion rule. Turned on: one scan. */
  function update(next: CalmSettings): void {
    const wasBlur = !!settings?.blurImages;
    settings = next;
    if (wasBlur && !next.blurImages) (unmarkAll(), (showAll = false), doc.documentElement.removeAttribute(CALM_SHOW_ALL));
    if (!wasBlur && next.blurImages) {
      scanTree(doc.documentElement);
      for (const sr of roots.keys()) scanTree(sr); // roots adopted while Blur was off were never marked
    }
    refreshShadowSheets();
  }

  function setShowAll(on: boolean): void {
    showAll = on;
    doc.documentElement.toggleAttribute(CALM_SHOW_ALL, on);
    refreshShadowSheets();
  }

  /**
   * Removes everything this module added. Order matters (Phase 1.5): marks first, so no selector can
   * match anything while the shadow sheets are being removed; then the sheets; then listeners.
   */
  function disable(): void {
    mo?.disconnect();
    mo = null;
    if (timer) win.clearTimeout(timer);
    timer = 0;
    pending.clear();
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
    unmarkAll();
    for (const [sr, sheet] of roots) sr.adoptedStyleSheets = sr.adoptedStyleSheets.filter((s) => s !== sheet);
    roots.clear();
    doc.documentElement.removeAttribute(CALM_SHOW_ALL);
    showAll = false;
    doc.removeEventListener('load', onLoad, true);
    win.removeEventListener('pointermove', onPointer, true);
    win.removeEventListener('pointerdown', onPointer, true);
    doc.documentElement.removeEventListener('pointerleave', onLeave);
    doc.removeEventListener('scroll', schedule, true);
    settings = null;
  }

  return {
    enable,
    update,
    disable,
    setShowAll,
    refreshShadowSheets,
    get showAll() {
      return showAll;
    },
    stats: (): ImageStats => ({ ...stats, marked: marked.size, shadowRoots: roots.size, scanMs: roundMs(stats.scanMs), observerMs: roundMs(stats.observerMs), revealMs: roundMs(stats.revealMs) }),
    /** Test hook: flush the pending batch now. */
    flushNow: () => (timer && win.clearTimeout(timer), flush()),
  };
}
