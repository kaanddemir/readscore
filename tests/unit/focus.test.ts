// @vitest-environment happy-dom
/**
 * Focus page side (detection, highlight lifecycle, keys, Follow scroll, pause, dynamic content).
 * happy-dom has no layout and no Highlight API: both are stubbed here. Each reading block gets a box
 * 100px apart in document order; `scroll(y)` moves the page. Paint itself is verified with pixels in
 * tests/browser/focus.mjs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockRange, contentRoot, detectBlocks } from '../../src/content/focus/detect';
import { createFocusMode, RESCAN_DEBOUNCE_MS, RESCAN_MIN_INTERVAL_MS } from '../../src/content/focus';
import { buildFocusCss, FOCUS_CSS_MARKER, FOCUS_HL_NAMES, FOCUS_PAINT_CSS, FOCUS_PALETTE, focusHighlightName } from '../../src/shared/focus';
import { FOCUS_COLORS } from '../../src/shared/settings';
import { normalizeSettings, type FocusSettings } from '../../src/shared/settings';

// ── layout + Highlight API stubs ──
let sy = 0;
const boxes = new Map<Element, { top: number; height: number }>();
const fixed = new Map<Element, { top: number; height: number; width: number }>();
let highlights: Map<string, { ranges: Range[] }>;
const scrolls: Element[] = [];

function layout(): void {
  boxes.clear();
  let i = 0;
  const walk = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll('*')) {
      if (/^(p|li|dd|dt|blockquote|figcaption|h[1-6]|div|section|span|td)$/.test(el.localName)) boxes.set(el, { top: i++ * 100, height: 80 });
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
}
const scroll = (y: number) => ((sy = y), document.dispatchEvent(new Event('scroll')));
const frame = () => new Promise((r) => setTimeout(r, 40));
const fs = (on: Partial<FocusSettings> = {}): FocusSettings => ({ ...normalizeSettings({}).modes.focus, enabled: true, ...on });
const current = (): Element | null => {
  const h = FOCUS_HL_NAMES.map((n) => highlights.get(n)).find(Boolean);
  if (!h) return null;
  const n = h.ranges[0]!.commonAncestorContainer;
  return n.nodeType === 1 ? (n as Element) : n.parentElement;
};
const key = (k: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const para = (n: number, extra = '') => `<p id="p${n}"${extra}>Paragraph ${n}. Reading on screen is easier when the text has room to breathe.</p>`;
const article = (n: number) => `<main>${Array.from({ length: n }, (_, i) => para(i + 1)).join('')}</main>`;

beforeEach(() => {
  sy = 0;
  scrolls.length = 0;
  fixed.clear();
  highlights = new Map();
  Object.defineProperty(window, 'CSS', { value: { highlights }, configurable: true });
  (window as unknown as { Highlight: unknown }).Highlight = class {
    ranges: Range[];
    constructor(...r: Range[]) {
      this.ranges = r;
    }
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const f = fixed.get(this);
    if (f) return { top: f.top, bottom: f.top + f.height, height: f.height, left: 0, right: f.width, width: f.width, x: 0, y: f.top } as DOMRect;
    const b = boxes.get(this) ?? { top: 0, height: 2000 };
    return { top: b.top - sy, bottom: b.top - sy + b.height, height: b.height, left: 0, right: 600, width: 600, x: 0, y: b.top - sy } as DOMRect;
  });
  (Element.prototype as unknown as { checkVisibility: () => boolean }).checkVisibility = function (this: Element) {
    for (let e: Element | null = this; e; e = e.parentElement) if ((e as HTMLElement).style?.display === 'none') return false;
    return true;
  };
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolls.push(this);
    const b = boxes.get(this);
    if (b) sy = b.top - 300;
  };
  document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

describe('Focus CSS', () => {
  it('is null when off and the AUTHOR paint rules when on, never depending on other options', () => {
    expect(buildFocusCss(fs({ enabled: false }))).toBeNull();
    const css = buildFocusCss(fs())!;
    expect(css.startsWith(FOCUS_CSS_MARKER)).toBe(true);
    for (const n of FOCUS_HL_NAMES) expect(css).toContain(`::highlight(${n})`);
    expect(buildFocusCss(fs({ interaction: 'scroll' }))).toBe(css);
    expect(buildFocusCss(fs({ color: 'dark' }))).toBe(css);
  });
  it('sets a background and a text colour only: typography stays the site\'s', () => {
    expect(FOCUS_PAINT_CSS).toMatch(/background-color/);
    expect(FOCUS_PAINT_CSS).not.toMatch(/font|line-height|!important/);
  });
  it('every colour keeps WCAG AA text contrast (>= 4.5:1)', () => {
    const lum = (c: readonly number[]) => {
      const ch = c.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
    };
    for (const c of FOCUS_COLORS) {
      const [a, b] = [lum(FOCUS_PALETTE[c].bg), lum(FOCUS_PALETTE[c].fg)].sort((x, y) => y - x);
      expect((a! + 0.05) / (b! + 0.05), c).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('detection', () => {
  it('reads short term/description pairs: a dl > div group is one block, a bare dt/dd pair two', () => {
    document.body.innerHTML = `<main>${para(1)}${para(2)}${para(3)}
      <dl id="grouped">
        <div class="y"><dt>Programming &amp; Databases</dt><dd>Python, SQL, C#</dd></div>
        <div class="y"><dt>Data Analytics &amp; Visualization</dt><dd>Pandas, NumPy, OpenCV, Power BI (DAX), Microsoft Excel</dd></div>
        <div class="y"><dt>Web</dt><dd>JavaScript, HTML, CSS</dd></div>
        <div class="y"><dt>Cloud &amp; Tools</dt><dd>Microsoft Azure, Linux, Git, GitHub</dd></div>
        <div><dt>Lonely term</dt></div>
      </dl>
      <dl><dt class="y">Web</dt><dd class="y">JavaScript, HTML, CSS</dd><dt>Orphan</dt></dl>
      <dl><div><dt class="y">Rich</dt><dd><p class="y">A description written as a paragraph long enough to read.</p></dd></div></dl></main>`;
    layout();
    const d = detectBlocks();
    expect(d.blocks.filter((b) => !/^p\d/.test(b.id))).toEqual([...document.querySelectorAll('.y')]);
    const group = document.querySelector('#grouped > div')!;
    expect(blockRange(group).toString()).toContain('Python, SQL, C#');
  });

  it('finds reading blocks in DOM order and skips UI, code, editable, hidden and forms', () => {
    document.body.innerHTML = `
      <header><p class="x">Site header tagline that is long enough to count as text.</p></header>
      <nav><ul><li class="x">Navigation item with a fairly long label text here</li></ul></nav>
      <main>
        <h1 class="y">Title</h1>${para(1)}
        <ul><li class="y">A list item that is long enough to be read as its own block.</li>
          <li class="y">Outer item with enough text to count before the nested list.<ul><li class="y">A nested list item that also has plenty of text.</li></ul></li></ul>
        <blockquote><p class="y">A quoted paragraph inside a blockquote element, long enough.</p></blockquote>
        <div class="y">Div soup: this text sits directly inside a div with no paragraph element around it at all.</div>
        <p class="x">Read more</p>
        <pre class="x">const code = "never a reading block even if long enough to qualify";</pre>
        <div contenteditable="true"><p class="x">Editable paragraph: the user is typing here, so focus must not take over.</p></div>
        <form><label class="x">A form label that is long enough to be mistaken for text</label></form>
        <p aria-hidden="true" class="x">Hidden from assistive technology, decorative duplicate text.</p>
        <p style="display:none" class="x">Not displayed at all, but long enough to qualify as text.</p>
        <div role="dialog"><p class="x">A dialog paragraph that is long enough to count as text here.</p></div>
        <ins class="adsbygoogle"><p class="x">Sponsored text block that is long enough to look like content.</p></ins>
        ${para(2)}${para(3)}
      </main>
      <aside><p class="x">Sidebar promo paragraph with enough words to look like content.</p></aside>
      <footer><p class="x">Footer copyright paragraph that is also long enough to count.</p></footer>`;
    for (const e of document.querySelectorAll('main > p[id]')) e.classList.add('y');
    layout();
    const d = detectBlocks();
    expect(d.scope).toBe('main');
    expect(d.blocks).toEqual([...document.querySelectorAll('.y')]);
    expect(d.blocks.some((b) => b.classList.contains('x'))).toBe(false);
  });

  it('a site header/footer is skipped but an article header is read', () => {
    document.body.innerHTML = `<header><p>Site header tagline that is long enough to count.</p></header><article><header><h1 id="h">Story</h1><p id="s">The standfirst of the story, long enough to be read.</p></header>${para(1)}${para(2)}${para(3)}</article>`;
    layout();
    const ids = detectBlocks().blocks.map((b) => b.id);
    expect(ids).toEqual(['h', 's', 'p1', 'p2', 'p3']);
  });

  it('several articles and no main: the whole document is the scope, and every story is found', () => {
    document.body.innerHTML = [1, 2, 3].map((a) => `<article><h2>Story ${a}</h2>${para(a * 10 + 1)}${para(a * 10 + 2)}${para(a * 10 + 3)}</article>`).join('');
    layout();
    expect(contentRoot(document)).toBeNull();
    const d = detectBlocks();
    expect(d.scope).toBe('document');
    expect(d.blocks.length).toBe(12);
  });

  it('main holding one article with most of its text: the article is the reading region (README, story)', () => {
    document.body.innerHTML = `<main><div class="files"><p>File list row text that is long enough to count.</p></div><article id="a">${para(1)}${para(2)}${para(3)}${para(4)}</article><div class="side"><h2 id="side">About</h2><p>Sidebar text that is long enough to count here too.</p></div></main>`;
    layout();
    const d = detectBlocks();
    expect(d.scope).toBe('article');
    expect(d.blocks.map((b) => b.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    // A main region whose text is mostly outside the article keeps the whole main region.
    document.body.innerHTML = `<main>${para(5)}${para(6)}${para(7)}${para(8)}${para(9)}<article>${para(1)}${para(2)}${para(3)}</article></main>`;
    layout();
    expect(detectBlocks().scope).toBe('main');
  });

  it('a nested <main> inside <main> counts as one reading region', () => {
    document.body.innerHTML = `<main id="outer"><main id="inner">${para(1)}${para(2)}${para(3)}</main></main><p>Outside paragraph text that is long enough to count.</p>`;
    expect(contentRoot(document)?.id).toBe('outer');
  });

  it('fixed overlays (cookie bar) are skipped; page sized and app shell fixed wrappers are not', () => {
    document.body.innerHTML = `<div id="shell"><main>${para(1)}${para(2)}${para(3)}</main></div><div id="bar"><p id="cookie">We use cookies to improve your experience on this website.</p></div><div id="tall"><p id="t">A paragraph inside a tall fixed wrapper, long enough to read.</p></div>`;
    layout();
    for (const id of ['shell', 'bar', 'tall']) (document.getElementById(id) as HTMLElement).style.position = 'fixed';
    fixed.set(document.getElementById('shell')!, { top: 0, height: 768, width: 1024 }); // covers the viewport, holds main
    fixed.set(document.getElementById('bar')!, { top: 700, height: 68, width: 1024 });
    fixed.set(document.getElementById('tall')!, { top: 0, height: 3000, width: 1024 });
    document.body.style.position = 'fixed'; // consent manager scroll lock
    const ids = detectBlocks().blocks.map((b) => b.id);
    expect(ids).toEqual(['p1', 'p2', 'p3']); // main is the scope; the cookie bar is never a candidate
    document.body.innerHTML = `<div id="tall2"><p id="t">A paragraph inside a tall fixed wrapper, long enough to read.</p></div><div id="bar2"><p id="c">We use cookies to improve your experience on this website.</p></div>`;
    layout();
    for (const id of ['tall2', 'bar2']) (document.getElementById(id) as HTMLElement).style.position = 'fixed';
    fixed.set(document.getElementById('tall2')!, { top: 0, height: 3000, width: 1024 });
    fixed.set(document.getElementById('bar2')!, { top: 700, height: 68, width: 1024 });
    expect(detectBlocks().blocks.map((b) => b.id)).toEqual(['t']);
  });

  it('walks open shadow roots in place (after their host), nested too', () => {
    document.body.innerHTML = `<main>${para(1)}<x-host></x-host>${para(2)}${para(3)}</main>`;
    const host = document.querySelector('x-host')!;
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<p id="s1">Paragraph inside an open shadow root, reachable by the extension.</p><x-inner></x-inner>';
    sr.querySelector('x-inner')!.attachShadow({ mode: 'open' }).innerHTML = '<p id="s2">Paragraph inside a nested open shadow root, two levels deep.</p>';
    layout();
    const d = detectBlocks();
    expect(d.blocks.map((b) => b.id)).toEqual(['p1', 's1', 's2', 'p2', 'p3']);
    expect(d.shadowRoots.length).toBe(2);
  });

  it('records the nested scroll container of each block', () => {
    document.body.innerHTML = `<div id="pane" style="overflow-y:auto"><main>${para(1)}${para(2)}${para(3)}</main></div>`;
    const pane = document.getElementById('pane')!;
    Object.defineProperty(pane, 'scrollHeight', { value: 3000 });
    Object.defineProperty(pane, 'clientHeight', { value: 500 });
    layout();
    const d = detectBlocks();
    expect(d.blocks.every((b) => d.scrollers.get(b) === pane)).toBe(true);
  });

  it('the range of a container item stops before its nested list (text is never wrapped)', () => {
    document.body.innerHTML = '<ul><li id="o">Outer item text<ul><li>Inner</li></ul></li></ul>';
    const r = blockRange(document.getElementById('o')!);
    expect(r.toString()).toBe('Outer item text');
  });

  it('visually hidden (screen reader only) text is skipped', () => {
    document.body.innerHTML = `<main><h2 id="sr">Folders and files</h2>${para(1)}${para(2)}${para(3)}</main>`;
    layout();
    boxes.set(document.getElementById('sr')!, { top: 0, height: 1 });
    expect(detectBlocks().blocks.map((b) => b.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('a page without reading text yields no blocks', () => {
    document.body.innerHTML = '<nav><a href="#">Home</a></nav><button>Go</button>';
    layout();
    expect(detectBlocks().blocks).toEqual([]);
  });
});

describe('Focus mode', () => {
  let mode: ReturnType<typeof createFocusMode>;
  beforeEach(() => {
    document.body.innerHTML = article(20) + '<input id="inp"><textarea id="ta"></textarea><div id="ce" contenteditable="true">x</div><div id="tb" role="textbox">t</div><select id="sel"></select>';
    layout();
    mode = createFocusMode(document);
  });
  afterEach(() => mode.disable());

  it('starts at the reading line (middle of the screen), not at the top', () => {
    scroll(1000); // p11 top at 0, line at 384 → p14 (top 1300 - 1000 = 300, bottom 380)… nearest is p14/p15
    mode.enable(fs());
    const c = current()!;
    expect(['p14', 'p15']).toContain(c.id);
    expect(mode.state().status).toBe('active');
  });

  it('registers exactly one highlight; disable removes it and every listener', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    mode.enable(fs());
    expect(highlights.size).toBe(1);
    mode.disable();
    expect(highlights.size).toBe(0);
    const added = add.mock.calls.map((c) => c[0]).sort();
    const removed = remove.mock.calls.map((c) => c[0]).sort();
    expect(removed).toEqual(expect.arrayContaining(added));
    expect(document.body.innerHTML).not.toContain('rs-');
  });

  it('paints with the chosen colour and recolours at once', () => {
    mode.enable(fs({ color: 'blue' }));
    expect([...highlights.keys()]).toEqual([focusHighlightName('blue')]);
    const c = current();
    mode.update(fs({ color: 'dark' }));
    expect([...highlights.keys()]).toEqual([focusHighlightName('dark')]);
    expect(current()).toBe(c);
  });

  it('no listeners at all while Focus is off', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const docAdd = vi.spyOn(document, 'addEventListener');
    createFocusMode(document);
    expect(add).not.toHaveBeenCalled();
    expect(docAdd).not.toHaveBeenCalled();
  });

  it('J and K step in reading order, are consumed, and scroll only when needed', () => {
    mode.enable(fs());
    const start = current()!.id;
    const n = Number(start.slice(1));
    const e = key('j');
    expect(e.defaultPrevented).toBe(true);
    expect(current()!.id).toBe(`p${n + 1}`);
    key('k');
    expect(current()!.id).toBe(start);
    expect(scrolls.length).toBe(0); // the paragraph was already on screen
    for (let i = 0; i < 8; i++) key('j');
    expect(scrolls.length).toBeGreaterThan(0); // moved past the bottom: brought into view
  });

  it('J at the last paragraph stays there (no wrap)', () => {
    mode.enable(fs());
    for (let i = 0; i < 40; i++) key('j');
    expect(current()!.id).toBe('p20');
  });

  it('never takes J/K while typing, with modifiers or in a text widget', () => {
    mode.enable(fs());
    const start = current()!.id;
    for (const id of ['inp', 'ta', 'ce', 'tb', 'sel']) expect(key('j', document.getElementById(id)!).defaultPrevented).toBe(false);
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) expect(key('j', document.body, { [mod]: true }).defaultPrevented).toBe(false);
    expect(key('j', document.body, { isComposing: true }).defaultPrevented).toBe(false);
    expect(current()!.id).toBe(start);
  });

  it('Esc pauses (not consumed); J resumes on the remembered paragraph', () => {
    mode.enable(fs());
    key('j');
    const at = current()!.id;
    const esc = key('Escape');
    expect(esc.defaultPrevented).toBe(false);
    expect(highlights.size).toBe(0);
    expect(mode.state().status).toBe('paused');
    expect(mode.state().index).toBeGreaterThanOrEqual(0);
    key('j');
    expect(mode.state().status).toBe('active');
    expect(current()!.id).toBe(at);
  });

  it('Esc used by a focused widget, or with an open dialog, does not pause; a page wide handler does not block it', () => {
    mode.enable(fs());
    const w = document.createElement('button');
    document.body.append(w);
    w.focus();
    w.addEventListener('keydown', (e) => e.key === 'Escape' && e.preventDefault(), { once: true });
    key('Escape', w);
    expect(mode.state().status).toBe('active');
    w.blur();
    document.addEventListener('keydown', (e) => e.key === 'Escape' && e.preventDefault(), { once: true });
    key('Escape');
    expect(mode.state().status).toBe('paused');
    mode.setPaused(false);
    document.body.insertAdjacentHTML('beforeend', '<div aria-modal="true" style="display:none"></div>');
    key('Escape'); // a hidden panel is not an open dialog
    expect(mode.state().status).toBe('paused');
    mode.setPaused(false);
    document.body.insertAdjacentHTML('beforeend', '<div aria-modal="true"></div>');
    key('Escape');
    expect(mode.state().status).toBe('active');
  });

  it('setPaused from the popup pauses and resumes; paused is not disabled', () => {
    mode.enable(fs());
    mode.setPaused(true);
    expect(mode.state().status).toBe('paused');
    expect(highlights.size).toBe(0);
    mode.setPaused(false);
    expect(highlights.size).toBe(1);
  });

  it('Follow scroll: tracks the paragraph at the reading line once per frame, J/K left to the page', async () => {
    mode.enable(fs({ interaction: 'scroll' }));
    expect(key('j').defaultPrevented).toBe(false);
    scroll(500);
    scroll(600);
    scroll(700);
    await frame();
    const c = current()!;
    const r = c.getBoundingClientRect();
    expect(r.top <= 384 + 20 && r.bottom >= 384 - 20).toBe(true);
    const st = mode.state().stats;
    expect(st.followFrames).toBe(1); // three scroll events, one frame
    expect(scrolls.length).toBe(0); // never scrolls the page itself
  });

  it('Follow scroll keeps the current paragraph while it still crosses the line (stable)', async () => {
    // Two paragraphs cross the line (side by side columns): the current one is kept while it crosses.
    const p5 = document.getElementById('p5')!;
    const p9 = document.getElementById('p9')!;
    sy = 50; // p5 (400..480 on the page) crosses the line at 384
    mode.enable(fs({ interaction: 'scroll' }));
    expect(current()).toBe(p5);
    boxes.set(p9, { top: 380, height: 120 }); // later in order, also crossing
    boxes.set(document.getElementById('p2')!, { top: 380, height: 120 }); // earlier in order, also crossing
    scroll(60);
    await frame();
    expect(current()).toBe(p5);
  });

  it('switching Keyboard ↔ Follow scroll is immediate', async () => {
    mode.enable(fs());
    mode.update(fs({ interaction: 'scroll' }));
    expect(key('j').defaultPrevented).toBe(false);
    scroll(1500);
    await frame();
    expect(Number(current()!.id.slice(1))).toBeGreaterThan(15);
    mode.update(fs({ interaction: 'keyboard' }));
    expect(key('j').defaultPrevented).toBe(true);
  });

  it('paused Follow scroll does not track; resume picks the reading line', async () => {
    mode.enable(fs({ interaction: 'scroll' }));
    mode.setPaused(true);
    scroll(1200);
    await frame();
    expect(highlights.size).toBe(0);
    mode.setPaused(false);
    const r = current()!.getBoundingClientRect();
    expect(r.top <= 404 && r.bottom >= 364).toBe(true);
  });

  it('unsupported Highlight API: reports it and adds nothing', () => {
    Object.defineProperty(window, 'CSS', { value: {}, configurable: true });
    const add = vi.spyOn(window, 'addEventListener');
    const m = createFocusMode(document);
    m.enable(fs());
    expect(m.state().status).toBe('unsupported');
    expect(add).not.toHaveBeenCalled();
    m.disable();
  });

  it('no readable text: status empty, no highlight, J does nothing', () => {
    mode.disable();
    document.body.innerHTML = '<nav><a href="#">Home</a></nav>';
    layout();
    mode = createFocusMode(document);
    mode.enable(fs());
    expect(mode.state().status).toBe('empty');
    expect(highlights.size).toBe(0);
    expect(key('j').defaultPrevented).toBe(false);
  });
});

describe('Focus dynamic content', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  const settle = async (ms: number) => {
    await Promise.resolve(); // MutationObserver callbacks are microtasks
    await vi.advanceTimersByTimeAsync(ms);
  };

  it('added paragraphs are found after the debounce; the current paragraph is kept', async () => {
    document.body.innerHTML = article(5);
    layout();
    const m = createFocusMode(document);
    m.enable(fs());
    const c = current();
    document.querySelector('main')!.insertAdjacentHTML('beforeend', para(6) + para(7));
    layout();
    await settle(RESCAN_DEBOUNCE_MS - 50);
    expect(m.state().stats.blocks).toBe(5);
    await settle(RESCAN_MIN_INTERVAL_MS);
    expect(m.state().stats.blocks).toBe(7);
    expect(current()).toBe(c);
    m.disable();
  });

  it('removing the highlighted paragraph recovers on another one quickly', async () => {
    document.body.innerHTML = article(6);
    layout();
    const m = createFocusMode(document);
    m.enable(fs());
    const gone = current()!;
    gone.remove();
    layout();
    await settle(RESCAN_DEBOUNCE_MS + 10);
    expect(current()).not.toBe(gone);
    expect(current()!.isConnected).toBe(true);
    m.disable();
  });

  it('a mutation flood is capped: at most one scan per second, irrelevant nodes ignored', async () => {
    document.body.innerHTML = article(5);
    layout();
    const m = createFocusMode(document);
    m.enable(fs());
    for (let i = 0; i < 300; i++) {
      const s = document.createElement('span');
      s.textContent = String(i);
      document.body.append(s);
      s.remove();
      await settle(10); // 3 s of continuous mutations
    }
    await settle(RESCAN_MIN_INTERVAL_MS + RESCAN_DEBOUNCE_MS);
    const { rescans, mutationBatches } = m.state().stats;
    expect(mutationBatches).toBeGreaterThan(100);
    expect(rescans).toBeLessThanOrEqual(4);
    expect(rescans).toBeGreaterThanOrEqual(1);
    const before = m.state().stats.rescans;
    document.body.append(document.createElement('script'));
    await settle(RESCAN_MIN_INTERVAL_MS * 2);
    expect(m.state().stats.rescans).toBe(before); // a script tag is not reading content
    m.disable();
  });

  it('a page that gets text later becomes active; no observer after disable', async () => {
    document.body.innerHTML = '<nav>x</nav>';
    layout();
    const m = createFocusMode(document);
    m.enable(fs());
    expect(m.state().status).toBe('empty');
    document.body.insertAdjacentHTML('beforeend', article(3));
    layout();
    await settle(RESCAN_MIN_INTERVAL_MS + RESCAN_DEBOUNCE_MS);
    expect(m.state().status).toBe('active');
    m.disable();
    const scans = m.state().stats.rescans;
    document.body.insertAdjacentHTML('beforeend', article(2));
    await settle(RESCAN_MIN_INTERVAL_MS * 3);
    expect(m.state().stats.rescans).toBe(scans);
    expect(highlights.size).toBe(0);
  });

  it('a pending re-detection runs before a key press acts on stale content', async () => {
    document.body.innerHTML = article(4);
    layout();
    const m = createFocusMode(document);
    m.enable(fs());
    key('Escape');
    document.querySelector('main')!.innerHTML = '<p id="new">Replacement paragraph after the pause, long enough to be read.</p>';
    layout();
    await Promise.resolve();
    key('j'); // before the debounce fired
    expect(current()!.id).toBe('new');
    m.disable();
  });
});
