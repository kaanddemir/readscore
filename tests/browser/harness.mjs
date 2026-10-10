/**
 * Real-Chrome harness (dev-only; not part of the build or `npm test`).
 *
 * Loads dist/ as an unpacked extension via Playwright, serves fixtures/ over http://127.0.0.1, and
 * presses the REAL toolbar action through CDP (Extensions.triggerAction), which grants activeTab and
 * opens the popup exactly like a user click. Pattern adapted from HeatGrid's tests/browser/harness.mjs.
 *
 * Needs (not project dependencies):
 *   PLAYWRIGHT_DIR  directory containing the `playwright` package (e.g. an npx cache)
 *   CHROME_PATH     optional: Chrome for Testing / Chromium (default: Playwright's full bundled Chromium,
 *                   installed with `npx playwright install chromium`; branded Google Chrome ignores
 *                   --load-extension)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.resolve(here, '../../dist');
// Screenshots and JSON results: SHOT_DIR when set (run.mjs sets one per run), else a fresh OS temp directory.
const outDir = process.env.SHOT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'readscore-browser-'));
fs.mkdirSync(outDir, { recursive: true });
export const OUT = pathToFileURL(path.join(outDir, '/'));
const FIXTURES = path.join(here, 'fixtures');

if (!process.env.PLAYWRIGHT_DIR) {
  console.error('Set PLAYWRIGHT_DIR to a directory containing the playwright package.');
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.PLAYWRIGHT_DIR, 'playwright'));

/**
 * The sites a sweep visits. Routine runs (default) visit four representative sites; SITE_SET=full
 * visits the script's whole list (release checks); SITES=name=url,... overrides both.
 */
export const ROUTINE_SITES = /^(heykaan|wikipedia|github-readme|youtube|video-youtube|youtube-dynamic)$/;
export function siteList(full) {
  if (process.env.SITES) return process.env.SITES.split(',').map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]);
  return process.env.SITE_SET === 'full' ? full : full.filter(([name]) => ROUTINE_SITES.test(name));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function serveFixtures() {
  const server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, path.normalize(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''));
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) return void ((res.statusCode = 404), res.end());
    res.setHeader('content-type', 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

/** `extraArgs` and `contextOptions` let asset scripts map a demo hostname and set the viewport. */
export async function launch({ extraArgs = [], contextOptions = {} } = {}) {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error('dist/ is missing: run npm run build first');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'rs-check-')), {
    headless: true,
    // Full Chromium, not the headless shell: the shell cannot load extensions.
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--enable-unsafe-extension-debugging', ...extraArgs],
    ...contextOptions,
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const bs = await ctx.browser().newBrowserCDPSession();
  const targets = async () => (await bs.send('Target.getTargets', { filter: [{}] })).targetInfos;

  return {
    ctx,
    extId,
    sw: () => ctx.serviceWorkers().find((w) => w.url().includes(extId)) ?? sw,
    /** Presses the toolbar icon for `page` (grants activeTab, opens the popup). Returns the popup URL target, if any. */
    async clickAction(page) {
      const tab = (await targets()).find((t) => t.type === 'tab' && t.url === page.url());
      if (!tab) throw new Error(`no tab target for ${page.url()}`);
      // A click right after launch can be dropped; a user would click again, and so does the harness.
      for (let attempt = 0; attempt < 3; attempt++) {
        await bs.send('Extensions.triggerAction', { id: extId, targetId: tab.targetId });
        for (let i = 0; i < 30; i++) {
          const popup = (await targets()).find((t) => t.url.startsWith(`chrome-extension://${extId}/popup/`));
          if (popup) return popup;
          await sleep(100);
        }
      }
      return null;
    },
    /** Runs `fn(tabId)` in the extension service worker (where activeTab grants apply). */
    inWorker: (fn, arg) => ctx.serviceWorkers().find((w) => w.url().includes(extId)).evaluate(fn, arg),
    async close() {
      await ctx.close();
    },
  };
}
