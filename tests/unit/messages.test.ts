import { describe, expect, it } from 'vitest';
import { REQUEST_TYPES, SHEET_KEYS, SHEET_ORIGIN, isOurs, isRequest, isResponse, isSheetApply, makeRequest, makeSheetApply } from '../../src/shared/messages';

describe('messages', () => {
  it('builds marked requests', () => {
    expect(makeRequest('PING', null)).toEqual({ rs: 'rs2', type: 'PING', payload: null });
  });

  it('recognizes only marked, known requests', () => {
    for (const t of REQUEST_TYPES) expect(isRequest({ rs: 'rs2', type: t, payload: null })).toBe(true);
    expect(isRequest({ rs: 'rs2', type: 'analyze' })).toBe(false);
    expect(isOurs({ rs: 'rs2', type: 'analyze' })).toBe(true);
    // ReadScore 1.x and foreign messages are not ours.
    expect(isOurs({ action: 'analyze' })).toBe(false);
    expect(isOurs(null)).toBe(false);
  });

  it('sheet requests: Focus is a sheet key with AUTHOR origin; unknown keys are rejected', () => {
    expect(SHEET_KEYS).toEqual(['comfort', 'calm', 'focus']);
    expect(SHEET_ORIGIN).toEqual({ comfort: 'USER', calm: 'USER', focus: 'AUTHOR' });
    expect(isSheetApply(makeSheetApply(3, 'focus', 'x'))).toBe(true);
    expect(isSheetApply({ ...makeSheetApply(3, 'focus', 'x'), payload: { tabId: 3, key: 'dim', css: 'x' } })).toBe(false);
    expect(isRequest(makeRequest('FOCUS_PAUSE', { paused: true }))).toBe(true);
  });

  it('recognizes responses', () => {
    expect(isResponse({ ok: true, data: 1 })).toBe(true);
    expect(isResponse({ hasResults: true })).toBe(false);
  });
});
