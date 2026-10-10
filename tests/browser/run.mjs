/**
 * Browser test runner: builds dist/ once, then runs the named suites in one process sequence and
 * prints a timed summary. Exit code 0 = every suite passed.
 *
 *   node tests/browser/run.mjs <suite|group> ...   [--no-build]
 *
 * Suites (local fixtures, no network):  smoke, popup-ui, focus, comfort, calm
 * Site sweeps (network):                focus-sites, comfort-sites, calm-sites
 * Groups:
 *   core    smoke + popup-ui (extension loads, injection, popup layout, a11y wiring)
 *   local   core + focus + comfort + calm (full local regression)
 *   sites   the three site sweeps (four routine sites unless SITE_SET=full)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const GROUPS = {
  core: ['smoke', 'popup-ui'],
  local: ['smoke', 'popup-ui', 'focus', 'comfort', 'calm'],
  sites: ['focus-sites', 'comfort-sites', 'calm-sites'],
};
const SUITES = new Set([...GROUPS.local, ...GROUPS.sites]);

const args = process.argv.slice(2);
const build = !args.includes('--no-build');
const names = args.filter((a) => !a.startsWith('--'));
if (!names.length) names.push('core');
const suites = [...new Set(names.flatMap((n) => GROUPS[n] ?? [n]))];
const unknown = suites.filter((s) => !SUITES.has(s));
if (unknown.length) {
  console.error(`Unknown suite(s): ${unknown.join(', ')}. Suites: ${[...SUITES].join(', ')}. Groups: ${Object.keys(GROUPS).join(', ')}.`);
  process.exit(2);
}
if (!process.env.PLAYWRIGHT_DIR) {
  console.error('Set PLAYWRIGHT_DIR to a directory containing the playwright package (see tests/browser/README.md).');
  process.exit(2);
}

if (build) {
  const b = spawnSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'ignore' });
  if (b.status !== 0) {
    console.error('build failed: run npm run build for details');
    process.exit(1);
  }
}

// One output directory per run, shared by every suite (see harness.mjs).
process.env.SHOT_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'readscore-browser-'));
console.log(`output: ${process.env.SHOT_DIR}`);

const summary = [];
for (const s of suites) {
  const t0 = Date.now();
  const r = spawnSync('node', [path.join(here, `${s}.mjs`)], { cwd: root, encoding: 'utf8', env: process.env });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const pass = (out.match(/^PASS/gm) ?? []).length;
  const fail = (out.match(/^FAIL/gm) ?? []).length;
  const ok = r.status === 0;
  summary.push({ suite: s, ok, pass, fail, s: Math.round((Date.now() - t0) / 100) / 10 });
  // Failures and the suite's last line only; screenshots and site JSON are in SHOT_DIR.
  for (const line of out.split('\n')) if (line.startsWith('FAIL') || line.startsWith('ERR')) console.log(`  [${s}] ${line}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${s.padEnd(14)} ${String(summary.at(-1).s).padStart(6)}s  ${out.trim().split('\n').findLast((l) => /check|DONE|passed|failed/.test(l)) ?? ''}`);
}
const total = summary.reduce((n, x) => n + x.s, 0);
const failed = summary.filter((x) => !x.ok);
console.log(`${failed.length ? `${failed.length} suite(s) failed` : `all ${summary.length} suite(s) passed`} in ${Math.round(total)}s`);
process.exit(failed.length ? 1 : 0);
