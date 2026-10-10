// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { startPopup, siteLabel, type PopupApi } from '../../src/ui/popup/app';
import { COPY } from '../../src/ui/popup/copy';
import { fail, ok } from '../../src/shared/messages';
import { defaultSettings, normalizeSettings, type Settings } from '../../src/shared/settings';
import { buildComfortCss } from '../../src/shared/comfort';
import { buildCalmCss } from '../../src/shared/calm';
import { buildFocusCss } from '../../src/shared/focus';

interface Fake extends PopupApi {
  saved: Settings[];
  applied: Settings[];
  comfort: (string | null)[];
  fonts: string[][];
  calm: (string | null)[];
  focus: (string | null)[];
  showAll: boolean[];
  pauses: boolean[];
  /** What the fake page reports for Focus while it is on (blocks found or not). */
  focusBlocks: number;
}
function fakeApi(over: Partial<PopupApi> = {}, initial: Settings = defaultSettings()): Fake {
  const saved: Settings[] = [];
  const applied: Settings[] = [];
  const comfort: (string | null)[] = [];
  const fonts: string[][] = [];
  const calm: (string | null)[] = [];
  const showAll: boolean[] = [];
  const focus: (string | null)[] = [];
  const pauses: boolean[] = [];
  let focusOn = false;
  let paused = false;
  let calmState = { blurActive: false, motionActive: false, showAll: false, marked: 0 };
  const fake: Fake = {
    saved,
    applied,
    comfort,
    fonts,
    calm,
    focus,
    showAll,
    pauses,
    focusBlocks: 5,
    applySheet: async (_tabId, key, css) => (({ comfort, calm, focus })[key].push(css), ok({ active: css !== null })),
    fontData: async () => ['AAAA', 'BBBB', 'CCCC', 'DDDD'],
    activeTab: async () => ({ id: 1, url: 'https://www.example.com/article' }) as chrome.tabs.Tab,
    ensureRuntime: async () => ok({ injected: true }),
    request: (async (_id: number, type: string, payload: unknown) => {
      if (type === 'APPLY_SETTINGS') {
        const s = payload as Settings;
        applied.push(s);
        if (!s.modes.focus.enabled) paused = false;
        focusOn = s.modes.focus.enabled;
        calmState = { ...calmState, blurActive: s.modes.calm.enabled && s.modes.calm.blurImages, motionActive: s.modes.calm.enabled && s.modes.calm.reduceMotion, showAll: calmState.showAll && s.modes.calm.enabled && s.modes.calm.blurImages };
      }
      if (type === 'COMFORT_FONT') fonts.push((payload as { data: string[] }).data);
      if (type === 'CALM_SHOW_ALL') (showAll.push((payload as { on: boolean }).on), (calmState = { ...calmState, showAll: calmState.blurActive && (payload as { on: boolean }).on }));
      if (type === 'FOCUS_PAUSE' && focusOn) (pauses.push((payload as { paused: boolean }).paused), (paused = (payload as { paused: boolean }).paused));
      const focusState = focusOn ? { status: paused ? 'paused' : fake.focusBlocks ? 'active' : 'empty', blocks: fake.focusBlocks, index: fake.focusBlocks ? 0 : -1 } : undefined;
      return ok({ buildId: 'b1', activeModes: [], calm: calmState, focus: focusState });
    }) as PopupApi['request'],
    loadSettings: async () => structuredClone(initial),
    saveSettings: async (s) => (saved.push(structuredClone(s)), normalizeSettings(s)),
    ...over,
  };
  return fake;
}

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  root = document.createElement('main');
  document.body.append(root);
});
const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const mode = (id: string) => q(`[data-mode="${id}"]`);
const sw = (id: string) => mode(id).querySelector<HTMLButtonElement>('[role="switch"]')!;
const disc = (id: string) => mode(id).querySelector<HTMLButtonElement>('[aria-expanded]')!;
const body = (id: string) => mode(id).querySelector<HTMLElement>('.rs-mode__body')!;

describe('popup: structure and status', () => {
  it('renders the header, site and three modes; no mode is marked as a preview', async () => {
    const h = await startPopup(root, fakeApi());
    expect(h.status.kind).toBe('ready');
    expect(q('h1').textContent).toBe('ReadScore');
    expect(q('.rs-header__site').textContent).toBe('example.com');
    expect(root.textContent).not.toContain('Version');
    expect([...root.querySelectorAll('.rs-mode__name > span:first-child')].map((n) => n.textContent)).toEqual(['Focus', 'Comfort', 'Calm']);
    expect(q('[role="status"]').textContent).toBe('');
    expect(mode('focus').querySelector('.rs-mode__state')!.textContent).toBe(COPY.off);
    expect(root.textContent).not.toMatch(/Preview|does not work yet/);
    expect(root.getAttribute('aria-busy')).toBeNull();
  });

  it.each(['chrome://extensions', 'https://chromewebstore.google.com/detail/x'])('restricted page %s: never injects, switches disabled, explains why', async (url) => {
    let injected = false;
    const h = await startPopup(root, fakeApi({ activeTab: async () => ({ id: 1, url }) as chrome.tabs.Tab, ensureRuntime: async () => ((injected = true), ok({ injected: true })) }));
    expect(h.status.kind).toBe('restricted');
    expect(injected).toBe(false);
    expect(sw('focus').disabled).toBe(true);
    expect(q('[role="status"]').textContent).toContain(COPY.restricted);
    expect(q('.rs-header__site').textContent).toBe(COPY.restrictedSite);
  });

  it('injection failure: error in the alert region with a working retry', async () => {
    let attempts = 0;
    const h = await startPopup(root, fakeApi({ ensureRuntime: async () => (++attempts === 1 ? fail('NOT_INJECTED', 'denied') : ok({ injected: true })) }));
    expect(h.status.kind).toBe('error');
    expect(q('[role="alert"]').textContent).toContain('Reload the page');
    q<HTMLButtonElement>('[role="alert"] button').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.status.kind).toBe('ready');
    expect(q('[role="alert"]').textContent).toBe('');
  });

  it('unexpected exceptions become an error state, not a blank popup', async () => {
    const h = await startPopup(root, fakeApi({ activeTab: async () => { throw new Error('x'); } }));
    expect(h.status.kind).toBe('error');
    expect(root.textContent).toContain('Something went wrong');
  });

  it('never renders HTML from data', async () => {
    await startPopup(root, fakeApi({ activeTab: async () => ({ id: 1, url: 'https://<img src=x onerror=alert(1)>.com/' }) as chrome.tabs.Tab }));
    expect(root.querySelector('img')).toBeNull();
  });

  it('site label strips www. and hides browser pages', () => {
    expect(siteLabel('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
    expect(siteLabel('chrome://settings')).toBe(COPY.restrictedSite);
    expect(siteLabel(undefined)).toBe(COPY.restrictedSite);
  });
});

describe('popup: interaction', () => {
  it('switch toggles the mode, saves (debounced) and sends settings to the page', async () => {
    const api = fakeApi();
    const h = await startPopup(root, api);
    sw('comfort').click();
    expect(sw('comfort').getAttribute('aria-checked')).toBe('true');
    expect(mode('comfort').querySelector('.rs-mode__state')!.textContent).toBe('On');
    await h.flush();
    expect(api.saved.at(-1)!.modes.comfort.enabled).toBe(true);
    expect(api.applied.at(-1)!.modes.comfort.enabled).toBe(true);
  });

  it('only one mode is expanded at a time; switching does not expand', async () => {
    await startPopup(root, fakeApi());
    sw('focus').click();
    expect(body('focus').hidden).toBe(true);
    disc('focus').click();
    expect(disc('focus').getAttribute('aria-expanded')).toBe('true');
    expect(body('focus').hidden).toBe(false);
    disc('calm').click();
    expect(body('focus').hidden).toBe(true);
    expect(body('calm').hidden).toBe(false);
    disc('calm').click();
    expect(body('calm').hidden).toBe(true);
  });

  it('moving a Comfort slider selects Custom; choosing a preset restores its exact values', async () => {
    const h = await startPopup(root, fakeApi());
    disc('comfort').click();
    const range = mode('comfort').querySelector<HTMLInputElement>('input[type="range"]')!;
    range.value = '1.8';
    range.dispatchEvent(new Event('input'));
    expect(h.settings().modes.comfort).toMatchObject({ preset: 'custom', lineHeight: 1.8 });
    expect(mode('comfort').querySelector<HTMLInputElement>('input[value="custom"]')!.checked).toBe(true);
    expect(range.getAttribute('aria-valuetext')).toBe('1.8 times the text size');
    const roomy = mode('comfort').querySelector<HTMLInputElement>('input[value="roomy"]')!;
    roomy.checked = true;
    roomy.dispatchEvent(new Event('change'));
    expect(h.settings().modes.comfort).toMatchObject({ preset: 'roomy', lineHeight: 1.5, letterSpacing: 0.12 });
  });

  it('per setting reset is hidden at the default and restores the default', async () => {
    const h = await startPopup(root, fakeApi());
    const slider = mode('comfort').querySelector('.rs-slider')!;
    const reset = slider.querySelector<HTMLButtonElement>('button')!;
    expect(reset.getAttribute('data-visible')).toBe('false');
    const range = slider.querySelector<HTMLInputElement>('input')!;
    range.value = '2';
    range.dispatchEvent(new Event('input'));
    expect(reset.getAttribute('data-visible')).toBe('true');
    expect(reset.getAttribute('aria-label')).toBe('Reset Line Height');
    reset.click();
    expect(h.settings().modes.comfort.lineHeight).toBe(1.6); // Relaxed
  });

  it('Calm: blur options appear only with Blur images; Show all images is unavailable while Calm is off', async () => {
    const h = await startPopup(root, fakeApi());
    const group = mode('calm').querySelector<HTMLElement>('.rs-group')!;
    expect(group.hidden).toBe(true);
    const blur = [...mode('calm').querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][1]!;
    blur.click();
    expect(h.settings().modes.calm.blurImages).toBe(true);
    expect(group.hidden).toBe(false);
    expect(group.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  });

  it('Focus: no Dim control (removed); shortcuts only for Keyboard', async () => {
    const h = await startPopup(root, fakeApi());
    expect(mode('focus').querySelector('input[type="checkbox"]')).toBeNull();
    const scroll = mode('focus').querySelector<HTMLInputElement>('input[value="scroll"]')!;
    scroll.checked = true;
    scroll.dispatchEvent(new Event('change'));
    expect(h.settings().modes.focus.interaction).toBe('scroll');
    expect(mode('focus').querySelector<HTMLElement>('.rs-keys')!.parentElement!.hidden).toBe(true);
  });

  it('theme: manual choice sets data-theme; System removes it', async () => {
    const h = await startPopup(root, fakeApi());
    q<HTMLButtonElement>(`.rs-header [aria-label="${COPY.moreLabel}"]`).click();
    expect(q('.rs-menu').hidden).toBe(false);
    const dark = q<HTMLInputElement>('.rs-menu input[value="dark"]');
    dark.checked = true;
    dark.dispatchEvent(new Event('change'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(h.settings().ui.theme).toBe('dark');
    const system = q<HTMLInputElement>('.rs-menu input[value="system"]');
    system.checked = true;
    system.dispatchEvent(new Event('change'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('Reset all settings offers Undo, which restores the previous settings', async () => {
    const initial = defaultSettings();
    initial.modes.focus.enabled = true;
    initial.modes.calm.blurImages = true;
    const h = await startPopup(root, fakeApi({}, initial));
    q<HTMLButtonElement>(`.rs-header [aria-label="${COPY.menu.resetAll}"]`).click();
    expect(h.settings().modes.focus.enabled).toBe(false);
    await h.flush();
    const undo = q<HTMLButtonElement>('[role="status"] .rs-message--success button');
    undo.click();
    expect(h.settings().modes.focus.enabled).toBe(true);
    expect(h.settings().modes.calm.blurImages).toBe(true);
  });

  it('a failed save is reported in the alert region', async () => {
    const h = await startPopup(root, fakeApi({ saveSettings: async () => { throw new Error('quota'); } }));
    sw('focus').click();
    await h.flush();
    expect(q('[role="alert"]').textContent).toContain(COPY.errors.SAVE);
  });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('popup: Comfort on the page', () => {
  it('opening the popup applies the saved Comfort state to the page (null when off)', async () => {
    const api = fakeApi();
    await startPopup(root, api);
    await tick();
    expect(api.comfort).toEqual([null]);
  });

  it('saved Comfort on: applied on open with the exact sheet; state reads On', async () => {
    const initial = defaultSettings();
    initial.modes.comfort.enabled = true;
    const api = fakeApi({}, initial);
    const h = await startPopup(root, api);
    await tick();
    expect(api.comfort).toEqual([buildComfortCss(initial.modes.comfort)]);
    expect(h.comfortActive()).toBe(true);
    expect(mode('comfort').querySelector('.rs-mode__state')!.textContent).toBe('On');
  });

  it('every Comfort change sends the new sheet immediately; unrelated changes send nothing', async () => {
    const api = fakeApi();
    const h = await startPopup(root, api);
    sw('comfort').click();
    const roomy = mode('comfort').querySelector<HTMLInputElement>('input[value="roomy"]')!;
    roomy.checked = true;
    roomy.dispatchEvent(new Event('change'));
    const serif = mode('comfort').querySelector<HTMLSelectElement>('select')!;
    serif.value = 'serif';
    serif.dispatchEvent(new Event('change'));
    const before = api.comfort.length;
    sw('focus').click(); // not Comfort
    q<HTMLButtonElement>(`.rs-header [aria-label="${COPY.moreLabel}"]`).click();
    const dark = q<HTMLInputElement>('.rs-menu input[value="dark"]');
    dark.checked = true;
    dark.dispatchEvent(new Event('change'));
    expect(api.comfort.length).toBe(before);
    expect(api.comfort.at(-1)).toBe(buildComfortCss(h.settings().modes.comfort));
    expect(api.comfort.at(-1)).toContain('line-height: 1.5 !important');
    expect(api.comfort.at(-1)).toContain('Georgia');
    sw('comfort').click();
    expect(api.comfort.at(-1)).toBeNull();
  });

  it('Comfort order: Text size, Font, Spacing, Adjust spacing; short labels; Atkinson sends the bundled font to the page once', async () => {
    const api = fakeApi();
    const h = await startPopup(root, api);
    const body = mode('comfort').querySelector('.rs-mode__body')!;
    const labels = [...body.querySelectorAll('legend, label.rs-field__label, .rs-advanced__summary > span:first-child')].map((e) => e.textContent);
    expect(labels.slice(0, 4)).toEqual([COPY.comfort.minSize, COPY.comfort.font, COPY.comfort.spacing, COPY.comfort.advanced]);
    expect([...body.querySelectorAll('fieldset')].map((f) => [...f.querySelectorAll('input')].map((i) => i.value))).toEqual([['off', '18', '20', '22'], ['site', 'relaxed', 'roomy', 'custom']]);
    sw('comfort').click();
    const font = body.querySelector<HTMLSelectElement>('select')!;
    expect([...font.options].map((o) => o.textContent)).toEqual(['Site Default', 'Sans Serif', 'Serif', 'Atkinson Hyperlegible']);
    font.value = 'atkinson';
    font.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fonts).toEqual([['AAAA', 'BBBB', 'CCCC', 'DDDD']]);
    expect(api.comfort.at(-1)).toContain("'ReadScore Atkinson Hyperlegible'");
    const size = body.querySelector<HTMLInputElement>('input[value="22"]')!;
    size.checked = true;
    size.dispatchEvent(new Event('change'));
    font.value = 'site';
    font.dispatchEvent(new Event('change'));
    font.value = 'atkinson';
    font.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fonts).toHaveLength(1); // once per popup session; the page keeps the bytes
    font.value = 'site';
    font.dispatchEvent(new Event('change'));
    expect(api.comfort.at(-1)).not.toContain('Atkinson');
    expect(h.settings().modes.comfort).toMatchObject({ font: 'site', minSize: '22', preset: 'relaxed' });
  });

  it('a failed apply shows Not applied and an error with a retry that re-sends', async () => {
    const initial = defaultSettings();
    initial.modes.comfort.enabled = true;
    let fails = true;
    const api = fakeApi({ applySheet: async (_t, key, css) => (key === 'comfort' && fails ? fail('NOT_INJECTED', 'gone') : ok({ active: css !== null })) }, initial);
    const h = await startPopup(root, api);
    await tick();
    expect(h.comfortActive()).toBe(false);
    expect(mode('comfort').querySelector('.rs-mode__state')!.textContent).toBe(COPY.notApplied);
    expect(q('[role="alert"]').textContent).toContain(COPY.errors.COMFORT);
    fails = false;
    q<HTMLButtonElement>('[role="alert"] button').click();
    await tick();
    expect(h.comfortActive()).toBe(true);
    expect(mode('comfort').querySelector('.rs-mode__state')!.textContent).toBe('On');
    expect(q('[role="alert"]').textContent).toBe('');
  });

  it('only the newest request decides the state (out of order answers are ignored)', async () => {
    const resolvers: ((r: ReturnType<typeof ok<{ active: boolean }>>) => void)[] = [];
    const api = fakeApi({ applySheet: (_t, key) => (key === 'comfort' ? new Promise((r) => resolvers.push(r)) : Promise.resolve(ok({ active: false }))) });
    const h = await startPopup(root, api);
    sw('comfort').click(); // request 2 (1 was the open sync)
    resolvers[1]!(ok({ active: true }));
    await tick();
    resolvers[0]!(ok({ active: false }));
    await tick();
    expect(h.comfortActive()).toBe(true);
  });

  it('restricted pages never send Comfort requests', async () => {
    const api = fakeApi({ activeTab: async () => ({ id: 1, url: 'chrome://settings' }) as chrome.tabs.Tab });
    await startPopup(root, api);
    await tick();
    expect(api.comfort).toEqual([]);
  });

  it('Reset all removes an active Comfort sheet from the page', async () => {
    const initial = defaultSettings();
    initial.modes.comfort.enabled = true;
    const api = fakeApi({}, initial);
    await startPopup(root, api);
    q<HTMLButtonElement>(`.rs-header [aria-label="${COPY.menu.resetAll}"]`).click();
    expect(api.comfort.at(-1)).toBeNull();
  });

  it('Reset Comfort keeps Comfort on and applies the default sheet', async () => {
    const initial = defaultSettings();
    initial.modes.comfort = { ...initial.modes.comfort, enabled: true, preset: 'roomy', font: 'serif', minSize: '20', lineHeight: 1.8, letterSpacing: 0.16, wordSpacing: 0.24, paragraphSpacing: 2.5 };
    const api = fakeApi({}, initial);
    const h = await startPopup(root, api);
    mode('comfort').querySelector<HTMLButtonElement>(`[aria-label="${COPY.comfort.resetAll}"]`)!.click();
    expect(h.settings().modes.comfort).toEqual({ ...defaultSettings().modes.comfort, enabled: true });
    expect(api.comfort.at(-1)).toBe(buildComfortCss({ ...defaultSettings().modes.comfort, enabled: true }));
  });
});

describe('popup: Calm on the page', () => {
  const calmOn = () => {
    const s = defaultSettings();
    s.modes.calm.enabled = true;
    return s;
  };

  it('Calm on: the Calm sheet (motion) is applied on open; Comfort sheet stays null', async () => {
    const api = fakeApi({}, calmOn());
    const h = await startPopup(root, api);
    await tick();
    expect(api.calm).toEqual([buildCalmCss(calmOn().modes.calm)]);
    expect(api.comfort).toEqual([null]);
    expect(h.calmActive()).toBe(true);
    expect(mode('calm').querySelector('.rs-mode__state')!.textContent).toBe('On');
  });

  it('Reduce motion and Blur images are independent; strength changes only the blur rule', async () => {
    const api = fakeApi({}, calmOn());
    const h = await startPopup(root, api);
    const boxes = [...mode('calm').querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    boxes[1]!.click(); // blur on
    expect(api.calm.at(-1)).toContain('animation-duration');
    expect(api.calm.at(-1)).toContain('blur(6px)');
    boxes[0]!.click(); // motion off
    expect(api.calm.at(-1)).not.toContain('animation-duration');
    expect(api.calm.at(-1)).toContain('blur(6px)');
    const strong = mode('calm').querySelector<HTMLInputElement>('input[value="strong"]')!;
    strong.checked = true;
    strong.dispatchEvent(new Event('change'));
    expect(api.calm.at(-1)).toContain('blur(16px)');
    expect(h.settings().modes.calm).toMatchObject({ reduceMotion: false, blurImages: true, blurStrength: 'strong' });
  });

  it('Show all images toggles a temporary page state and becomes Blur again; it is never saved', async () => {
    const s = calmOn();
    s.modes.calm.blurImages = true;
    const api = fakeApi({}, s);
    await startPopup(root, api);
    await tick();
    const btn = mode('calm').querySelector<HTMLButtonElement>('.rs-group button')!;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe(COPY.calm.showAll);
    btn.click();
    await tick();
    expect(api.showAll).toEqual([true]);
    expect(btn.textContent).toBe(COPY.calm.blurAgain);
    btn.click();
    await tick();
    expect(api.showAll).toEqual([true, false]);
    expect(btn.textContent).toBe(COPY.calm.showAll);
    expect(JSON.stringify(api.saved)).not.toContain('showAll');
  });

  it('turning Calm off removes the Calm sheet and leaves Comfort alone', async () => {
    const s = calmOn();
    s.modes.comfort.enabled = true;
    const api = fakeApi({}, s);
    await startPopup(root, api);
    const comfortBefore = api.comfort.length;
    sw('calm').click();
    expect(api.calm.at(-1)).toBeNull();
    expect(api.comfort.length).toBe(comfortBefore);
  });

  it('a failed Calm apply shows Not applied and its own error; Comfort is unaffected', async () => {
    const api = fakeApi({ applySheet: async (_t, key, css) => (key === 'calm' ? fail('NOT_INJECTED', 'x') : ok({ active: css !== null })) }, calmOn());
    await startPopup(root, api);
    await tick();
    expect(mode('calm').querySelector('.rs-mode__state')!.textContent).toBe(COPY.notApplied);
    expect(q('[role="alert"]').textContent).toBe(COPY.errors.CALM + COPY.retry);
  });
});

describe('popup: Focus on the page', () => {
  const focusOn = (interaction: 'keyboard' | 'scroll' = 'keyboard') => {
    const s = defaultSettings();
    s.modes.focus = { enabled: true, interaction, color: 'yellow' };
    return s;
  };
  const word = () => mode('focus').querySelector('.rs-mode__state')!.textContent;
  const pauseBtn = () => mode('focus').querySelector<HTMLButtonElement>('.rs-mode__body > button')!;

  it('highlight colour: four short options, Yellow by default, a change is saved and sent to the page', async () => {
    const api = fakeApi({}, focusOn());
    const h = await startPopup(root, api);
    const inputs = [...mode('focus').querySelectorAll<HTMLInputElement>('fieldset input')].filter((i) => ['yellow', 'blue', 'green', 'dark'].includes(i.value));
    expect(inputs.map((i) => i.value)).toEqual(['yellow', 'blue', 'green', 'dark']);
    expect(inputs[0]!.checked).toBe(true);
    inputs[1]!.checked = true;
    inputs[1]!.dispatchEvent(new Event('change'));
    expect(h.settings().modes.focus.color).toBe('blue');
    await h.flush();
    expect(api.applied.at(-1)!.modes.focus.color).toBe('blue');
  });

  it('Focus on: the AUTHOR paint sheet is applied, the page reports a highlight, the popup says On', async () => {
    const api = fakeApi({}, focusOn());
    const h = await startPopup(root, api);
    await tick();
    expect(api.focus).toEqual([buildFocusCss(focusOn().modes.focus)]);
    expect(h.focusActive()).toBe(true);
    expect(word()).toBe(COPY.on);
    expect(mode('focus').classList.contains('rs-mode--on')).toBe(true);
    expect(pauseBtn().disabled).toBe(false);
    expect(pauseBtn().textContent).toBe(COPY.focus.pause);
  });

  it('Focus off: no sheet, state Off, Pause disabled', async () => {
    const api = fakeApi();
    await startPopup(root, api);
    await tick();
    expect(api.focus).toEqual([null]);
    expect(word()).toBe(COPY.off);
    expect(pauseBtn().disabled).toBe(true);
  });

  it('Pause and Resume are a temporary page state: Paused is not Off, and it is never saved', async () => {
    const api = fakeApi({}, focusOn());
    const h = await startPopup(root, api);
    await tick();
    pauseBtn().click();
    await tick();
    expect(api.pauses).toEqual([true]);
    expect(word()).toBe(COPY.focus.paused);
    expect(pauseBtn().textContent).toBe(COPY.focus.resume);
    expect(mode('focus').classList.contains('rs-mode--on')).toBe(false);
    expect(h.settings().modes.focus.enabled).toBe(true);
    expect(sw('focus').getAttribute('aria-checked')).toBe('true');
    pauseBtn().click();
    await tick();
    expect(api.pauses).toEqual([true, false]);
    expect(word()).toBe(COPY.on);
    expect(JSON.stringify(api.saved)).not.toMatch(/pause/i);
  });

  it('no readable text: says No text, a short status message, no Pause; never claims On', async () => {
    const api = fakeApi({}, focusOn());
    api.focusBlocks = 0;
    await startPopup(root, api);
    await tick();
    expect(word()).toBe(COPY.focus.noText);
    expect(q('[role="status"]').textContent).toBe(COPY.focus.empty);
    expect(pauseBtn().disabled).toBe(true);
    expect(mode('focus').classList.contains('rs-mode--on')).toBe(false);
  });

  it('a failed Focus sheet shows Not applied with its own error and retry; Comfort and Calm unaffected', async () => {
    const api = fakeApi({ applySheet: async (_t, key, css) => (key === 'focus' ? fail('NOT_INJECTED', 'x') : ok({ active: css !== null })) }, focusOn());
    await startPopup(root, api);
    await tick();
    expect(word()).toBe(COPY.notApplied);
    expect(q('[role="alert"]').textContent).toBe(COPY.errors.FOCUS + COPY.retry);
    expect(mode('comfort').querySelector('.rs-mode__state')!.textContent).toBe(COPY.off);
  });

  it('a page without the Highlight API: Not applied with a short reason and no retry', async () => {
    const api = fakeApi({}, focusOn());
    const base = api.request;
    api.request = (async (id: number, type: never, payload: never) => {
      const r = (await base(id, type, payload)) as { ok: true; data: { focus?: { status: string } } };
      if (r.data.focus) r.data.focus.status = 'unsupported';
      return r;
    }) as typeof api.request;
    await startPopup(root, api);
    await tick();
    expect(word()).toBe(COPY.notApplied);
    expect(q('[role="alert"]').textContent).toBe(COPY.errors.FOCUS_UNSUPPORTED);
  });

  it('Keyboard / Follow scroll is saved and sent at once; shortcuts show only for Keyboard', async () => {
    const api = fakeApi({}, focusOn());
    const h = await startPopup(root, api);
    const scroll = mode('focus').querySelector<HTMLInputElement>('input[value="scroll"]')!;
    scroll.checked = true;
    scroll.dispatchEvent(new Event('change'));
    expect(h.settings().modes.focus.interaction).toBe('scroll');
    expect(api.applied.at(-1)!.modes.focus.interaction).toBe('scroll');
    await h.flush();
    expect(api.saved.at(-1)!.modes.focus.interaction).toBe('scroll');
    expect(mode('focus').querySelector<HTMLElement>('.rs-keys')!.closest<HTMLElement>('.rs-field')!.hidden).toBe(true);
    expect(api.focus.length).toBe(1); // the paint sheet does not depend on the interaction
  });

  it('turning Focus off removes only the Focus sheet; Reset all turns all three modes off', async () => {
    const s = focusOn();
    s.modes.comfort.enabled = true;
    s.modes.calm.enabled = true;
    const api = fakeApi({}, s);
    await startPopup(root, api);
    await tick();
    const [c, k] = [api.comfort.length, api.calm.length];
    sw('focus').click();
    expect(api.focus.at(-1)).toBeNull();
    expect([api.comfort.length, api.calm.length]).toEqual([c, k]);
    sw('focus').click();
    q<HTMLButtonElement>(`.rs-header [aria-label="${COPY.menu.resetAll}"]`).click();
    expect([api.focus.at(-1), api.comfort.at(-1), api.calm.at(-1)]).toEqual([null, null, null]);
    expect(api.applied.at(-1)!.modes).toMatchObject({ focus: { enabled: false }, comfort: { enabled: false }, calm: { enabled: false } });
  });

  it('Dim other text is not offered (not reliable enough; see the Phase 5 report)', async () => {
    await startPopup(root, fakeApi());
    expect(mode('focus').textContent).not.toContain('Dim');
  });
});

describe('popup: reset actions', () => {
  it('section resets are icon buttons: Reset all beside the menu, Reset Comfort in the Custom spacing row', async () => {
    await startPopup(root, fakeApi());
    const all = q(`.rs-header [aria-label="${COPY.menu.resetAll}"]`);
    expect(all.nextElementSibling!.getAttribute('aria-label')).toBe(COPY.moreLabel);
    const comfort = mode('comfort').querySelector(`.rs-advanced__summary [aria-label="${COPY.comfort.resetAll}"]`)!;
    for (const b of [all, comfort]) {
      expect(b.matches('button.rs-icon-button')).toBe(true);
      expect(b.querySelector('svg')).not.toBeNull();
    }
    const details = comfort.closest('details')!;
    (comfort as HTMLButtonElement).click();
    expect(details.open).toBe(false); // the reset does not toggle the row
  });
});

describe('popup: accessibility wiring', () => {
  it('every interactive control has an accessible name', async () => {
    await startPopup(root, fakeApi());
    for (const c of root.querySelectorAll<HTMLElement>('button, input, select, summary')) {
      const labelled = c.getAttribute('aria-labelledby');
      const name =
        c.getAttribute('aria-label') ??
        (labelled ? document.getElementById(labelled)?.textContent : null) ??
        (c.id ? root.querySelector(`label[for="${c.id}"]`)?.textContent : null) ??
        c.closest('label')?.textContent ??
        c.textContent;
      expect(name?.trim(), c.outerHTML.slice(0, 80)).toBeTruthy();
    }
  });

  it('switches are labelled by the mode name and described by its description', async () => {
    await startPopup(root, fakeApi());
    const s = sw('calm');
    expect(document.getElementById(s.getAttribute('aria-labelledby')!)!.textContent).toBe('Calm');
    expect(document.getElementById(s.getAttribute('aria-describedby')!)!.textContent).toBe(COPY.calm.description);
  });

  it('ids are unique', async () => {
    await startPopup(root, fakeApi());
    const ids = [...root.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
