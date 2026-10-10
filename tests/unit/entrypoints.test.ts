/// <reference types="vite/client" />
/**
 * Production surface: every module is reachable from an entry point (no orphans) and nothing from
 * ReadScore 1.x (legacy/) is reachable or referenced.
 */
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('/src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const ENTRIES = ['/src/content/index.ts', '/src/background/sw.ts', '/src/ui/popup/popup.ts'];

function reachable(): Set<string> {
  const resolve = (from: string, spec: string): string | null => {
    const parts = from.split('/').slice(0, -1);
    for (const seg of spec.split('/')) seg === '..' ? parts.pop() : seg !== '.' && parts.push(seg);
    const base = parts.join('/');
    return [`${base}.ts`, `${base}/index.ts`].find((f) => f in sources) ?? null;
  };
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of sources[file]!.matchAll(/\bfrom\s+'(\.[^']+)'|\bimport\s+'(\.[^']+)'/g)) {
      const hit = resolve(file, m[1] ?? m[2]!);
      if (hit) visit(hit);
    }
  };
  ENTRIES.forEach(visit);
  return seen;
}

describe('production entry points', () => {
  it('every source module is reachable (no orphaned modules)', () => {
    const seen = reachable();
    expect(Object.keys(sources).filter((f) => !seen.has(f))).toEqual([]);
  });

  it('no source references ReadScore 1.x code or features', () => {
    for (const [file, src] of Object.entries(sources)) {
      expect(src, file).not.toMatch(/legacy\/|analyzer\.js|easyread|Summarizer|getPageText|showSummary/);
    }
  });
});
