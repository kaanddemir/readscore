/**
 * Typed messages: popup → content runtime via chrome.tabs.sendMessage.
 * Every request is answered with { ok: true, data } | { ok: false, error }.
 * The `rs` marker separates ReadScore messages from anything else on the page's channel.
 */
import type { ModeId, Settings } from './settings';

export const MESSAGE_MARKER = 'rs2';

export interface RuntimeState {
  buildId: string;
  activeModes: ModeId[];
  /** Calm page state (temporary Show all images lives here, never in settings). */
  calm?: { blurActive: boolean; motionActive: boolean; showAll: boolean; marked: number };
  /** Focus page state (pause is temporary page state, never a setting). Present while Focus is on. */
  focus?: { status: 'active' | 'paused' | 'empty' | 'unsupported'; blocks: number; index: number; stats?: Record<string, number | string> };
}

export interface RequestMap {
  PING: { payload: null; data: { buildId: string } };
  GET_STATE: { payload: null; data: RuntimeState };
  APPLY_SETTINGS: { payload: Settings; data: RuntimeState };
  CALM_SHOW_ALL: { payload: { on: boolean }; data: RuntimeState };
  FOCUS_PAUSE: { payload: { paused: boolean }; data: RuntimeState };
  /** The bundled Comfort font (base64 per file, ATKINSON_FILES order), sent once per popup session. */
  COMFORT_FONT: { payload: { data: string[] }; data: RuntimeState };
}

export type RequestType = keyof RequestMap;
export const REQUEST_TYPES: readonly RequestType[] = ['PING', 'GET_STATE', 'APPLY_SETTINGS', 'CALM_SHOW_ALL', 'FOCUS_PAUSE', 'COMFORT_FONT'];

export interface Request<T extends RequestType = RequestType> {
  rs: typeof MESSAGE_MARKER;
  type: T;
  payload: RequestMap[T]['payload'];
}

export type ErrorCode = 'RESTRICTED_PAGE' | 'NOT_INJECTED' | 'INVALID_MESSAGE' | 'INTERNAL';

export interface RsError {
  code: ErrorCode;
  message: string;
}

export type Response<D> = { ok: true; data: D } | { ok: false; error: RsError };

export function makeRequest<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Request<T> {
  return { rs: MESSAGE_MARKER, type, payload };
}

export const ok = <D>(data: D): Response<D> => ({ ok: true, data });
export const fail = (code: ErrorCode, message: string): Response<never> => ({ ok: false, error: { code, message } });

/** True for any message carrying the ReadScore marker (valid or not). */
export function isOurs(msg: unknown): msg is { rs: string; type?: unknown } {
  return typeof msg === 'object' && msg !== null && (msg as { rs?: unknown }).rs === MESSAGE_MARKER;
}

export function isRequest(msg: unknown): msg is Request {
  return isOurs(msg) && REQUEST_TYPES.includes(msg.type as RequestType);
}

export function isResponse(res: unknown): res is Response<unknown> {
  return typeof res === 'object' && res !== null && typeof (res as { ok?: unknown }).ok === 'boolean';
}

// ───── Popup → service worker ─────
/** Stylesheets the service worker manages per document, one per key. */
export const SHEET_KEYS = ['comfort', 'calm', 'focus'] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];
/** Cascade origin per sheet. Focus paints `::highlight()`, which only AUTHOR origin rules do (Phase 1). */
export const SHEET_ORIGIN: Readonly<Record<SheetKey, 'USER' | 'AUTHOR'>> = Object.freeze({ comfort: 'USER', calm: 'USER', focus: 'AUTHOR' });

/** Asks the service worker to make `css` the tab's `key` sheet (null removes it). */
export interface SheetApplyRequest {
  rs: typeof MESSAGE_MARKER;
  type: 'SHEET_APPLY';
  payload: { tabId: number; key: SheetKey; css: string | null };
}

export function makeSheetApply(tabId: number, key: SheetKey, css: string | null): SheetApplyRequest {
  return { rs: MESSAGE_MARKER, type: 'SHEET_APPLY', payload: { tabId, key, css } };
}

export function isSheetApply(msg: unknown): msg is SheetApplyRequest {
  if (!isOurs(msg) || msg.type !== 'SHEET_APPLY') return false;
  const p = (msg as { payload?: unknown }).payload as { tabId?: unknown; key?: unknown; css?: unknown } | undefined;
  return !!p && Number.isInteger(p.tabId) && SHEET_KEYS.includes(p.key as SheetKey) && (p.css === null || typeof p.css === 'string');
}
