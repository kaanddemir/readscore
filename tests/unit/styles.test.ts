/**
 * Design-system guard: raw values live only in tokens.css. Every other stylesheet must use
 * var(--rs-*) for colours, lengths and durations. Allowed literals: 0, 1 (unitless), %, keywords.
 */
/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Read from disk: Vite's ?raw import yields '' for CSS under Vitest, which would make this guard pass vacuously.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const sheets: Record<string, string> = {};
for (const entry of readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })) {
  if (entry.endsWith('.css')) sheets[`/${relative(ROOT, join(ROOT, 'src', entry))}`] = readFileSync(join(ROOT, 'src', entry), 'utf8');
}
const TOKENS = '/src/ui/shared/tokens.css';

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('design tokens', () => {
  it('tokens.css exists and defines the token groups', () => {
    const css = sheets[TOKENS] ?? '';
    expect(css.length).toBeGreaterThan(0);
    for (const group of ['--rs-bg', '--rs-surface', '--rs-text', '--rs-text-muted', '--rs-accent', '--rs-danger', '--rs-font', '--rs-text-md', '--rs-weight-medium', '--rs-leading', '--rs-space-4', '--rs-radius-md', '--rs-border-width', '--rs-focus-ring', '--rs-control-h', '--rs-icon-md', '--rs-popup-width', '--rs-duration-fast', '--rs-ease']) {
      expect(css).toContain(`${group}:`);
    }
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain("[data-theme='dark']");
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  const others = Object.keys(sheets).filter((f) => f !== TOKENS);
  it('there are component stylesheets to check', () => expect(others.length).toBeGreaterThan(0));

  it.each(others)('%s uses tokens only (no raw colours, lengths or durations)', (file) => {
    const css = stripComments(sheets[file]!);
    expect(css.length).toBeGreaterThan(0);
    expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(css.match(/\b(rgb|rgba|hsl|hsla|oklch)\(/gi) ?? []).toEqual([]);
    expect(css.match(/\b\d*\.?\d+(px|rem|em|ms|s|vh|vw)\b/g) ?? []).toEqual([]);
    expect(css).not.toMatch(/(^|[;{])\s*--[a-z][\w-]*\s*:/m); // no new custom properties outside tokens.css
    // Paper direction: flat surfaces only.
    expect(css).not.toMatch(/box-shadow|gradient\(|backdrop-filter/);
  });
});
