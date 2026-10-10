import { describe, expect, it } from 'vitest';
import {
  COMFORT_PRESET_VALUES,
  COMFORT_RANGES,
  COMFORT_SPACING_KEYS,
  DEFAULT_SETTINGS,
  LEGACY_KEYS,
  MODE_IDS,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  clampSpacing,
  defaultSettings,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type SettingsStore,
} from '../../src/shared/settings';

function memoryStore(initial: Record<string, unknown> = {}): SettingsStore & { data: Record<string, unknown> } {
  const data = { ...initial };
  return { data, get: async (k) => (k in data ? { [k]: data[k] } : {}), set: async (items) => void Object.assign(data, items) };
}

describe('settings v2', () => {
  it('defaults: every mode exists and is off; Calm defaults to Reduce motion only', () => {
    expect(DEFAULT_SETTINGS.version).toBe(SETTINGS_VERSION);
    expect(Object.keys(DEFAULT_SETTINGS.modes)).toEqual([...MODE_IDS]);
    for (const id of MODE_IDS) expect(DEFAULT_SETTINGS.modes[id].enabled).toBe(false);
    expect(DEFAULT_SETTINGS.modes.calm).toMatchObject({ reduceMotion: true, blurImages: false, blurStrength: 'light' });
    expect(DEFAULT_SETTINGS.modes.comfort).toMatchObject({ preset: 'relaxed', font: 'site', minSize: 'off', ...COMFORT_PRESET_VALUES.relaxed });
    expect(DEFAULT_SETTINGS.ui.theme).toBe('system');
  });

  it('defaults are deeply frozen; defaultSettings() returns a mutable copy', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS.modes.comfort)).toBe(true);
    const s = defaultSettings();
    s.modes.focus.enabled = true;
    expect(DEFAULT_SETTINGS.modes.focus.enabled).toBe(false);
  });

  it.each([undefined, null, 42, 'x', [], {}, { modes: null }, { modes: { focus: { enabled: 'yes', interaction: 'mouse' } } }])('normalizes malformed input %j to defaults', (raw) => {
    expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it('migrates v1 data: keeps the on/off flags, fills every new option with defaults', () => {
    const s = normalizeSettings({ version: 1, modes: { focus: { enabled: true }, comfort: { enabled: false }, calm: { enabled: true } } });
    expect(s.version).toBe(3);
    expect(s.modes.focus).toEqual({ enabled: true, interaction: 'keyboard', color: 'yellow' });
    expect(s.modes.calm.enabled).toBe(true);
    expect(s.modes.calm.reduceMotion).toBe(true);
  });

  it('migrates v2 Comfort: Standard becomes Roomy, Roomy becomes Custom with its values, Custom is kept; font, size, on/off and other modes are kept', () => {
    const v2 = (comfort: object) => normalizeSettings({ version: 2, modes: { focus: { enabled: true, interaction: 'scroll', color: 'blue' }, comfort: { enabled: true, font: 'serif', minSize: '20', ...comfort }, calm: { enabled: true, blurImages: true } } });
    const std = v2({ preset: 'standard', lineHeight: 1.5, letterSpacing: 0.12, wordSpacing: 0.16, paragraphSpacing: 2 });
    expect(std.modes.comfort).toEqual({ enabled: true, font: 'serif', minSize: '20', preset: 'roomy', ...COMFORT_PRESET_VALUES.roomy });
    expect(std.modes.focus).toEqual({ enabled: true, interaction: 'scroll', color: 'blue' });
    expect(std.modes.calm).toMatchObject({ enabled: true, blurImages: true });
    const roomy = v2({ preset: 'roomy', lineHeight: 1.8, letterSpacing: 0.16, wordSpacing: 0.24, paragraphSpacing: 2.5 });
    expect(roomy.modes.comfort).toMatchObject({ preset: 'custom', lineHeight: 1.8, letterSpacing: 0.16, wordSpacing: 0.24, paragraphSpacing: 2.5, font: 'serif', minSize: '20' });
    const custom = v2({ preset: 'custom', lineHeight: 1.7, letterSpacing: 0.04, wordSpacing: 0.08, paragraphSpacing: 1.25 });
    expect(custom.modes.comfort).toMatchObject({ preset: 'custom', lineHeight: 1.7, letterSpacing: 0.04, wordSpacing: 0.08, paragraphSpacing: 1.25 });
    // Migrated data saved as v3 is stable: normalizing it again changes nothing.
    for (const s of [std, roomy, custom]) expect(normalizeSettings(s)).toEqual(s);
  });

  it('v3 Roomy stays Roomy (no second migration); Site and Relaxed carry the Relaxed slider values', () => {
    expect(normalizeSettings({ version: 3, modes: { comfort: { preset: 'roomy' } } }).modes.comfort).toMatchObject({ preset: 'roomy', ...COMFORT_PRESET_VALUES.roomy });
    for (const preset of ['site', 'relaxed']) expect(normalizeSettings({ version: 3, modes: { comfort: { preset } } }).modes.comfort).toMatchObject({ preset, ...COMFORT_PRESET_VALUES.relaxed });
    expect(normalizeSettings({ version: 3, modes: { comfort: { font: 'atkinson', minSize: '22' } } }).modes.comfort).toMatchObject({ font: 'atkinson', minSize: '22' });
  });

  it('rejects values outside the allowed lists field by field', () => {
    const s = normalizeSettings({ modes: { comfort: { font: 'Comic Sans', minSize: '40', preset: 'huge' }, calm: { blurStrength: 'max' } }, ui: { theme: 'neon' } });
    expect(s.modes.comfort).toMatchObject({ font: 'site', minSize: 'off', preset: 'relaxed' });
    expect(s.modes.calm.blurStrength).toBe('light');
    expect(s.ui.theme).toBe('system');
  });

  it('named presets always carry their exact values; Custom keeps clamped stored numbers', () => {
    expect(normalizeSettings({ version: 3, modes: { comfort: { preset: 'roomy', lineHeight: 1.2 } } }).modes.comfort.lineHeight).toBe(COMFORT_PRESET_VALUES.roomy.lineHeight);
    const c = normalizeSettings({ version: 3, modes: { comfort: { preset: 'custom', lineHeight: 9, letterSpacing: -1, wordSpacing: 0.13, paragraphSpacing: 'x' } } }).modes.comfort;
    expect(c.lineHeight).toBe(COMFORT_RANGES.lineHeight.max);
    expect(c.letterSpacing).toBe(COMFORT_RANGES.letterSpacing.min);
    expect(c.wordSpacing).toBe(0.12); // snapped to the 0.04 step grid
    expect(c.paragraphSpacing).toBe(COMFORT_PRESET_VALUES.relaxed.paragraphSpacing);
  });

  it('every preset value sits inside its range and on its step grid', () => {
    for (const preset of ['relaxed', 'roomy'] as const) {
      for (const key of COMFORT_SPACING_KEYS) {
        const v = COMFORT_PRESET_VALUES[preset][key];
        expect(clampSpacing(key, v, -1)).toBe(v);
      }
    }
  });

  it('load/save round-trip through a store, normalizing on both sides', async () => {
    const store = memoryStore();
    expect(await loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    const next = defaultSettings();
    next.modes.focus.enabled = true;
    next.ui.theme = 'dark';
    await saveSettings(store, next);
    const back = await loadSettings(store);
    expect(back.modes.focus.enabled).toBe(true);
    expect(back.ui.theme).toBe('dark');
    expect(Object.keys(store.data)).toEqual([SETTINGS_KEY]);
  });

  it('lists every ReadScore 1.x storage key for removal', () => {
    expect(LEGACY_KEYS).toEqual(['rs_summary_type', 'rs_summary_length', 'easyRead_focusMode', 'easyRead_simplifiedSpacing', 'easyRead_readingGuide']);
  });
});
