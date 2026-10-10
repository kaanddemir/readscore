/**
 * WCAG 2.2 AA contrast for the popup's colour tokens, in both themes, computed from tokens.css itself
 * (so a palette edit cannot silently break contrast).
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../src/ui/shared/tokens.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const decls = (block: string) => Object.fromEntries([...block.matchAll(/(--rs-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const darkStart = css.indexOf(":root[data-theme='dark'] {");
const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart));
const light = decls(rootBlock);
const dark = { ...light, ...decls(darkBlock) };

function resolve(theme: Record<string, string>, name: string): string {
  let v = theme[name];
  for (let i = 0; v && v.startsWith('var(') && i < 5; i++) v = theme[v.slice(4, -1).trim()];
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} does not resolve to a hex colour: ${v}`);
  return v;
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };

const TEXT = ['--rs-text', '--rs-text-muted', '--rs-accent', '--rs-danger', '--rs-warning', '--rs-success', '--rs-info'];
const SURFACES = ['--rs-bg', '--rs-surface', '--rs-surface-sunken'];
const NON_TEXT = ['--rs-border-control', '--rs-focus-ring', '--rs-accent'];

describe.each([['light', light], ['dark', dark]] as const)('%s theme contrast', (_name, theme) => {
  it('dark block exists and overrides colours', () => expect(Object.keys(decls(darkBlock)).length).toBeGreaterThan(10));
  for (const fg of TEXT) for (const bg of SURFACES) it(`${fg} on ${bg} ≥ 4.5:1 (text)`, () => expect(ratio(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(4.5));
  for (const fg of NON_TEXT) it(`${fg} on --rs-bg ≥ 3:1 (UI component, SC 1.4.11)`, () => expect(ratio(resolve(theme, fg), resolve(theme, '--rs-bg'))).toBeGreaterThanOrEqual(3));
  it('--rs-on-accent on --rs-accent ≥ 4.5:1', () => expect(ratio(resolve(theme, '--rs-on-accent'), resolve(theme, '--rs-accent'))).toBeGreaterThanOrEqual(4.5));
  it('switch thumb (--rs-border-control) on --rs-surface-sunken ≥ 3:1', () => expect(ratio(resolve(theme, '--rs-border-control'), resolve(theme, '--rs-surface-sunken'))).toBeGreaterThanOrEqual(3));
});

it('the media-query dark block and the data-theme dark block are identical', () => {
  const mq = css.slice(css.indexOf(":root:not([data-theme='light']) {"), css.indexOf('}', css.indexOf(":root:not([data-theme='light']) {")));
  expect(decls(mq)).toEqual(decls(darkBlock));
});
