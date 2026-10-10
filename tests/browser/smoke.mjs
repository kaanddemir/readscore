/**
 * Phase 0 real-Chrome smoke check: the built extension loads, the popup injects the runtime through
 * the real toolbar action, re-injection is a no-op, the page DOM is untouched, and navigation disposes
 * the runtime. Exit code 0 = all checks passed.
 *
 *   npm run build && PLAYWRIGHT_DIR=… node tests/browser/smoke.mjs
 */
import { launch, serveFixtures, sleep } from './harness.mjs';

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

const { server, origin } = await serveFixtures();
const h = await launch();
try {
  const page = await h.ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/article.html`);
  const domBefore = await page.evaluate(() => document.documentElement.outerHTML);

  const manifest = await h.inWorker(() => chrome.runtime.getManifest());
  check('extension loads (MV3 service worker running)', manifest.manifest_version === 3, `v${manifest.version}`);

  const popup = await h.clickAction(page);
  check('toolbar action opens the 2.0 popup', popup, popup?.url);
  await sleep(500);

  const tabId = await h.inWorker(async (url) => (await chrome.tabs.query({ url })).at(0)?.id, page.url());
  const ping = await h.inWorker((id) => chrome.tabs.sendMessage(id, { rs: 'rs2', type: 'PING', payload: null }, { frameId: 0 }).catch((e) => String(e)), tabId);
  check('popup injected the runtime; it answers PING', ping?.ok === true, JSON.stringify(ping));

  const state = await h.inWorker((id) => chrome.tabs.sendMessage(id, { rs: 'rs2', type: 'GET_STATE', payload: null }), tabId);
  check('no mode is active by default', state?.ok && state.data.activeModes.length === 0, JSON.stringify(state?.data));

  const legacy = await h.inWorker((id) => chrome.tabs.sendMessage(id, { action: 'analyze' }).then((r) => r ?? null).catch(() => 'no-answer'), tabId);
  check('1.x messages get no answer (no 1.x runtime)', legacy === null || legacy === 'no-answer', JSON.stringify(legacy));

  // Re-injection guard: mark the live handle, inject the same build again, the mark must survive.
  await h.inWorker((id) =>
    chrome.scripting.executeScript({ target: { tabId: id }, func: () => void (globalThis.__readScoreV2__.mark = 1) }), tabId);
  await h.inWorker((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['content/runtime.js'] }), tabId);
  const marked = await h.inWorker((id) =>
    chrome.scripting.executeScript({ target: { tabId: id }, func: () => globalThis.__readScoreV2__?.mark ?? null }).then((r) => r[0]?.result), tabId);
  check('re-injecting the same build is a no-op', marked === 1, `mark=${marked}`);

  const domAfter = await page.evaluate(() => document.documentElement.outerHTML);
  check('page DOM untouched by the runtime', domAfter === domBefore);

  await page.goto(`${origin}/article.html?next`);
  await sleep(300);
  const after = await h.inWorker((id) => chrome.tabs.sendMessage(id, { rs: 'rs2', type: 'PING', payload: null }).then(() => 'answered').catch(() => 'gone'), tabId);
  check('navigation disposes the runtime', after === 'gone', after);

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('harness ran to completion', false, e instanceof Error ? e.message : String(e));
} finally {
  await h.close();
  server.close();
}

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
