/** Copy rules for user facing text: plain, short, no hyphens or dashes. */
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/ui/popup/copy';

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') return [String((v as (...a: unknown[]) => unknown)('Example', true))];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}
const all = strings(COPY);

describe('popup copy', () => {
  it('has strings to check', () => expect(all.length).toBeGreaterThan(50));
  it.each(all)('"%s" has no hyphen or dash', (s) => expect(s).not.toMatch(/[-‐‑‒–—―]/));
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  it.each(all)('"%s" keeps every sentence to 8 words or fewer', (s) => {
    for (const sentence of s.split(/[.!?]\s*/)) expect(words(sentence)).toBeLessThanOrEqual(8);
  });
  it.each(all)('"%s" has at most two sentences', (s) => expect(s.split(/[.!?](\s|$)/).filter((x) => x.trim()).length).toBeLessThanOrEqual(2));
  it.each([COPY.focus, COPY.comfort, COPY.calm])('$name description is 2 to 6 words and does not repeat the mode name', (m) => {
    expect(words(m.description)).toBeGreaterThanOrEqual(2);
    expect(words(m.description)).toBeLessThanOrEqual(6);
    expect(m.description.toLowerCase()).not.toContain(m.name.toLowerCase());
  });
  it('no mode is marked as a preview any more', () => expect(JSON.stringify(COPY).toLowerCase()).not.toMatch(/preview|does not work yet/));
});
