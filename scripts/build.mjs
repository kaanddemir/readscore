// ReadScore 2.0 build: src/ → dist/ (load dist/ as an unpacked extension).
// Usage: node scripts/build.mjs [--watch]
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
// Release builds are byte-for-byte reproducible. Watch sessions still need a unique id so a newly
// built runtime can replace the previous injected runtime without reloading the tab.
const buildId = watch ? `${pkg.version}+dev.${Date.now().toString(36)}` : pkg.version;

const common = {
  bundle: true,
  target: 'chrome116',
  // Watch builds keep source maps for local debugging; release builds ship only executable assets.
  sourcemap: watch ? 'linked' : false,
  minify: false,
  logLevel: 'info',
  legalComments: 'none',
  define: { __BUILD_ID__: JSON.stringify(buildId) },
};

const entries = [
  // Injected with chrome.scripting.executeScript, so it must be a classic script.
  { entryPoints: [join(src, 'content/index.ts')], outfile: join(dist, 'content/runtime.js'), format: 'iife' },
  { entryPoints: [join(src, 'background/sw.ts')], outfile: join(dist, 'background/sw.js'), format: 'esm' },
  { entryPoints: [join(src, 'ui/popup/popup.ts')], outfile: join(dist, 'popup/popup.js'), format: 'esm' },
];

const staticFiles = [
  ['ui/popup/index.html', 'popup/index.html'],
  ['ui/popup/popup.css', 'popup/popup.css'],
  ['ui/shared/tokens.css', 'shared/tokens.css'],
];

async function copyStatic() {
  for (const [from, to] of staticFiles) {
    const target = join(dist, to);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(src, from), target);
  }
  // The manifest version always follows package.json, so the two can never drift.
  const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(join(root, 'icons'), join(dist, 'icons'), { recursive: true });
  // Atkinson Hyperlegible (SIL OFL 1.1): read by the popup and inserted as data URLs, never fetched by pages.
  await cp(join(root, 'fonts'), join(dist, 'fonts'), { recursive: true });
  await writeFile(join(dist, 'BUILD_ID'), `${buildId}\n`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (watch) {
  const contexts = await Promise.all(entries.map((e) => context({ ...common, ...e })));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log(`[build] watching (build ${buildId}). Static files are copied at start; restart after editing HTML/CSS/manifest.`);
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
  console.log(`[build] done → dist/ (build ${buildId})`);
}
