// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLUR_PX, CALM_MARK, CALM_REVEAL, CALM_SHOW_ALL, MOTION_CSS, buildCalmCss, buildCalmShadowCss } from '../../src/shared/calm';
import { createCalmMode } from '../../src/content/calm';
import { createImageBlur, select } from '../../src/content/calm/images';
import { GESTURE_WINDOW_MS, createVideoGuard } from '../../src/content/calm/video';
import { defaultSettings, type CalmSettings } from '../../src/shared/settings';

const calm = (over: Partial<CalmSettings> = {}): CalmSettings => ({ ...defaultSettings().modes.calm, enabled: true, ...over });

// happy-dom has no layout: give elements a size through data-w / data-h.
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const w = Number(this.getAttribute('data-w') ?? 0);
    const h = Number(this.getAttribute('data-h') ?? 0);
    const x = Number(this.getAttribute('data-x') ?? 0);
    const y = Number(this.getAttribute('data-y') ?? 0);
    return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) } as DOMRect;
  });
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(CALM_SHOW_ALL);
});
afterEach(() => vi.restoreAllMocks());

describe('Calm CSS', () => {
  it('off, or on with nothing selected → null', () => {
    expect(buildCalmCss(defaultSettings().modes.calm)).toBeNull();
    expect(buildCalmCss(calm({ reduceMotion: false, blurImages: false }))).toBeNull();
  });

  it('Reduce motion uses the validated finish rule (never paused or transition none)', () => {
    const css = buildCalmCss(calm())!;
    expect(css).toContain(MOTION_CSS);
    expect(css).toContain('animation-duration: 0.01ms !important');
    expect(css).toContain('transition-duration: 0.01ms !important');
    expect(css).toContain('scroll-behavior: auto !important');
    expect(css).not.toMatch(/play-state|transition:\s*none/);
    expect(css).not.toContain('filter');
  });

  it.each(['light', 'strong'] as const)('Blur %s uses %s px, clipped to the box, with reveal and Show all exemptions', (strength) => {
    const css = buildCalmCss(calm({ reduceMotion: false, blurImages: true, blurStrength: strength }))!;
    expect(css).toContain(`filter: blur(${BLUR_PX[strength]}px) !important; clip-path: inset(0) !important;`);
    expect(css).toContain(`:root:not([${CALM_SHOW_ALL}]) [${CALM_MARK}]:not([${CALM_REVEAL}], :focus-visible, :is(a, button, [role="button"]):focus-visible *)`);
    expect(css).not.toContain('animation');
  });

  it('light and strong differ (6 vs 16 px)', () => expect([BLUR_PX.light, BLUR_PX.strong]).toEqual([6, 16]));

  it('shadow sheet: motion + blur; Show all drops only the blur rule', () => {
    const c = calm({ blurImages: true });
    expect(buildCalmShadowCss(c, false)).toContain('blur(6px)');
    expect(buildCalmShadowCss(c, false)).toContain('animation-duration');
    expect(buildCalmShadowCss(c, true)).not.toContain('blur(');
    expect(buildCalmShadowCss(c, true)).toContain('animation-duration');
    expect(buildCalmShadowCss(defaultSettings().modes.calm, false)).toBe('');
  });
});

describe('image selection', () => {
  const make = (html: string) => ((document.body.innerHTML = html), document.body.firstElementChild!);
  it.each([
    ['<img data-w="480" data-h="270">', 'img'],
    ['<svg data-w="400" data-h="200"></svg>', 'svg'],
    ['<video data-w="320" data-h="180"></video>', 'video'],
    ['<canvas data-w="300" data-h="150"></canvas>', 'canvas'],
  ])('large %s is selected', (html, kind) => expect(select(make(html))).toBe(kind));

  it.each([
    ['icon (short side < 48)', '<img data-w="200" data-h="40">'],
    ['small area', '<img data-w="90" data-h="90">'],
    ['not rendered', '<img data-w="0" data-h="0">'],
  ])('%s is not selected', (_n, html) => expect(select(make(html))).toBeNull());

  it('photo thumbnails in clickable tiles are selected; svg in a button and visuals in labels, tabs and menus are not', () => {
    document.body.innerHTML = `
      <div role="button" tabindex="0"><g-img><img id="tile" data-w="430" data-h="430"></g-img><span>19:51</span></div>
      <button><img id="thumb" data-w="300" data-h="200"></button>
      <button><svg id="glyph" data-w="120" data-h="120"></svg></button>
      <div role="tab"><img id="tab" data-w="200" data-h="200"></div>
      <div role="menuitem"><img id="menu" data-w="200" data-h="200"></div>`;
    expect(select(document.getElementById('tile')!)).toBe('img');
    expect(select(document.getElementById('thumb')!)).toBe('img');
    for (const id of ['glyph', 'tab', 'menu']) expect(select(document.getElementById(id)!), id).toBeNull();
  });

  it('images inside controls are not selected', () => {
    document.body.innerHTML = '<button><img id="i" data-w="64" data-h="64" width="200" height="200"></button><label><img id="j" data-w="200" data-h="200"></label>';
    expect(select(document.getElementById('i')!)).toBeNull();
    expect(select(document.getElementById('j')!)).toBeNull();
  });

  it('nested svg parts are never selected on their own', () => {
    document.body.innerHTML = '<svg data-w="400" data-h="200"><svg id="inner" data-w="300" data-h="150"></svg></svg>';
    expect(select(document.getElementById('inner')!)).toBeNull();
  });
});

describe('image blur lifecycle', () => {
  it('marks large visuals only, reveals on pointer, Show all toggles the root attribute, disable leaves nothing', async () => {
    document.body.innerHTML = '<main><img id="photo" data-w="400" data-h="300" data-x="0" data-y="0"><img id="icon" data-w="16" data-h="16"><p>Text</p></main>';
    const before = document.documentElement.outerHTML;
    const ib = createImageBlur(document);
    ib.enable(calm({ blurImages: true }));
    expect(document.getElementById('photo')!.getAttribute(CALM_MARK)).toBe('img');
    expect(document.getElementById('icon')!.hasAttribute(CALM_MARK)).toBe(false);

    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 10, clientY: 10 }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById('photo')!.hasAttribute(CALM_REVEAL)).toBe(true);
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 900, clientY: 900 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(document.getElementById('photo')!.hasAttribute(CALM_REVEAL)).toBe(false);

    ib.setShowAll(true);
    expect(document.documentElement.hasAttribute(CALM_SHOW_ALL)).toBe(true);
    ib.setShowAll(false);
    expect(document.documentElement.hasAttribute(CALM_SHOW_ALL)).toBe(false);

    ib.setShowAll(true);
    ib.disable();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it('images added later are marked by the batched observer (added subtrees only)', async () => {
    document.body.innerHTML = '<main id="m"></main>';
    const ib = createImageBlur(document);
    ib.enable(calm({ blurImages: true }));
    const img = document.createElement('img');
    img.setAttribute('data-w', '320');
    img.setAttribute('data-h', '180');
    document.getElementById('m')!.append(img);
    await new Promise((r) => setTimeout(r, 0)); // let the MutationObserver deliver
    ib.flushNow();
    expect(img.getAttribute(CALM_MARK)).toBe('img');
    expect(ib.stats().observerBatches).toBeGreaterThan(0);
    ib.disable();
    expect(img.hasAttribute(CALM_MARK)).toBe(false);
  });

  it('open shadow roots (also nested and added later) get an adopted sheet; disable removes every one', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const sr = document.getElementById('host')!.attachShadow({ mode: 'open' });
    sr.innerHTML = '<img id="s" data-w="300" data-h="200"><div id="inner"></div>';
    const nested = sr.getElementById('inner')!.attachShadow({ mode: 'open' });
    nested.innerHTML = '<img id="n" data-w="300" data-h="200">';
    const ib = createImageBlur(document);
    ib.enable(calm({ blurImages: true }));
    expect(sr.adoptedStyleSheets.length).toBe(1);
    expect(nested.adoptedStyleSheets.length).toBe(1);
    expect(sr.getElementById('s')!.getAttribute(CALM_MARK)).toBe('img');
    expect(nested.getElementById('n')!.getAttribute(CALM_MARK)).toBe('img');

    const late = document.createElement('div');
    document.body.append(late);
    const lateRoot = late.attachShadow({ mode: 'open' });
    lateRoot.innerHTML = '<img id="l" data-w="300" data-h="200">';
    await new Promise((r) => setTimeout(r, 0));
    ib.flushNow();
    expect(lateRoot.adoptedStyleSheets.length).toBe(1);

    ib.disable();
    for (const r of [sr, nested, lateRoot]) expect(r.adoptedStyleSheets.length).toBe(0);
    expect(sr.getElementById('s')!.hasAttribute(CALM_MARK)).toBe(false);
  });

  it('Calm on with motion only, then Blur on: shadow root images get marked too', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const sr = document.getElementById('host')!.attachShadow({ mode: 'open' });
    sr.innerHTML = '<img id="s" data-w="300" data-h="200">';
    const ib = createImageBlur(document);
    ib.enable(calm({ blurImages: false }));
    expect(sr.getElementById('s')!.hasAttribute(CALM_MARK)).toBe(false);
    ib.update(calm({ blurImages: true }));
    expect(sr.getElementById('s')!.getAttribute(CALM_MARK)).toBe('img');
    ib.disable();
  });

  it('turning Blur images off unmarks but keeps the shadow sheets (they still carry Reduce motion)', () => {
    document.body.innerHTML = '<div id="host"></div><img id="p" data-w="300" data-h="200">';
    const sr = document.getElementById('host')!.attachShadow({ mode: 'open' });
    const ib = createImageBlur(document);
    ib.enable(calm({ blurImages: true }));
    ib.update(calm({ blurImages: false }));
    expect(document.getElementById('p')!.hasAttribute(CALM_MARK)).toBe(false);
    expect(sr.adoptedStyleSheets.length).toBe(1);
    ib.update(calm({ blurImages: true }));
    expect(document.getElementById('p')!.getAttribute(CALM_MARK)).toBe('img');
    ib.disable();
  });
});

describe('background video guard', () => {
  const vid = (muted: boolean, playing: boolean) => {
    const v = document.createElement('video');
    v.muted = muted;
    Object.defineProperty(v, 'paused', { configurable: true, get: () => !playing });
    v.pause = vi.fn(() => void (playing = false));
    document.body.append(v);
    return v;
  };
  const play = (v: HTMLMediaElement) => v.dispatchEvent(new Event('play'));
  const trusted = (type: string) => {
    const e = new Event(type);
    Object.defineProperty(e, 'isTrusted', { value: true });
    window.dispatchEvent(e);
  };

  it('pauses muted media already playing; never touches media with sound', () => {
    const muted = vid(true, true);
    const loud = vid(false, true);
    const g = createVideoGuard(document);
    g.enable();
    expect(muted.pause).toHaveBeenCalled();
    expect(loud.pause).not.toHaveBeenCalled();
    g.disable();
  });

  it('script play without a recent gesture is paused; play within the gesture window is allowed and remembered', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const v = vid(true, false);
    const g = createVideoGuard(document);
    g.enable();
    play(v);
    expect(v.pause).toHaveBeenCalledTimes(1);
    trusted('pointerdown');
    play(v); // user started it
    expect(v.pause).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(GESTURE_WINDOW_MS * 5);
    play(v); // later replay (rebuffer, loop): the user chose this video
    expect(v.pause).toHaveBeenCalledTimes(1);
    expect(g.stats()).toMatchObject({ allowed: 1, pausedLater: 1 });
    g.disable();
    vi.useRealTimers();
  });

  it('keyboard counts as a gesture (custom players driven by keys)', () => {
    const v = vid(true, false);
    const g = createVideoGuard(document);
    g.enable();
    trusted('keydown');
    play(v);
    expect(v.pause).not.toHaveBeenCalled();
    g.disable();
  });

  it('untrusted (synthetic) gestures do not count', () => {
    const v = vid(true, false);
    const g = createVideoGuard(document);
    g.enable();
    window.dispatchEvent(new Event('pointerdown'));
    play(v);
    expect(v.pause).toHaveBeenCalled();
    g.disable();
  });

  it('disable removes every listener and stops guarding', () => {
    const v = vid(true, false);
    const g = createVideoGuard(document);
    g.enable();
    expect(g.listeners).toBe(1);
    g.disable();
    expect(g.listeners).toBe(0);
    play(v);
    expect(v.pause).not.toHaveBeenCalled();
  });
});

describe('Calm mode (lifecycle, independence, cleanup)', () => {
  it('parts are independent and disable restores the DOM exactly', () => {
    document.body.innerHTML = '<img id="p" data-w="300" data-h="200"><video id="v" muted></video>';
    const before = document.documentElement.outerHTML;
    const m = createCalmMode(document);
    m.enable(calm({ reduceMotion: true, blurImages: true }));
    expect(m.state()).toMatchObject({ blurActive: true, motionActive: true });
    m.update(calm({ reduceMotion: false, blurImages: true }));
    expect(m.state()).toMatchObject({ blurActive: true, motionActive: false });
    expect(document.getElementById('p')!.hasAttribute(CALM_MARK)).toBe(true);
    m.update(calm({ reduceMotion: true, blurImages: false }));
    expect(m.state()).toMatchObject({ blurActive: false, motionActive: true });
    expect(document.getElementById('p')!.hasAttribute(CALM_MARK)).toBe(false);
    m.update(calm({ reduceMotion: true, blurImages: true }));
    m.setShowAll(true);
    expect(m.state().showAll).toBe(true);
    m.update(calm({ reduceMotion: true, blurImages: true, blurStrength: 'strong' }));
    expect(m.state().showAll).toBe(true); // strength does not reset Show all
    m.disable();
    expect(m.state()).toMatchObject({ blurActive: false, motionActive: false, showAll: false });
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it('20 enable/disable cycles leave no marks, attributes or sheets behind', () => {
    document.body.innerHTML = '<div id="host"></div><img data-w="300" data-h="200">';
    const sr = document.getElementById('host')!.attachShadow({ mode: 'open' });
    const before = document.documentElement.outerHTML;
    const m = createCalmMode(document);
    for (let i = 0; i < 20; i++) {
      m.enable(calm({ blurImages: true }));
      m.disable();
    }
    expect(document.documentElement.outerHTML).toBe(before);
    expect(sr.adoptedStyleSheets.length).toBe(0);
  });
});
