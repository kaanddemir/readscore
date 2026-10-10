/**
 * User settings: one versioned, validated object in chrome.storage.sync.
 * Every read goes through normalizeSettings, so missing, old (v1) or malformed data falls back to
 * defaults field by field. Option lists and numeric ranges are defined here once and reused by the UI.
 */
export const SETTINGS_KEY = 'settings';
export const SETTINGS_VERSION = 3;

export const MODE_IDS = ['focus', 'comfort', 'calm'] as const;
export type ModeId = (typeof MODE_IDS)[number];

export interface ModeSettings {
  enabled: boolean;
}

export const FOCUS_INTERACTIONS = ['keyboard', 'scroll'] as const;
export const FOCUS_COLORS = ['yellow', 'blue', 'green', 'dark'] as const;
export type FocusColor = (typeof FOCUS_COLORS)[number];
export interface FocusSettings extends ModeSettings {
  interaction: (typeof FOCUS_INTERACTIONS)[number];
  color: FocusColor;
}

/** Site: the page's own spacing. Relaxed: gentle. Roomy: WCAG 2.2 SC 1.4.12 (the v2 "Standard"). */
export const COMFORT_PRESETS = ['site', 'relaxed', 'roomy', 'custom'] as const;
export const COMFORT_FONTS = ['site', 'sans', 'serif', 'atkinson'] as const;
/** Text size is a minimum: smaller reading text grows to it, larger text is left as is. */
export const COMFORT_MIN_SIZES = ['off', '18', '20', '22'] as const;
export type ComfortSpacingKey = 'lineHeight' | 'letterSpacing' | 'wordSpacing' | 'paragraphSpacing';
export type ComfortPreset = (typeof COMFORT_PRESETS)[number];
export interface ComfortSettings extends ModeSettings, Record<ComfortSpacingKey, number> {
  preset: ComfortPreset;
  font: (typeof COMFORT_FONTS)[number];
  minSize: (typeof COMFORT_MIN_SIZES)[number];
}

/** Ranges validated in Phase 1 (no new clipping on the tested sites inside these bounds). */
export const COMFORT_RANGES: Readonly<Record<ComfortSpacingKey, { min: number; max: number; step: number }>> = Object.freeze({
  lineHeight: { min: 1.2, max: 2, step: 0.1 },
  letterSpacing: { min: 0, max: 0.16, step: 0.02 },
  wordSpacing: { min: 0, max: 0.24, step: 0.04 },
  paragraphSpacing: { min: 1, max: 2.5, step: 0.25 },
});
export const COMFORT_SPACING_KEYS = Object.keys(COMFORT_RANGES) as ComfortSpacingKey[];

/** Preset values. Roomy is WCAG 2.2 SC 1.4.12. Site writes no spacing; its sliders start from Relaxed. */
export const COMFORT_PRESET_VALUES: Readonly<Record<Exclude<ComfortPreset, 'custom' | 'site'>, Record<ComfortSpacingKey, number>>> = Object.freeze({
  relaxed: { lineHeight: 1.6, letterSpacing: 0.02, wordSpacing: 0.08, paragraphSpacing: 1.5 },
  roomy: { lineHeight: 1.5, letterSpacing: 0.12, wordSpacing: 0.16, paragraphSpacing: 2 },
});
/** Slider values of a preset (Site has none of its own: its sliders start from Relaxed). */
export const presetValues = (p: Exclude<ComfortPreset, 'custom'>) => COMFORT_PRESET_VALUES[p === 'site' ? 'relaxed' : p];

/** v2 presets: Standard (= v3 Roomy) and Roomy (wider; kept as Custom with these values). */
const V2_ROOMY = { lineHeight: 1.8, letterSpacing: 0.16, wordSpacing: 0.24, paragraphSpacing: 2.5 };

export const BLUR_STRENGTHS = ['light', 'strong'] as const;
export interface CalmSettings extends ModeSettings {
  reduceMotion: boolean;
  blurImages: boolean;
  blurStrength: (typeof BLUR_STRENGTHS)[number];
}

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export interface Settings {
  version: typeof SETTINGS_VERSION;
  modes: { focus: FocusSettings; comfort: ComfortSettings; calm: CalmSettings };
  ui: { theme: Theme };
}

const deepFreeze = <T>(o: T): T => {
  for (const v of Object.values(o as object)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

export const DEFAULT_SETTINGS: Settings = deepFreeze({
  version: SETTINGS_VERSION,
  modes: {
    focus: { enabled: false, interaction: 'keyboard', color: 'yellow' },
    comfort: { enabled: false, preset: 'relaxed', font: 'site', minSize: 'off', ...COMFORT_PRESET_VALUES.relaxed },
    calm: { enabled: false, reduceMotion: true, blurImages: false, blurStrength: 'light' },
  },
  ui: { theme: 'system' },
} satisfies Settings) as Settings;

/** ReadScore 1.x storage keys. Removed on update; none of them carries into 2.0. */
export const LEGACY_KEYS = [
  'rs_summary_type',
  'rs_summary_length',
  'easyRead_focusMode',
  'easyRead_simplifiedSpacing',
  'easyRead_readingGuide',
] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Snaps a number into its range and onto its step grid (floating-point safe). */
export function clampSpacing(key: ComfortSpacingKey, v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const { min, max, step } = COMFORT_RANGES[key];
  const snapped = min + Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step;
  return Math.round(snapped * 1000) / 1000;
}

/** Returns a complete, valid Settings object built from anything (never throws, never shares DEFAULT_SETTINGS). */
export function normalizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS.modes;
  const m = isRecord(raw) && isRecord(raw.modes) ? raw.modes : {};
  const f = isRecord(m.focus) ? m.focus : {};
  const c = isRecord(m.comfort) ? m.comfort : {};
  const k = isRecord(m.calm) ? m.calm : {};
  const ui = isRecord(raw) && isRecord(raw.ui) ? raw.ui : {};

  // v2 (and older or unversioned) data: Standard became Roomy; the old Roomy is kept as Custom with its values.
  const old = !isRecord(raw) || raw.version !== SETTINGS_VERSION;
  const stored = old ? ({ standard: 'roomy', roomy: 'custom' } as Record<string, unknown>)[c.preset as string] ?? c.preset : c.preset;
  const values = old && c.preset === 'roomy' ? { ...c, ...V2_ROOMY } : c;
  const preset = pick(stored, COMFORT_PRESETS, d.comfort.preset);
  const spacing = {} as Record<ComfortSpacingKey, number>;
  for (const key of COMFORT_SPACING_KEYS) {
    // A named preset always carries its exact values; only Custom keeps stored numbers.
    spacing[key] = preset === 'custom' ? clampSpacing(key, values[key], d.comfort[key]) : presetValues(preset)[key];
  }

  return {
    version: SETTINGS_VERSION,
    modes: {
      focus: { enabled: bool(f.enabled, d.focus.enabled), interaction: pick(f.interaction, FOCUS_INTERACTIONS, d.focus.interaction), color: pick(f.color, FOCUS_COLORS, d.focus.color) },
      comfort: {
        enabled: bool(c.enabled, d.comfort.enabled),
        preset,
        font: pick(c.font, COMFORT_FONTS, d.comfort.font),
        minSize: pick(c.minSize, COMFORT_MIN_SIZES, d.comfort.minSize),
        ...spacing,
      },
      calm: {
        enabled: bool(k.enabled, d.calm.enabled),
        reduceMotion: bool(k.reduceMotion, d.calm.reduceMotion),
        blurImages: bool(k.blurImages, d.calm.blurImages),
        blurStrength: pick(k.blurStrength, BLUR_STRENGTHS, d.calm.blurStrength),
      },
    },
    ui: { theme: pick(ui.theme, THEMES, DEFAULT_SETTINGS.ui.theme) },
  };
}

/** Fresh copy of the defaults (mutable). */
export const defaultSettings = (): Settings => normalizeSettings(undefined);

/** The subset of chrome.storage.StorageArea used here (lets tests pass an in-memory fake). */
export interface SettingsStore {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export async function loadSettings(store: SettingsStore): Promise<Settings> {
  const stored = await store.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(store: SettingsStore, settings: Settings): Promise<Settings> {
  const valid = normalizeSettings(settings);
  await store.set({ [SETTINGS_KEY]: valid });
  return valid;
}
