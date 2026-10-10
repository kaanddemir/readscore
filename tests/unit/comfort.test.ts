// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ATKINSON_FAMILY, ATKINSON_FILES, COMFORT_CSS_MARKER, COMFORT_FONT_STACKS, buildComfortCss } from '../../src/shared/comfort';
import { COMFORT_PRESET_VALUES, defaultSettings, normalizeSettings, type ComfortSettings } from '../../src/shared/settings';

const comfort = (over: Partial<ComfortSettings> = {}): ComfortSettings => ({ ...defaultSettings().modes.comfort, enabled: true, ...over });

describe('buildComfortCss', () => {
  it('off → null (nothing to insert)', () => expect(buildComfortCss(defaultSettings().modes.comfort)).toBeNull());

  it('Relaxed (default): 1.6 / 0.02em / 0.08em on reading text, 1.5em after paragraphs', () => {
    const css = buildComfortCss(comfort())!;
    expect(css.startsWith(COMFORT_CSS_MARKER)).toBe(true);
    expect(css).toContain('line-height: 1.6 !important; letter-spacing: 0.02em !important; word-spacing: 0.08em !important;');
    expect(css).toContain('margin-block-end: 1.5em !important;');
    expect(css).not.toContain('font-family');
    expect(css).not.toContain('font-size');
  });

  it('Site spacing writes no spacing rule; font and size still apply on their own', () => {
    expect(buildComfortCss(comfort({ preset: 'site' }))).toBe(COMFORT_CSS_MARKER);
    const css = buildComfortCss(comfort({ preset: 'site', font: 'atkinson', minSize: '22' }))!;
    expect(css).not.toMatch(/line-height|letter-spacing|word-spacing|margin-block-end/);
    expect(css).toContain(`font-family: ${COMFORT_FONT_STACKS.atkinson} !important;`);
    expect(css).toContain('font-size: max(1em, 22px) !important;');
  });

  it('Roomy = WCAG 1.4.12 values (the v2 Standard)', () => {
    const r = COMFORT_PRESET_VALUES.roomy;
    expect(r).toEqual({ lineHeight: 1.5, letterSpacing: 0.12, wordSpacing: 0.16, paragraphSpacing: 2 });
    const css = buildComfortCss(normalizeSettings({ version: 3, modes: { comfort: { enabled: true, preset: 'roomy' } } }).modes.comfort)!;
    expect(css).toContain(`line-height: ${r.lineHeight} !important; letter-spacing: ${r.letterSpacing}em !important; word-spacing: ${r.wordSpacing}em !important;`);
    expect(css).toContain(`margin-block-end: ${r.paragraphSpacing}em`);
  });

  it('Custom values are written without float noise', () => {
    const css = buildComfortCss(comfort({ preset: 'custom', lineHeight: 1.7000000001, letterSpacing: 0.06, wordSpacing: 0.08, paragraphSpacing: 1.25 }))!;
    expect(css).toContain('line-height: 1.7 !important; letter-spacing: 0.06em !important; word-spacing: 0.08em !important;');
    expect(css).toContain('margin-block-end: 1.25em');
  });

  it.each(['sans', 'serif'] as const)('font %s: system stack on text and headings; Site default writes no font rule', (font) => {
    const css = buildComfortCss(comfort({ font }))!;
    expect(css).toContain(`font-family: ${COMFORT_FONT_STACKS[font]} !important;`);
    expect(css).toMatch(/:is\([^)]*h1, h2, h3, h4, h5, h6\)/);
    expect(css).not.toMatch(/url\(|@import|@font-face/); // no downloads
  });

  it.each(['18', '20', '22'] as const)('text size %s px uses max(1em, N px) on reading text and its inline text only (never zoom)', (minSize) => {
    const css = buildComfortCss(comfort({ minSize }))!;
    const [block, inline] = css.split('\n').filter((l) => l.includes('font-size'));
    expect(block).toContain(`font-size: max(1em, ${minSize}px) !important;`);
    expect(block).not.toContain('h1');
    // Inline text inside reading blocks: links and spans with their own sizes; never small, sub, sup,
    // code, controls or badges.
    expect(inline).toMatch(/:is\(a, span, em, strong/);
    expect(inline).toContain(`font-size: max(1em, ${minSize}px) !important;`);
    expect(inline).not.toMatch(/:is\([^)]*\b(small|sub|sup)\b/);
    expect(inline).toContain('[class*="badge" i]');
    expect(inline).toContain('[role="button"]');
  });

  it('Atkinson Hyperlegible: the bundled family first, system fallbacks after; the Comfort CSS loads nothing', () => {
    expect(COMFORT_FONT_STACKS.atkinson.startsWith(`'${ATKINSON_FAMILY}'`)).toBe(true);
    expect(ATKINSON_FILES.map((f) => `${f.weight}/${f.style}`)).toEqual(['400/normal', '700/normal', '400/italic', '700/italic']);
    expect(buildComfortCss(comfort({ font: 'atkinson' }))).not.toMatch(/url\(|@import|@font-face/);
  });

  it('every rule excludes code, forms, editable content, SVG and interface regions', () => {
    const css = buildComfortCss(comfort({ font: 'serif', minSize: '20' }))!;
    const rules = css.split('\n').filter((l) => l.includes('{') && !l.includes('normal !important')); // the control reset rule only removes spacing
    for (const r of rules) for (const ex of ['pre', 'code', 'textarea', 'input', 'select', 'button', '[contenteditable]', 'svg', 'nav *', '[role="menu"] *', '[role="toolbar"] *']) expect(r).toContain(ex);
  });

  it('controls inside reading text get normal spacing back', () => {
    const css = buildComfortCss(comfort())!;
    expect(css).toMatch(/\[class\*="btn" i\][^{]*\{ letter-spacing: normal !important; word-spacing: normal !important; \}/);
  });

  it('is deterministic (removeCSS needs the identical string)', () => {
    expect(buildComfortCss(comfort({ font: 'sans' }))).toBe(buildComfortCss(comfort({ font: 'sans' })));
  });
});

describe('Comfort bundled font (page side, FontFace API)', () => {
  it('registers the four faces only while Comfort uses Atkinson, whichever arrives first; removes them on font change and disable', async () => {
    const { createComfortMode } = await import('../../src/content/comfort');
    const added: unknown[] = [];
    class FakeFace {
      constructor(public family: string, public data: ArrayBuffer, public desc: object) {}
    }
    Object.assign(window, { FontFace: FakeFace });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (f: unknown) => added.push(f), delete: (f: unknown) => added.splice(added.indexOf(f), 1) } });
    document.body.innerHTML = '<p>Text</p>';
    const m = createComfortMode(document);
    m.enable(comfort({ font: 'atkinson' }));
    expect(m.fontFaces()).toBe(0); // no bytes yet
    m.setFontData(ATKINSON_FILES.map(() => btoa('font')));
    expect(added).toHaveLength(4);
    expect((added[3] as FakeFace).family).toBe(ATKINSON_FAMILY);
    expect((added[3] as FakeFace).desc).toMatchObject({ weight: '700', style: 'italic' });
    m.update(comfort({ font: 'serif' }));
    expect(added).toHaveLength(0);
    m.update(comfort({ font: 'atkinson' }));
    expect(added).toHaveLength(4); // bytes kept: no second message needed
    m.disable();
    expect(added).toHaveLength(0);
    expect(m.fontFaces()).toBe(0);
  });
});

describe('Comfort in open shadow roots (page side)', () => {
  it('one shared sheet in every open shadow root (nested and added later), live updates, complete removal', async () => {
    const { createComfortMode } = await import('../../src/content/comfort');
    document.body.innerHTML = '<div id="a"></div><div id="closed"></div>';
    const a = document.getElementById('a')!.attachShadow({ mode: 'open' });
    a.innerHTML = '<p>Shadow paragraph</p><div id="inner"></div>';
    const inner = (a.getElementById('inner') as HTMLElement).attachShadow({ mode: 'open' });
    inner.innerHTML = '<p>Nested shadow paragraph</p>';
    document.getElementById('closed')!.attachShadow({ mode: 'closed' });
    const before = [a.adoptedStyleSheets.length, inner.adoptedStyleSheets.length];
    const written: string[] = [];
    const orig = CSSStyleSheet.prototype.replaceSync;
    CSSStyleSheet.prototype.replaceSync = function (this: CSSStyleSheet, t: string) {
      written.push(t);
      return orig.call(this, t);
    };
    const m = createComfortMode(document);
    m.enable(comfort({ minSize: '20' }));
    expect(m.shadowRoots()).toBe(2); // closed roots are unreachable by design
    const sheet = a.adoptedStyleSheets.at(-1)!;
    expect(inner.adoptedStyleSheets.at(-1)).toBe(sheet);
    const text = () => written.at(-1)!;
    expect(text()).toContain('max(1em, 20px)');
    m.update(comfort({ minSize: '22', preset: 'site' }));
    expect(text()).toContain('max(1em, 22px)');
    expect(text()).not.toContain('line-height');
    // A host added later is picked up in one batch.
    const late = document.createElement('div');
    late.attachShadow({ mode: 'open' }).innerHTML = '<p>Late</p>';
    document.body.append(late);
    await new Promise((r) => setTimeout(r, 0));
    m.flushNow();
    // update() swaps in a new shared sheet (Chrome restyles shadow trees reliably only on a sheet swap).
    const current = a.adoptedStyleSheets.at(-1)!;
    expect(current).not.toBe(sheet);
    expect([inner.adoptedStyleSheets.at(-1), late.shadowRoot!.adoptedStyleSheets.at(-1)]).toEqual([current, current]);
    // restyleShadow (called after the service worker changed the USER sheet) re-adopts an equal sheet everywhere.
    m.restyleShadow!();
    const again = a.adoptedStyleSheets.at(-1)!;
    expect(again).not.toBe(current);
    expect(text()).toContain('max(1em, 22px)');
    expect([inner.adoptedStyleSheets.at(-1), late.shadowRoot!.adoptedStyleSheets.at(-1)]).toEqual([again, again]);
    m.disable();
    expect([a.adoptedStyleSheets.length, inner.adoptedStyleSheets.length, late.shadowRoot!.adoptedStyleSheets.length]).toEqual([...before, 0]);
    expect(m.shadowRoots()).toBe(0);
    CSSStyleSheet.prototype.replaceSync = orig;
  });
});
