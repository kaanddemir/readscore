/**
 * Focus paragraph detection: the Phase 1 "v2" detector, made single pass.
 *
 * - Scope: the main reading region when exactly one <main>/[role=main] (or else exactly one <article>)
 *   holds at least 3 paragraphs, narrowed to its single article when that article carries most of the
 *   main region's paragraph text; otherwise the whole document (pages with several articles or none).
 * - Candidates: reading elements (p, li, dd, dt, blockquote, figcaption, headings) plus "div soup"
 *   text blocks (div/section/span/td whose OWN text is long and that hold no reading element), so
 *   detection does not rely on selectors alone.
 * - Exclusions: navigation, site header/footer, sidebars, ads where identifiable, forms and controls,
 *   editable content, code, hidden or visually hidden (screen reader only) content, modal dialogs and
 *   fixed overlays that fit in the viewport.
 *   Page sized fixed wrappers (and body/html, which consent managers fix to lock scrolling) are NOT
 *   overlays: the Phase 1 fix is kept, and extended to viewport sized app shells that scroll their own
 *   content.
 * - Order: natural DOM order. Open shadow roots are walked in place (after their host), so their
 *   paragraphs keep their position. Closed shadow roots are unreachable by design.
 * - Description lists: a term with its description is a reading unit however short (a skills table:
 *   "Web" / "JavaScript, HTML, CSS"). A `dl > div` group is one block (term and value read together);
 *   a bare dt/dd is kept when its group has a term and a description.
 * - Innermost wins (li > p, blockquote > p), except a container with enough text of its own (an <li>
 *   with text followed by a nested list); its highlight range stops before the nested block.
 */
export const BLOCK_SEL = 'p, li, dd, dt, blockquote, figcaption, h1, h2, h3, h4, h5, h6';
const BLOCK_TAGS = new Set(['p', 'li', 'dd', 'dt', 'blockquote', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const HEADING = /^h[1-6]$/;
export const isHeading = (el: Element) => HEADING.test(el.localName);
const SOUP_TAGS = new Set(['div', 'section', 'span', 'td']);

/** A `dl > div` group (the HTML way to wrap one term with its descriptions) holding no nested reading
 *  blocks (a description made of paragraphs or lists keeps those as its blocks, so nothing is painted twice). */
const isDlGroup = (el: Element) => el.localName === 'div' && el.parentElement?.localName === 'dl' && !el.querySelector('p, li, blockquote, figcaption, h1, h2, h3, h4, h5, h6, dl');
/** A term/description pair with text on both sides: meaningful by structure, whatever its length. */
function dlPair(el: Element): boolean {
  const kids = (p: Element) => [...p.children].filter((c) => c.localName === 'dt' || c.localName === 'dd');
  if (isDlGroup(el)) {
    const k = kids(el);
    return k.some((c) => c.localName === 'dt' && textOf(c)) && k.some((c) => c.localName === 'dd' && textOf(c));
  }
  if (el.localName !== 'dt' && el.localName !== 'dd') return false;
  // Bare dt/dd: the partner is the nearest sibling of the other kind.
  const want = el.localName === 'dt' ? 'dd' : 'dt';
  for (let c = el.localName === 'dt' ? el.nextElementSibling : el.previousElementSibling; c; c = el.localName === 'dt' ? c.nextElementSibling : c.previousElementSibling) {
    if (c.localName === want) return !!textOf(c) && !!textOf(el);
  }
  return false;
}
export const MIN_CHARS = 25;

const EXCLUDE_SEL = [
  'nav', 'aside', 'form', 'button', 'label', 'select', 'textarea', 'input', 'option', 'dialog', 'menu', 'search', 'pre', 'code', 'kbd', 'samp',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]', '[role="search"]', '[role="menu"]',
  '[role="menubar"]', '[role="toolbar"]', '[role="tablist"]', '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
  '[contenteditable]:not([contenteditable="false"])', '[aria-hidden="true"]', '[inert]', '[hidden]',
  // Ads, where identifiable by common markers.
  'ins.adsbygoogle', '[id^="google_ads"]', '[id^="div-gpt-ad"]', '[data-ad-slot]', '[aria-label="Advertisement" i]',
].join(',');

type Root = Document | ShadowRoot;

/** closest() that crosses shadow boundaries. */
export function closestDeep(el: Element, sel: string): Element | null {
  let cur: Element | null = el;
  while (cur) {
    const hit = cur.closest(sel);
    if (hit) return hit;
    const root = cur.getRootNode();
    cur = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

/** Parent element, crossing from a shadow root to its host. */
export function parentDeep(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export const textOf = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

function ownText(el: Element): number {
  let n = 0;
  for (const c of el.childNodes) if (c.nodeType === 3) n += (c.nodeValue ?? '').trim().length;
  return n;
}

function isShown(el: Element): boolean {
  const e = el as HTMLElement & { checkVisibility?: (o: object) => boolean };
  if (typeof e.checkVisibility === 'function') return e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  return el.getClientRects().length > 0;
}

/** Site header/footer (not one that belongs to an article or the main region). */
function inSiteChrome(el: Element): boolean {
  const hf = closestDeep(el, 'header, footer');
  return !!hf && !closestDeep(hf, 'article, main, [role="main"]');
}

/** The reading region, or null for the whole document. */
export function contentRoot(doc: Document): Element | null {
  const enough = (e: Element) => e.querySelectorAll('p').length >= 3;
  const mains = [...doc.querySelectorAll('main, [role="main"]')].filter(enough);
  // Nested main inside main counts once: keep the outermost.
  const main = mains.length === 1 || (mains.length > 1 && mains.every((m) => m === mains[0] || mains[0]!.contains(m))) ? mains[0]! : null;
  if (main) {
    // A main region that holds exactly one article carrying most of its paragraph text (a README next
    // to a file list and a sidebar, a story next to related links): the article is the reading region.
    const articles = [...main.querySelectorAll('article')].filter(enough);
    if (articles.length === 1 && paragraphText(articles[0]!) >= paragraphText(main) * 0.6) return articles[0]!;
    return main;
  }
  const articles = [...doc.querySelectorAll('article')].filter(enough);
  if (articles.length === 1) return articles[0]!;
  return null;
}
const paragraphText = (e: Element) => [...e.querySelectorAll('p')].reduce((n, p) => n + (p.textContent?.length ?? 0), 0);

export interface Detection {
  blocks: Element[];
  /** Open shadow roots walked during detection (the runtime observes them and styles the highlight there). */
  shadowRoots: ShadowRoot[];
  /** Nearest scrolling ancestor of each block that is not the document scroller (nested scroll containers). */
  scrollers: Map<Element, Element>;
  scope: 'main' | 'article' | 'document';
  ms: number;
}

export function detectBlocks(doc: Document = document): Detection {
  const t0 = performance.now();
  const win = doc.defaultView!;
  const scope = contentRoot(doc);
  const shadowRoots: ShadowRoot[] = [];
  const raw: Element[] = [];

  const walk = (root: Root | Element): void => {
    const list = root instanceof Element ? [root, ...root.querySelectorAll('*')] : root.querySelectorAll('*');
    for (const el of list) {
      const tag = el.localName;
      if (isDlGroup(el)) raw.push(el);
      else if ((tag === 'dt' || tag === 'dd') && el.parentElement && isDlGroup(el.parentElement)) {
        // read with its group
      } else if (BLOCK_TAGS.has(tag)) raw.push(el);
      else if (SOUP_TAGS.has(tag) && ownText(el) >= MIN_CHARS * 2 && !el.querySelector(BLOCK_SEL)) raw.push(el);
      const sr = el.shadowRoot;
      if (sr) {
        shadowRoots.push(sr);
        walk(sr);
      }
    }
  };
  // The main region's shadow content is walked in place; outside it nothing is collected.
  walk(scope ?? doc);

  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const cs = (e: Element) => {
    let s = styleCache.get(e);
    if (!s) styleCache.set(e, (s = win.getComputedStyle(e)));
    return s;
  };
  const vh = win.innerHeight;
  const vw = win.innerWidth;
  const overlayCache = new Map<Element, boolean>();
  /** Inside a fixed overlay that fits in the viewport (cookie bar, pinned notice). Page sized fixed
   *  wrappers and body/html (scroll locks set by consent managers) are not overlays. */
  const inOverlay = (el: Element): boolean => {
    const seen: Element[] = [];
    let res = false;
    for (let cur: Element | null = el, i = 0; cur && i < 14; cur = parentDeep(cur), i++) {
      const known = overlayCache.get(cur);
      if (known !== undefined) {
        res = known;
        break;
      }
      seen.push(cur);
      if (cur === doc.body || cur === doc.documentElement) break;
      if (cs(cur).position === 'fixed') {
        const r = cur.getBoundingClientRect();
        // Taller than the viewport: a page sized wrapper. Covering the viewport and scrolling its own
        // content (or holding the reading region): an app shell. Anything else fixed is an overlay.
        const shell = r.height > vh * 1.05 || (r.height >= vh * 0.9 && r.width >= vw * 0.9 && (cur.scrollHeight > cur.clientHeight + 1 || (!!scope && cur.contains(scope))));
        if (!shell) {
          res = true;
          break;
        }
      }
    }
    for (const s of seen) overlayCache.set(s, res);
    return res;
  };

  const kept = raw.filter((el) => {
    if (closestDeep(el, EXCLUDE_SEL)) return false;
    if (inSiteChrome(el)) return false;
    const len = textOf(el).length;
    if (HEADING.test(el.localName) ? len === 0 : len < MIN_CHARS && !dlPair(el)) return false;
    if (!isShown(el)) return false;
    // Visually hidden text (screen reader only, clipped to 1px) is never a paragraph to read on screen.
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return false;
    return !inOverlay(el);
  });

  // Innermost wins. `kept` is in tree order, so an element that contains any kept element is
  // immediately followed by one of its descendants: one look ahead per element (linear).
  const blocks = kept.filter((el, i) => {
    const next = kept[i + 1];
    return !(next && el.contains(next)) || ownText(el) >= MIN_CHARS || (isDlGroup(el) && dlPair(el));
  });

  // Nested scroll containers (for Follow scroll clipping and keyboard scrolling).
  const scrollers = new Map<Element, Element>();
  const scrollerCache = new Map<Element, Element | null>();
  const scrollerOf = (el: Element): Element | null => {
    const seen: Element[] = [];
    let res: Element | null = null;
    for (let cur = parentDeep(el); cur && cur !== doc.body && cur !== doc.documentElement; cur = parentDeep(cur)) {
      const known = scrollerCache.get(cur);
      if (known !== undefined) {
        res = known;
        break;
      }
      seen.push(cur);
      const oy = cs(cur).overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && cur.scrollHeight > cur.clientHeight + 1) {
        res = cur;
        break;
      }
    }
    for (const s of seen) scrollerCache.set(s, res);
    return res;
  };
  for (const b of blocks) {
    const s = scrollerOf(b);
    if (s) scrollers.set(b, s);
  }

  return { blocks, shadowRoots, scrollers, scope: !scope ? 'document' : scope.localName === 'article' ? 'article' : 'main', ms: performance.now() - t0 };
}

/** The range painted for `el`: its contents, stopping before a nested reading block or list. */
export function blockRange(el: Element): Range {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  if (isDlGroup(el)) return range; // the term and its description read together
  const nested = el.querySelector(BLOCK_SEL + ', ul, ol');
  if (nested) range.setEndBefore(nested);
  return range;
}
