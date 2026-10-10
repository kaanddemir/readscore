/**
 * Focus, page side: one highlighted paragraph on the original page (Phase 1 validated approaches).
 *
 * - Detection: src/content/focus/detect.ts. Nothing in the page is wrapped, moved or rewritten.
 * - Paint: CSS Custom Highlight API ranges. The document `::highlight()` rules are an AUTHOR sheet the
 *   service worker inserts (key `focus`); open shadow roots get the same rules as an adopted sheet,
 *   because document rules do not reach into shadow trees.
 * - Keyboard: J next, K previous (capture phase, so the page does not also act on them), never while
 *   typing or with modifiers. Esc pauses (bubble phase, only when the page did not use the key).
 * - Follow scroll groups a heading with the description beside it (see groupOf); Keyboard is one block.
 * - Follow scroll: a position scan of the cached paragraphs against the reading line, once per animation
 *   frame, on scroll events caught in the capture phase (nested scroll containers included). No hit testing.
 * - Pause is temporary page state: the highlight and tracking stop, the paragraph is remembered.
 * - Dynamic content: one debounced, capped re-detection per burst of relevant mutations.
 * Listeners exist only while Focus is on; disable() removes everything it added.
 */
import { FOCUS_HL_NAMES, FOCUS_PAINT_CSS, focusHighlightName, READING_LINE } from '../../shared/focus';
import type { FocusSettings, ModeSettings } from '../../shared/settings';
import type { Mode } from '../mode';
import { blockRange, detectBlocks, isHeading, type Detection } from './detect';

export const RESCAN_DEBOUNCE_MS = 300;
export const RESCAN_MAX_WAIT_MS = 2000;
export const RESCAN_MIN_INTERVAL_MS = 1000;
const IGNORED_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'br', 'wbr']);

export type FocusStatus = 'active' | 'paused' | 'empty' | 'unsupported';

export interface FocusStats {
  blocks: number;
  scope: 'main' | 'article' | 'document' | 'none';
  detectMs: number;
  rescans: number;
  rescanMsMax: number;
  rescanMsTotal: number;
  mutationBatches: number;
  highlightMsMax: number;
  stepMsMax: number;
  followFrames: number;
  followMsMax: number;
  followMsTotal: number;
}

export interface FocusState {
  status: FocusStatus;
  interaction: FocusSettings['interaction'];
  /** Index of the highlighted (or remembered, when paused) paragraph, or -1. */
  index: number;
  stats: FocusStats;
}

export interface FocusMode extends Mode {
  setPaused(paused: boolean): void;
  state(): FocusState;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function highlightSupported(win: Window): boolean {
  const w = win as Window & { CSS?: { highlights?: unknown }; Highlight?: unknown };
  return !!w.CSS && !!w.CSS.highlights && typeof w.Highlight === 'function';
}

export function createFocusMode(doc: Document = document): FocusMode {
  const win = doc.defaultView!;
  let settings: FocusSettings | null = null;
  let det: Detection | null = null;
  let blocks: Element[] = [];
  let current: Element | null = null;
  let index = new Map<Element, number>();
  let paused = false;
  let supported = true;
  const sheets = new Map<ShadowRoot, CSSStyleSheet>();
  let mo: MutationObserver | null = null;
  const observed = new WeakSet<Node>();
  let rescanTimer = 0;
  let firstPending = 0;
  let lastScan = 0;
  let raf = 0;
  const stats: FocusStats = { blocks: 0, scope: 'none', detectMs: 0, rescans: 0, rescanMsMax: 0, rescanMsTotal: 0, mutationBatches: 0, highlightMsMax: 0, stepMsMax: 0, followFrames: 0, followMsMax: 0, followMsTotal: 0 };

  const registry = () => (win as Window & { CSS: { highlights: Map<string, unknown> } }).CSS.highlights;
  const HighlightCtor = () => (win as Window & { Highlight: new (...r: Range[]) => unknown }).Highlight;

  // ── paint ──
  function clearPaint(): void {
    try {
      for (const name of FOCUS_HL_NAMES) registry().delete(name);
    } catch {
      // registry unavailable
    }
  }
  function paint(el: Element | null): void {
    const t = performance.now();
    clearPaint();
    current = el;
    if (el && !paused) {
      registry().set(focusHighlightName(settings?.color ?? 'yellow'), new (HighlightCtor())(...groupOf(el).map(blockRange)));
    }
    stats.highlightMsMax = Math.max(stats.highlightMsMax, performance.now() - t);
  }
  function syncShadowSheets(roots: ShadowRoot[]): void {
    for (const sr of roots) {
      if (sheets.has(sr)) continue;
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(FOCUS_PAINT_CSS);
      sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
      sheets.set(sr, sheet);
    }
  }

  // ── Follow scroll grouping ──
  /** Text box of a block (its painted range, not the element box, which can span a whole grid row). */
  const textRect = (el: Element) => blockRange(el).getBoundingClientRect();
  /** `b` sits beside `a` in the same visual row: vertical ranges overlap by most of the smaller one, horizontal ranges do not. */
  function beside(a: DOMRect, b: DOMRect): boolean {
    const v = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const h = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    return v >= Math.min(a.height, b.height) * 0.5 && h <= 1;
  }
  /**
   * The blocks painted together with `el` in Follow scroll: a heading and the (up to 3) blocks right after
   * it in reading order that live in the heading's own container and sit beside it in the same row (a hero
   * title with its caption in a grid or flex row). Both a DOM relationship and the layout must agree;
   * otherwise the block is painted alone. Stacked heading + paragraph, sibling cards and Keyboard mode are
   * always single blocks. Reads only a few rects of neighbouring blocks.
   */
  function groupOf(el: Element): Element[] {
    if (!follows()) return [el];
    const i = index.get(el);
    if (i === undefined) return [el];
    let h = i;
    if (!isHeading(el)) {
      while (h > 0 && h > i - 3 && !isHeading(blocks[h]!)) h--;
      if (!isHeading(blocks[h]!)) return [el];
    }
    const head = blocks[h]!;
    const box = head.parentElement;
    if (!box) return [el];
    const hr = textRect(head);
    const group = [head];
    for (let k = h + 1; k < blocks.length && k <= h + 3; k++) {
      const b = blocks[k]!;
      if (isHeading(b) || !box.contains(b) || !beside(hr, textRect(b))) break;
      group.push(b);
    }
    return group.length > 1 && group.includes(el) ? group : [el];
  }

  // ── geometry ──
  const lineY = () => win.innerHeight * READING_LINE;
  /** The block's on screen box, clipped by its nested scroll container and the viewport, or null. */
  function visibleRect(el: Element): { top: number; bottom: number } | null {
    const r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) return null;
    let top = Math.max(r.top, 0);
    let bottom = Math.min(r.bottom, win.innerHeight);
    const sc = det?.scrollers.get(el);
    if (sc) {
      const c = sc.getBoundingClientRect();
      top = Math.max(top, c.top);
      bottom = Math.min(bottom, c.bottom);
    }
    return bottom > top ? { top, bottom } : null;
  }
  /** The paragraph at the reading line: the current one while it still crosses it (stable), else the
   *  first crossing it, else the nearest visible one. */
  function atLine(): Element | null {
    const y = lineY();
    let crossing: Element | null = null;
    let nearest: Element | null = null;
    let best = Infinity;
    let mates: Element[] | null = null; // the current group, read once per frame when needed
    for (const b of blocks) {
      const r = visibleRect(b);
      if (!r) continue;
      if (r.top <= y && r.bottom >= y) {
        if (b === current) return b;
        if (current && follows() && (mates ??= groupOf(current)).includes(b)) return current; // its group still crosses the line
        crossing ??= b;
        continue;
      }
      const d = Math.min(Math.abs(r.top - y), Math.abs(r.bottom - y));
      if (d < best) (best = d), (nearest = b);
    }
    return crossing ?? nearest;
  }
  /** Where to start: the paragraph at the reading line, else the first one below the viewport, else the last. */
  function startBlock(): Element | null {
    return atLine() ?? blocks.find((b) => b.isConnected && b.getBoundingClientRect().top >= 0) ?? [...blocks].reverse().find((b) => b.isConnected) ?? null;
  }
  /** Before acting on a key or a resume: a pending re-detection (content changed) runs now. */
  function fresh(): void {
    if (rescanTimer) {
      win.clearTimeout(rescanTimer);
      rescan();
    }
  }

  // ── keyboard ──
  function editable(e: Event): boolean {
    for (const n of e.composedPath()) {
      if ((n as Node).nodeType !== 1) continue;
      const el = n as HTMLElement;
      if (el.isContentEditable || /^(input|textarea|select)$/.test(el.localName)) return true;
      const ce = el.getAttribute('contenteditable');
      if (ce !== null && ce !== 'false') return true;
      const role = el.getAttribute('role');
      if (role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'spinbutton') return true;
    }
    return doc.designMode === 'on';
  }
  function ensureVisible(el: Element): void {
    const vh = win.innerHeight;
    const r = el.getBoundingClientRect();
    const sc = det?.scrollers.get(el)?.getBoundingClientRect();
    const top = Math.max(0, sc?.top ?? 0);
    const bottom = Math.min(vh, sc?.bottom ?? vh);
    const h = bottom - top;
    const margin = h * 0.1;
    const fits = r.height <= h - 2 * margin;
    const ok = fits ? r.top >= top + margin && r.bottom <= bottom - margin : r.top >= top + margin && r.top <= top + h * 0.5;
    if (ok) return;
    // No animation: jumps are short and never fight the user's own scrolling.
    el.scrollIntoView({ block: fits ? 'center' : 'start', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  }
  function step(delta: 1 | -1): void {
    const t = performance.now();
    fresh();
    if (paused) {
      resume();
    } else if (!current || !current.isConnected || !visibleRect(current)) {
      // The reader scrolled away (or the paragraph went): start again where they are.
      const at = startBlock();
      if (at) (paint(at), ensureVisible(at));
    } else {
      const i = blocks.indexOf(current);
      const next = blocks[Math.max(0, Math.min(blocks.length - 1, i + delta))];
      if (next) (paint(next), ensureVisible(next));
    }
    stats.stepMsMax = Math.max(stats.stepMsMax, performance.now() - t);
  }
  const onNavKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
    const k = e.key.toLowerCase();
    if (k !== 'j' && k !== 'k') return;
    if (editable(e) || !blocks.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    step(k === 'j' ? 1 : -1);
  };
  /** A visible open dialog (pages often keep hidden aria-modal panels around). */
  const openDialog = () =>
    [...doc.querySelectorAll('dialog[open], [aria-modal="true"]')].some((d) => {
      const v = d as HTMLElement & { checkVisibility?: () => boolean };
      return typeof v.checkVisibility === 'function' ? v.checkVisibility() : d.getClientRects().length > 0;
    });
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || paused || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (editable(e)) return;
    // An open dialog owns Esc. So does a focused widget that used the key; a page wide handler that
    // marks every Esc as used (some docs sites do) does not stop the pause while nothing is focused.
    if (openDialog()) return;
    const focused = doc.activeElement && doc.activeElement !== doc.body && doc.activeElement !== doc.documentElement;
    if (e.defaultPrevented && focused) return;
    setPaused(true);
  };

  // ── follow scroll ──
  function followFrame(): void {
    raf = 0;
    if (paused || !blocks.length) return;
    const t = performance.now();
    const at = atLine();
    if (at && at !== current) paint(at);
    const ms = performance.now() - t;
    stats.followFrames++;
    stats.followMsTotal += ms;
    stats.followMsMax = Math.max(stats.followMsMax, ms);
  }
  const onScroll = () => {
    if (!raf) raf = win.requestAnimationFrame(followFrame);
  };
  function setFollow(on: boolean): void {
    if (on) {
      doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
      win.addEventListener('resize', onScroll, { passive: true });
    } else {
      doc.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('resize', onScroll);
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  function setKeys(on: boolean): void {
    if (on) win.addEventListener('keydown', onNavKey, true);
    else win.removeEventListener('keydown', onNavKey, true);
  }
  const follows = () => settings?.interaction === 'scroll';

  // ── detection and dynamic content ──
  function detect(): void {
    det = detectBlocks(doc);
    blocks = det.blocks;
    index = new Map(blocks.map((b, i) => [b, i]));
    stats.blocks = blocks.length;
    stats.scope = det.scope;
    syncShadowSheets(det.shadowRoots.filter((sr) => blocks.some((b) => b.getRootNode() === sr)));
    for (const sr of det.shadowRoots) observe(sr);
  }
  function observe(target: Node): void {
    if (!mo || observed.has(target)) return;
    observed.add(target);
    mo.observe(target, { childList: true, subtree: true });
  }
  function relevant(records: MutationRecord[]): boolean {
    for (const r of records) {
      for (const list of [r.addedNodes, r.removedNodes]) {
        for (const n of list) {
          if (n.nodeType === 1 && !IGNORED_TAGS.has((n as Element).localName)) return true;
          if (n.nodeType === 3 && (n.nodeValue ?? '').trim()) return true;
        }
      }
    }
    return false;
  }
  function rescan(): void {
    rescanTimer = 0;
    firstPending = 0;
    lastScan = performance.now();
    const t = performance.now();
    const keep = current;
    detect();
    const ms = performance.now() - t;
    stats.rescans++;
    stats.rescanMsTotal += ms;
    stats.rescanMsMax = Math.max(stats.rescanMsMax, ms);
    if (keep && keep.isConnected && blocks.includes(keep)) {
      if (!paused) paint(keep); // refresh the range (text inside may have changed)
    } else if (paused) {
      current = null; // resume picks a paragraph at the reading line
    } else {
      paint(startBlock()); // removed (or first content on an empty page): recover at the reading line
    }
  }
  /** Debounced (300 ms), but never more than 2 s after the first change, and at most once a second,
   *  except when the highlighted paragraph itself was removed (then only the debounce applies). */
  function scheduleRescan(): void {
    const now = performance.now();
    if (!firstPending) firstPending = now;
    if (rescanTimer) win.clearTimeout(rescanTimer);
    const lost = !!current && !current.isConnected && !paused;
    const due = lost ? now + RESCAN_DEBOUNCE_MS : Math.max(now + RESCAN_DEBOUNCE_MS, lastScan + RESCAN_MIN_INTERVAL_MS);
    const at = lost ? due : Math.min(due, Math.max(firstPending + RESCAN_MAX_WAIT_MS, lastScan + RESCAN_MIN_INTERVAL_MS));
    rescanTimer = win.setTimeout(rescan, Math.max(0, at - now));
  }

  // ── pause ──
  function resume(): void {
    fresh();
    paused = false;
    // Follow scroll resumes at the reading line; Keyboard resumes on the remembered paragraph when it is
    // still on screen.
    const keep = !follows() && current && current.isConnected && blocks.includes(current) && visibleRect(current) ? current : startBlock();
    paint(keep);
    if (follows()) setFollow(true);
  }
  function setPaused(on: boolean): void {
    if (!settings || !supported || on === paused) return;
    if (on) {
      paused = true;
      setFollow(false);
      clearPaint(); // `current` is kept for resume
    } else resume();
  }

  function enable(s: ModeSettings): void {
    settings = s as FocusSettings;
    supported = highlightSupported(win);
    if (!supported) return;
    paused = false;
    const t = performance.now();
    mo = new MutationObserver((records) => {
      stats.mutationBatches++;
      if (relevant(records)) scheduleRescan();
    });
    observe(doc.documentElement);
    detect();
    stats.detectMs = performance.now() - t;
    paint(startBlock()); // start where the reader is, not at the top of the page
    setKeys(settings.interaction === 'keyboard');
    win.addEventListener('keydown', onEscape);
    if (follows()) setFollow(true);
  }

  function update(s: ModeSettings): void {
    const next = s as FocusSettings;
    const changed = next.interaction !== settings?.interaction;
    const recolor = next.color !== settings?.color;
    settings = next;
    if (!supported) return;
    if (recolor && current && !paused) paint(current); // a colour change applies at once
    if (!changed) return;
    // Switching is immediate: the other input's listeners go, this one's come.
    setKeys(next.interaction === 'keyboard');
    setFollow(next.interaction === 'scroll' && !paused);
    if (current && !paused) paint(current); // regroup (Follow scroll) or back to one block (Keyboard)
    if (next.interaction === 'scroll' && !paused) followFrame();
  }

  function disable(): void {
    setFollow(false);
    setKeys(false);
    win.removeEventListener('keydown', onEscape);
    mo?.disconnect();
    mo = null;
    if (rescanTimer) win.clearTimeout(rescanTimer);
    rescanTimer = firstPending = 0;
    if (supported) clearPaint();
    for (const [sr, sheet] of sheets) sr.adoptedStyleSheets = sr.adoptedStyleSheets.filter((x) => x !== sheet);
    sheets.clear();
    det = null;
    blocks = [];
    index = new Map();
    current = null;
    paused = false;
    settings = null;
  }

  function state(): FocusState {
    const status: FocusStatus = !supported ? 'unsupported' : paused ? 'paused' : !blocks.length || !current ? 'empty' : 'active';
    return {
      status,
      interaction: settings?.interaction ?? 'keyboard',
      index: current ? blocks.indexOf(current) : -1,
      stats: { ...stats, detectMs: round(stats.detectMs), rescanMsMax: round(stats.rescanMsMax), rescanMsTotal: round(stats.rescanMsTotal), highlightMsMax: round(stats.highlightMsMax), stepMsMax: round(stats.stepMsMax), followMsMax: round(stats.followMsMax), followMsTotal: round(stats.followMsTotal) },
    };
  }

  return { id: 'focus', enable, update, disable, setPaused, state };
}
