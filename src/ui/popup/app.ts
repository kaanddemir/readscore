/**
 * ReadScore 2.0 popup (Paper). Built once, then updated in place so keyboard focus is never lost.
 * Chrome wiring lives in client.ts; this module is tested with a fake PopupApi.
 */
import { buildCalmCss } from '../../shared/calm';
import { buildComfortCss } from '../../shared/comfort';
import { buildFocusCss } from '../../shared/focus';
import { isRestrictedUrl } from '../../shared/constants';
import type { RequestMap, RequestType, Response, RsError, RuntimeState, SheetKey } from '../../shared/messages';
import {
  COMFORT_FONTS,
  COMFORT_MIN_SIZES,
  COMFORT_PRESETS,
  COMFORT_PRESET_VALUES,
  presetValues,
  COMFORT_RANGES,
  COMFORT_SPACING_KEYS,
  defaultSettings,
  FOCUS_COLORS,
  normalizeSettings,
  type ComfortSpacingKey,
  type ModeId,
  type Settings,
  type Theme,
} from '../../shared/settings';
import { button, checkboxRow, disclosureButton, disclosureRowWithAction, help, iconButton, message, nextId, segmented, selectField, slider, switchControl } from '../shared/components';
import { el, mount } from '../shared/el';
import { COPY } from './copy';

export interface PopupApi {
  activeTab(): Promise<chrome.tabs.Tab | null>;
  /** Makes sure the current build's runtime is running in the tab (injects it if needed). */
  ensureRuntime(tabId: number): Promise<Response<{ injected: boolean }>>;
  request<T extends RequestType>(tabId: number, type: T, payload: RequestMap[T]['payload']): Promise<Response<RequestMap[T]['data']>>;
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  /** Makes `css` the tab's `key` sheet (null removes it), via the service worker. */
  applySheet(tabId: number, key: SheetKey, css: string | null): Promise<Response<{ active: boolean }>>;
  /** The bundled font files as base64 (read from the extension package). */
  fontData(): Promise<string[]>;
}

export type PopupStatus =
  | { kind: 'loading' }
  | { kind: 'restricted' }
  | { kind: 'ready'; buildId: string; tabId: number; state?: RuntimeState }
  | { kind: 'error'; error: RsError };

export function statusText(status: PopupStatus): string {
  switch (status.kind) {
    case 'loading':
      return COPY.connecting;
    case 'restricted':
      return COPY.restricted;
    case 'ready':
      return '';
    case 'error':
      return COPY.errors[status.error.code];
  }
}

/** Site label for the header: host name without "www.", or a neutral label for browser pages. */
export function siteLabel(url: string | undefined): string {
  if (!url || isRestrictedUrl(url)) return COPY.restrictedSite;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || COPY.restrictedSite;
  } catch {
    return COPY.restrictedSite;
  }
}

export async function connect(api: PopupApi, tab: chrome.tabs.Tab | null, settings: Settings): Promise<PopupStatus> {
  if (!tab?.id || isRestrictedUrl(tab.url)) return { kind: 'restricted' };
  const injected = await api.ensureRuntime(tab.id);
  if (!injected.ok) return { kind: 'error', error: injected.error };
  const applied = await api.request(tab.id, 'APPLY_SETTINGS', settings);
  if (!applied.ok) return { kind: 'error', error: applied.error };
  return { kind: 'ready', buildId: applied.data.buildId, tabId: tab.id, state: applied.data };
}

const THEME_CACHE_KEY = 'rs-theme';
/** Applies the theme and mirrors it to localStorage so the next popup opens without a theme flash. */
export function applyTheme(doc: Document, theme: Theme): void {
  if (theme === 'system') delete doc.documentElement.dataset.theme;
  else doc.documentElement.dataset.theme = theme;
  try {
    doc.defaultView?.localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // Storage can be unavailable; the theme still applies once settings load.
  }
}
/** Synchronous best guess before settings load (only a cache; storage.sync stays the source of truth). */
export function cachedTheme(doc: Document): Theme {
  try {
    const t = doc.defaultView?.localStorage.getItem(THEME_CACHE_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

const fmt = (n: number, digits: number) => n.toFixed(digits).replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m)) || '0';
const SPACING_FORMAT: Record<ComfortSpacingKey, { label: string; text(v: number): string; spoken(v: number): string }> = {
  lineHeight: { label: COPY.comfort.lineHeight, text: (v) => `${fmt(v, 1)}×`, spoken: (v) => `${fmt(v, 1)} times the text size` },
  letterSpacing: { label: COPY.comfort.letterSpacing, text: (v) => `${fmt(v, 2)} em`, spoken: (v) => `${fmt(v, 2)} em` },
  wordSpacing: { label: COPY.comfort.wordSpacing, text: (v) => `${fmt(v, 2)} em`, spoken: (v) => `${fmt(v, 2)} em` },
  paragraphSpacing: { label: COPY.comfort.paragraphSpacing, text: (v) => `${fmt(v, 2)} em`, spoken: (v) => `${fmt(v, 2)} em` },
};

export interface PopupHandle {
  status: PopupStatus;
  settings(): Settings;
  /** Whether a Comfort sheet is active on the page, as last reported by the service worker. */
  comfortActive(): boolean;
  /** Whether a Calm sheet is active on the page, as last reported by the service worker. */
  calmActive(): boolean;
  /** Whether the Focus paint sheet is active on the page, as last reported by the service worker. */
  focusActive(): boolean;
  /** Resolves once pending (debounced) saves have finished. */
  flush(): Promise<void>;
}

export const SAVE_DEBOUNCE_MS = 250;
export const UNDO_MS = 8000;

export async function startPopup(root: Element, api: PopupApi): Promise<PopupHandle> {
  const doc = root.ownerDocument;
  applyTheme(doc, cachedTheme(doc));
  let settings: Settings = defaultSettings();
  let status: PopupStatus = { kind: 'loading' };
  let expanded: ModeId | null = null;
  let menuOpen = false;
  let tab: chrome.tabs.Tab | null = null;
  const updaters: (() => void)[] = [];
  const sync = () => updaters.forEach((u) => u());

  // ── persistence ──
  let saveError = false;
  let undoSnapshot: Settings | null = null;
  // State, UI and the page update immediately. Discrete changes (switches, choices) are saved at once,
  // because the popup can close right after a click; only slider drags are debounced (chrome.storage.sync
  // allows 120 writes per minute), and a pending save is flushed when the popup closes.
  let saveTimer = 0;
  let pending: Promise<void> = Promise.resolve();
  function commit(next: Settings, debounce = false): void {
    settings = normalizeSettings(next);
    applyTheme(doc, settings.ui.theme);
    applyPage();
    sync();
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    if (debounce) saveTimer = window.setTimeout(() => ((saveTimer = 0), (pending = persist())), SAVE_DEBOUNCE_MS);
    else pending = persist();
  }
  doc.defaultView?.addEventListener('pagehide', () => {
    if (saveTimer) (window.clearTimeout(saveTimer), (saveTimer = 0), void persist());
  });
  async function persist(): Promise<void> {
    try {
      const sent = settings;
      const saved = await api.saveSettings(sent);
      // A newer edit made while this save was in flight wins; an older result never reverts it.
      if (settings === sent) settings = saved;
      saveError = false;
    } catch {
      saveError = true;
    }
    renderMessages();
  }
  // ── Page effects: the popup shows the page's ACTUAL state. ──
  // Saving a preference and changing the page are separate: the page is updated immediately on every
  // change (the runtime for page side parts, the service worker for USER sheets, which serializes and
  // coalesces requests), and each sheet reports whether it is really active.
  interface SheetState {
    requested: string | null | undefined; // last sheet sent (undefined: nothing sent yet)
    active: boolean;
    error: boolean;
    seq: number;
  }
  const sheets: Record<SheetKey, SheetState> = {
    comfort: { requested: undefined, active: false, error: false, seq: 0 },
    calm: { requested: undefined, active: false, error: false, seq: 0 },
    focus: { requested: undefined, active: false, error: false, seq: 0 },
  };
  const BUILD: Record<SheetKey, (s: Settings) => string | null> = { comfort: (s) => buildComfortCss(s.modes.comfort), calm: (s) => buildCalmCss(s.modes.calm), focus: (s) => buildFocusCss(s.modes.focus) };
  // The bundled font goes to the page runtime once per popup session, when Comfort first uses it.
  let fontSent = false;
  let fontError = false;
  function applyFont(): void {
    if (status.kind !== 'ready' || fontSent || !settings.modes.comfort.enabled || settings.modes.comfort.font !== 'atkinson') return;
    fontSent = true;
    const tabId = status.tabId;
    void api
      .fontData()
      .then((data) => api.request(tabId, 'COMFORT_FONT', { data }))
      .then((r) => r.ok, () => false)
      .then((done) => {
        fontSent = done;
        fontError = !done;
        renderMessages();
      });
  }
  let pageState: RuntimeState | null = null;
  let runtimeSent: string | undefined;

  function applySheet(key: SheetKey, force = false): void {
    if (status.kind !== 'ready') return;
    const st = sheets[key];
    const css = BUILD[key](settings);
    if (!force && css === st.requested) return;
    st.requested = css;
    const seq = ++st.seq;
    void api
      .applySheet(status.tabId, key, css)
      .catch((): Response<{ active: boolean }> => ({ ok: false, error: { code: 'INTERNAL', message: 'apply failed' } }))
      .then((r) => {
        if (seq !== st.seq) return; // a newer request owns the state
        st.active = r.ok && r.data.active;
        st.error = !r.ok;
        if (!r.ok) st.requested = undefined; // allow a retry with the same sheet
        sync();
        renderMessages();
      });
  }
  function applyRuntime(force = false): void {
    if (status.kind !== 'ready') return;
    const json = JSON.stringify(settings.modes);
    if (!force && json === runtimeSent) return;
    runtimeSent = json;
    void api.request(status.tabId, 'APPLY_SETTINGS', settings).then((r) => {
      if (r.ok) (pageState = r.data), sync();
    });
  }
  function applyPage(force = false): void {
    applyRuntime(force);
    applySheet('comfort', force);
    applyFont();
    applySheet('calm', force);
    applySheet('focus', force);
  }
  function setShowAll(on: boolean): void {
    if (status.kind !== 'ready') return;
    void api.request(status.tabId, 'CALM_SHOW_ALL', { on }).then((r) => {
      if (r.ok) (pageState = r.data), sync();
    });
  }
  function setFocusPaused(paused: boolean): void {
    if (status.kind !== 'ready') return;
    void api.request(status.tabId, 'FOCUS_PAUSE', { paused }).then((r) => {
      if (r.ok) (pageState = r.data), sync(), renderMessages();
    });
  }
  /** Focus as the page reports it: off, active, paused, no text found, or not applied. */
  type FocusView = 'off' | 'on' | 'paused' | 'empty' | 'failed' | 'pending';
  function focusView(): FocusView {
    if (!settings.modes.focus.enabled) return 'off';
    if (status.kind !== 'ready') return 'pending';
    const f = pageState?.focus;
    if ((sheets.focus.error && !sheets.focus.active) || f?.status === 'unsupported') return 'failed';
    if (!f) return 'pending';
    if (f.status === 'paused') return 'paused';
    if (f.status === 'empty') return 'empty';
    return sheets.focus.active ? 'on' : 'pending';
  }

  const edit = (fn: (s: Settings) => void, debounce = false) => {
    const next = structuredClone(settings);
    fn(next);
    commit(next, debounce);
  };
  const unavailable = () => status.kind === 'restricted' || status.kind === 'error' || status.kind === 'loading';

  // ── header ──
  const siteText = el('p', { class: 'rs-header__site' });
  const header = el('header', { class: 'rs-header' }, el('div', {}, el('h1', { class: 'rs-header__title', text: COPY.appName }), siteText));
  const menuId = nextId('menu');
  const menuButton = iconButton({ label: COPY.moreLabel, icon: 'more', onClick: () => ((menuOpen = !menuOpen), sync()) });
  menuButton.setAttribute('aria-controls', menuId);
  const resetButton = iconButton({ label: COPY.menu.resetAll, icon: 'reset', onClick: () => resetAll() });
  header.append(el('div', { class: 'rs-header__actions' }, resetButton, menuButton));
  updaters.push(() => {
    siteText.textContent = siteLabel(tab?.url);
    menuButton.setAttribute('aria-expanded', String(menuOpen));
  });

  // ── settings menu (inline panel, not a floating card) ──
  const theme = segmented<Theme>({ legend: COPY.menu.theme, options: (['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: COPY.menu.themes[v] })), value: settings.ui.theme, onChange: (v) => edit((s) => (s.ui.theme = v)) });
  const menu = el(
    'section',
    { class: 'rs-menu', attrs: { id: menuId, 'aria-label': COPY.moreLabel } },
    theme.node,
  );
  updaters.push(() => {
    menu.hidden = !menuOpen;
    theme.set(settings.ui.theme);
  });

  // ── messages: polite status + assertive errors (separate regions so errors interrupt, info does not) ──
  const statusRegion = el('div', { class: 'rs-messages', attrs: { role: 'status' } });
  const alertRegion = el('div', { class: 'rs-messages', attrs: { role: 'alert' } });
  function renderMessages(): void {
    const info: Node[] = [];
    const errors: Node[] = [];
    if (status.kind === 'restricted') info.push(message({ tone: 'warning', text: COPY.restricted }));
    if (status.kind === 'ready' && (sheets.comfort.error || fontError)) errors.push(message({ tone: 'danger', text: COPY.errors.COMFORT, action: { label: COPY.retry, onClick: () => ((fontError = false), applySheet('comfort', true), applyFont()) } }));
    if (status.kind === 'ready' && sheets.calm.error) errors.push(message({ tone: 'danger', text: COPY.errors.CALM, action: { label: COPY.retry, onClick: () => applyPage(true) } }));
    if (status.kind === 'ready' && settings.modes.focus.enabled && focusView() === 'failed') errors.push(message({ tone: 'danger', text: pageState?.focus?.status === 'unsupported' ? COPY.errors.FOCUS_UNSUPPORTED : COPY.errors.FOCUS, action: pageState?.focus?.status === 'unsupported' ? undefined : { label: COPY.retry, onClick: () => applyPage(true) } }));
    if (focusView() === 'empty') info.push(message({ tone: 'info', text: COPY.focus.empty, quiet: true }));
    else if (status.kind === 'error') errors.push(message({ tone: 'danger', text: statusText(status), action: { label: COPY.retry, onClick: () => void reconnect() } }));
    if (saveError) errors.push(message({ tone: 'danger', text: COPY.errors.SAVE }));
    if (undoSnapshot) info.push(message({ tone: 'success', text: COPY.menu.resetDone, action: { label: COPY.menu.undo, onClick: () => undoReset() } }));
    statusRegion.replaceChildren(...info);
    alertRegion.replaceChildren(...errors);
  }

  // ── mode sections ──
  const modes = el('div', { class: 'rs-modes' });
  function modeSection(id: ModeId, name: string, description: string, body: Node[]) {
    const nameId = nextId(`${id}-name`);
    const descId = nextId(`${id}-desc`);
    const bodyId = nextId(`${id}-body`);
    const sw = switchControl({ labelledBy: nameId, describedBy: descId, checked: false, onChange: (on) => edit((s) => (s.modes[id].enabled = on)) });
    const disc = disclosureButton({ label: COPY.modeSettings(name), controls: bodyId, onToggle: () => ((expanded = expanded === id ? null : id), sync()) });
    const state = el('span', { class: 'rs-mode__state', attrs: { 'aria-hidden': 'true' } });
    const bodyNode = el('div', { class: 'rs-mode__body', attrs: { id: bodyId, role: 'group', 'aria-label': COPY.modeSettings(name) } }, ...body);
    const section = el(
      'section',
      { class: 'rs-mode', attrs: { 'aria-labelledby': nameId, 'data-mode': id } },
      el(
        'div',
        { class: 'rs-mode__head' },
        el('div', { class: 'rs-mode__text' }, el('h2', { class: 'rs-mode__name' }, el('span', { text: name, attrs: { id: nameId } }), state), el('p', { class: 'rs-mode__desc', text: description, attrs: { id: descId } })),
        el('div', { class: 'rs-mode__controls' }, sw.node, disc.node),
      ),
      bodyNode,
    );
    updaters.push(() => {
      const on = settings.modes[id].enabled;
      // The state word reports the page, not just the saved choice.
      const sheet = sheets[id];
      const notApplied = on && status.kind === 'ready' && sheet.error && !sheet.active;
      sw.set(on);
      sw.setDisabled(unavailable());
      if (id === 'focus') {
        const v = focusView();
        state.textContent = { off: COPY.off, on: COPY.on, pending: COPY.on, paused: COPY.focus.paused, empty: COPY.focus.noText, failed: COPY.notApplied }[v];
        section.classList.toggle('rs-mode--on', v === 'on' || v === 'pending'); // only a live highlight reads as active
      } else {
        state.textContent = notApplied ? COPY.notApplied : on ? COPY.on : COPY.off;
        section.classList.toggle('rs-mode--on', on);
      }
      section.classList.toggle('rs-mode--unavailable', unavailable());
      disc.set(expanded === id);
      bodyNode.hidden = expanded !== id;
    });
    modes.append(section);
  }

  // Focus
  {
    const moveHelp = help(COPY.focus.scrollHelp, true);
    const move = segmented({ legend: COPY.focus.moveWith, options: [{ value: 'keyboard', label: COPY.focus.keyboard }, { value: 'scroll', label: COPY.focus.scroll }], value: 'keyboard', onChange: (v) => edit((s) => (s.modes.focus.interaction = v)) });
    const color = segmented({ legend: COPY.focus.color, options: FOCUS_COLORS.map((v) => ({ value: v, label: COPY.focus.colors[v] })), value: 'yellow', onChange: (v) => edit((s) => (s.modes.focus.color = v)) });
    // Pause is a temporary page state (runtime), never a saved preference.
    const pause = button({ label: COPY.focus.pause, onClick: () => setFocusPaused(focusView() !== 'paused'), block: true });
    const pauseLabel = pause.querySelector('span')!;
    const keys = el(
      'dl',
      { class: 'rs-keys', attrs: { 'aria-label': COPY.focus.shortcutsTitle } },
      ...COPY.focus.shortcuts.flatMap(([k, what]) => [el('dt', {}, el('kbd', { class: 'rs-kbd', text: k })), el('dd', { text: what })]),
    );
    const shortcuts = el('div', { class: 'rs-field' }, el('p', { class: 'rs-field__label', text: COPY.focus.shortcutsTitle }), keys);
    updaters.push(() => {
      move.set(settings.modes.focus.interaction);
      color.set(settings.modes.focus.color);
      shortcuts.hidden = settings.modes.focus.interaction !== 'keyboard';
      moveHelp.hidden = settings.modes.focus.interaction !== 'scroll';
      const v = focusView();
      pause.disabled = v !== 'on' && v !== 'paused';
      pauseLabel.textContent = v === 'paused' ? COPY.focus.resume : COPY.focus.pause;
    });
    modeSection('focus', COPY.focus.name, COPY.focus.description, [move.node, moveHelp, color.node, shortcuts, pause]);
  }

  // Comfort: Text size, Font, Spacing, Adjust spacing (with Reset Comfort). Each is independent.
  {
    const c = () => settings.modes.comfort;
    const minHelp = help(COPY.comfort.minSizeHelp, true);
    const minSize = segmented({ legend: COPY.comfort.minSize, options: COMFORT_MIN_SIZES.map((v) => ({ value: v, label: COPY.comfort.minSizes[v] })), value: 'off', describedBy: minHelp.id, onChange: (v) => edit((s) => (s.modes.comfort.minSize = v)) });
    const font = selectField({ label: COPY.comfort.font, options: COMFORT_FONTS.map((v) => ({ value: v, label: COPY.comfort.fonts[v] })), value: 'site', onChange: (v) => edit((s) => (s.modes.comfort.font = v)) });
    const presets = segmented({
      legend: COPY.comfort.spacing,
      options: COMFORT_PRESETS.map((v) => ({ value: v, label: COPY.comfort.presets[v] })),
      value: 'relaxed',
      onChange: (v) =>
        edit((s) => {
          s.modes.comfort.preset = v;
          if (v !== 'custom') Object.assign(s.modes.comfort, presetValues(v));
        }),
    });
    const customHelp = help(COPY.comfort.customHelp, true);
    presets.node.setAttribute('aria-describedby', customHelp.id);
    const base = COMFORT_PRESET_VALUES.relaxed; // per slider reset target
    const sliders = COMFORT_SPACING_KEYS.map((key) => {
      const f = SPACING_FORMAT[key];
      const r = COMFORT_RANGES[key];
      const s = slider({
        label: f.label,
        ...r,
        value: base[key],
        format: f.text,
        spoken: f.spoken,
        resetLabel: COPY.comfort.resetOne(f.label),
        onInput: (v) => edit((st) => ((st.modes.comfort[key] = v), (st.modes.comfort.preset = 'custom')), true),
        onReset: () => edit((st) => ((st.modes.comfort[key] = base[key]), (st.modes.comfort.preset = 'custom'))),
      });
      return { key, ...s };
    });
    const resetComfort = iconButton({ label: COPY.comfort.resetAll, icon: 'reset', onClick: () => edit((s) => (s.modes.comfort = { ...defaultSettings().modes.comfort, enabled: s.modes.comfort.enabled })) });
    const advanced = disclosureRowWithAction(COPY.comfort.advanced, resetComfort, ...sliders.map((s) => s.node));
    updaters.push(() => {
      minSize.set(c().minSize);
      font.set(c().font);
      presets.set(c().preset);
      customHelp.hidden = c().preset === 'custom';
      for (const s of sliders) {
        s.set(c()[s.key]);
        s.setResetVisible(c().preset === 'custom' && c()[s.key] !== base[s.key]);
      }
    });
    modeSection('comfort', COPY.comfort.name, COPY.comfort.description, [minSize.node, minHelp, font.node, presets.node, customHelp, advanced]);
  }

  // Calm
  {
    const k = () => settings.modes.calm;
    const motion = checkboxRow({ label: COPY.calm.reduceMotion, checked: true, help: COPY.calm.reduceMotionHelp, onChange: (v) => edit((s) => (s.modes.calm.reduceMotion = v)) });
    const blur = checkboxRow({ label: COPY.calm.blur, checked: false, help: COPY.calm.blurHelp, onChange: (v) => edit((s) => (s.modes.calm.blurImages = v)) });
    const strength = segmented({ legend: COPY.calm.strength, options: (['light', 'strong'] as const).map((v) => ({ value: v, label: COPY.calm.strengths[v] })), value: 'light', onChange: (v) => edit((s) => (s.modes.calm.blurStrength = v)) });
    // Show all images is a temporary page state (runtime), never a saved preference.
    const showAll = button({ label: COPY.calm.showAll, onClick: () => setShowAll(!pageState?.calm?.showAll), block: true });
    const showAllLabel = showAll.querySelector('span')!;
    const blurGroup = el('div', { class: 'rs-group' }, strength.node, showAll);
    updaters.push(() => {
      motion.set(k().reduceMotion);
      blur.set(k().blurImages);
      strength.set(k().blurStrength);
      blurGroup.hidden = !k().blurImages;
      const live = status.kind === 'ready' && k().enabled && !!pageState?.calm?.blurActive && sheets.calm.active;
      showAll.disabled = !live;
      showAllLabel.textContent = live && pageState?.calm?.showAll ? COPY.calm.blurAgain : COPY.calm.showAll;
    });
    modeSection('calm', COPY.calm.name, COPY.calm.description, [motion.node, blur.node, blurGroup]);
  }

  function resetAll(): void {
    undoSnapshot = structuredClone(settings);
    commit(defaultSettings());
    window.setTimeout(() => ((undoSnapshot = null), renderMessages()), UNDO_MS);
  }
  function undoReset(): void {
    const snap = undoSnapshot;
    undoSnapshot = null;
    if (snap) commit(snap);
  }

  async function reconnect(): Promise<void> {
    status = { kind: 'loading' };
    sync();
    renderMessages();
    try {
      status = await connect(api, tab, settings);
    } catch (e) {
      status = { kind: 'error', error: { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e) } };
    }
    sheets.comfort.requested = sheets.calm.requested = sheets.focus.requested = undefined;
    if (status.kind === 'ready') (pageState = status.state ?? null), (runtimeSent = JSON.stringify(settings.modes)); // connect() sent APPLY_SETTINGS
    applyPage();
    sync();
    renderMessages();
  }

  mount(root, header, menu, statusRegion, alertRegion, modes);
  root.setAttribute('aria-busy', 'true');
  sync();

  try {
    [tab, settings] = await Promise.all([api.activeTab(), api.loadSettings()]);
  } catch (e) {
    status = { kind: 'error', error: { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e) } };
  }
  applyTheme(doc, settings.ui.theme);
  if (status.kind === 'loading') await reconnect();
  else (sync(), renderMessages());
  root.removeAttribute('aria-busy');

  return {
    get status() {
      return status;
    },
    comfortActive: () => sheets.comfort.active,
    calmActive: () => sheets.calm.active,
    focusActive: () => sheets.focus.active,
    settings: () => settings,
    async flush() {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = 0;
        pending = persist();
      }
      await pending;
    },
  };
}
