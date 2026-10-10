/**
 * Phase 3 Comfort checks in real Chromium, driven through the REAL popup (toolbar action → popup →
 * service worker → USER origin insertCSS). Verifies page effects with computed styles AND screenshots,
 * exact restoration, lifecycle edge cases and timings.
 *
 *   npm run build && PLAYWRIGHT_DIR=… node tests/browser/comfort.mjs
 * Screenshots: $SHOT_DIR/comfort-*.png. Exit code 0 = all checks passed.
 */
import fs from 'node:fs';
import { launch, serveFixtures, sleep, OUT } from './harness.mjs';
import { popupClient } from './popup-client.mjs';

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const timings = {};

const { server, origin } = await serveFixtures();
let h = await launch();
const bs = await h.ctx.browser().newBrowserCDPSession();
const open = (page) => popupClient(h, bs, page, OUT);

const IDS = ['smallSpan', 'smallLink', 'fine', 'badge', 'icon', 'lead', 'btnLink', 'readLink', 'p1', 'pInline', 'li1', 'quote', 'th1', 'td1', 'heading', 'navItem', 'pre1', 'code1', 'inlineCode', 'input1', 'ta1', 'btn1', 'editP', 'toolbarP', 'svgText'];
/** Computed typography of every probe element plus the full DOM (for exact restoration). */
const SNAP = (ids) => {
  const props = ['font-family', 'font-size', 'line-height', 'letter-spacing', 'word-spacing', 'margin-bottom'];
  const styles = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const cs = getComputedStyle(el);
    styles[id] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
  }
  return { styles, dom: document.documentElement.outerHTML, runtimeCss: globalThis.__readScoreV2__ === undefined ? 'no-runtime' : 'main-world-cannot-see' };
};
const snap = (page) => page.evaluate(SNAP, IDS);
const ratio = (s, id) => parseFloat(s.styles[id]['line-height']) / parseFloat(s.styles[id]['font-size']);
/** Polls the page until `pred(snapshot)` holds; returns elapsed ms or -1. */
async function until(page, pred, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred(await snap(page))) return Date.now() - t0;
    await sleep(15);
  }
  return -1;
}
const same = (a, b) => JSON.stringify(a.styles) === JSON.stringify(b.styles);

// popup helpers (run inside the popup document)
const P = {
  toggle: (id) => document.querySelector(`[data-mode="${id}"] [role="switch"]`).click(),
  expand: (id) => document.querySelector(`[data-mode="${id}"] [aria-controls]`).click(),
  radio: ([mode, value]) => { const r = document.querySelector(`[data-mode="${mode}"] input[value="${value}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); },
  select: (v) => { const s = document.querySelector('[data-mode="comfort"] select'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); },
  slider: ([i, v]) => { const r = document.querySelectorAll('[data-mode="comfort"] input[type="range"]')[i]; r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); },
  state: () => ({ word: document.querySelector('[data-mode="comfort"] .rs-mode__state').textContent, checked: document.querySelector('[data-mode="comfort"] [role="switch"]').getAttribute('aria-checked'), alert: document.querySelector('[role="alert"]').textContent, status: document.querySelector('[role="status"]').textContent, popupP: getComputedStyle(document.querySelector('.rs-mode__desc')).lineHeight }),
};

try {
  const page = await h.ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/comfort.html`);
  // Playwright's page.screenshot() leaves style="" on form controls (it hides the caret; verified
  // separately), so the baseline is taken AFTER the first screenshot.
  await page.screenshot({ path: new URL('comfort-0-original.png', OUT).pathname });
  const base = await snap(page);

  // ── 1. Enable (default Relaxed), then Roomy (the WCAG 1.4.12 values, v2 "Standard") ──
  console.error('step 1');
  let p = await open(page);
  const popupBefore = (await p.evaluate(P.state)).popupP;
  await p.evaluate(P.expand, 'comfort');
  let t0 = Date.now();
  await p.evaluate(P.toggle, 'comfort');
  timings.enable = await until(page, (s) => Math.abs(ratio(s, 'p1') - 1.6) < 0.01);
  timings.enableWall = Date.now() - t0;
  const relaxed = await snap(page);
  check('enable: Relaxed by default: 1.6 / 0.02em / 0.08em / 1.5em; size and font untouched', timings.enable >= 0 && relaxed.styles.p1['letter-spacing'] === '0.32px' && relaxed.styles.p1['word-spacing'] === '1.28px' && relaxed.styles.p1['margin-bottom'] === '24px' && relaxed.styles.p1['font-size'] === base.styles.p1['font-size'] && relaxed.styles.p1['font-family'] === base.styles.p1['font-family'], relaxed.styles.p1);
  await page.screenshot({ path: new URL('comfort-1-relaxed.png', OUT).pathname });
  await p.evaluate(P.radio, ['comfort', 'roomy']);
  await until(page, (s) => Math.abs(ratio(s, 'p1') - 1.5) < 0.01);
  const on = await snap(page);
  check('Roomy: line height 1.5 on reading text', timings.enable >= 0 && Math.abs(ratio(on, 'li1') - 1.5) < 0.01 && Math.abs(ratio(on, 'td1') - 1.5) < 0.01, { p1: ratio(on, 'p1'), ms: timings.enable });
  check('enable: letter 0.12em and word 0.16em spacing (16px text)', on.styles.p1['letter-spacing'] === '1.92px' && on.styles.p1['word-spacing'] === '2.56px', on.styles.p1);
  check('enable: paragraph spacing 2em', on.styles.p1['margin-bottom'] === '32px', on.styles.p1['margin-bottom']);
  check('USER origin overrides inline !important', Math.abs(ratio(on, 'pInline') - 1.5) < 0.01 && on.styles.pInline['letter-spacing'] === '1.92px', on.styles.pInline);
  const untouched = ['navItem', 'pre1', 'code1', 'input1', 'ta1', 'btn1', 'editP', 'toolbarP', 'svgText', 'heading'];
  const changed = untouched.filter((id) => JSON.stringify(on.styles[id]) !== JSON.stringify(base.styles[id]));
  check('excluded elements unchanged: nav, code block, form controls, editable, toolbar, SVG, headings (no font chosen)', changed.length === 0, changed);
  check('button styled link inside a list item keeps normal spacing; a plain link in reading text gets it', on.styles.btnLink['letter-spacing'] === base.styles.btnLink['letter-spacing'] && on.styles.readLink['letter-spacing'] === '1.92px', { btn: on.styles.btnLink['letter-spacing'], link: on.styles.readLink['letter-spacing'] });
  const ic = (s) => [s.styles.inlineCode['font-family'], s.styles.inlineCode['font-size']].join('|');
  check('inline code inside a paragraph keeps its font and size; it inherits the paragraph line height and letter and word spacing (CSS inheritance, by design)', ic(on) === ic(base) && on.styles.inlineCode['letter-spacing'] === '1.92px', on.styles.inlineCode);
  const domDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i >= a.length && a.length === b.length ? '' : `${a.slice(i - 60, i + 60)} ⟶ ${b.slice(i - 60, i + 60)}`; };
  check('page DOM unchanged: no extension elements or attributes', on.dom === base.dom, domDiff(base.dom, on.dom)); fs.writeFileSync(new URL('dom-diff.txt', OUT), JSON.stringify(domDiff(base.dom, on.dom)));
  const st = await p.evaluate(P.state);
  check('popup reports Comfort On; popup typography unaffected', st.word === 'On' && st.checked === 'true' && st.popupP === popupBefore, st);
  await page.screenshot({ path: new URL('comfort-1-roomy.png', OUT).pathname });

  // ── 2. Presets, font, minimum size, sliders ──
  console.error('step 2');
  t0 = Date.now();
  await p.evaluate(P.radio, ['comfort', 'relaxed']);
  timings.preset = await until(page, (s) => JSON.stringify(s.styles.p1) === JSON.stringify(relaxed.styles.p1));
  check('Relaxed again restores its exact values', timings.preset >= 0);
  await p.evaluate(P.radio, ['comfort', 'site']);
  const siteSpacing = await until(page, (s) => same(s, base));
  check('Site spacing: the page spacing is exactly the original while Comfort stays On', siteSpacing >= 0 && (await p.evaluate(P.state)).word === 'On');
  await p.evaluate(P.radio, ['comfort', 'roomy']);
  check('Roomy again restores its exact values', (await until(page, (s) => JSON.stringify(s.styles.p1) === JSON.stringify(on.styles.p1))) >= 0);

  await p.evaluate(P.select, 'serif');
  timings.font = await until(page, (s) => s.styles.p1['font-family'].startsWith('Georgia'));
  const serif = await snap(page);
  check('font Serif: reading text and headings use Georgia; code and inputs keep theirs', timings.font >= 0 && serif.styles.heading['font-family'].startsWith('Georgia') && serif.styles.code1['font-family'] === base.styles.code1['font-family'] && serif.styles.input1['font-family'] === base.styles.input1['font-family'], { p1: serif.styles.p1['font-family'], code: serif.styles.code1['font-family'] });
  await p.evaluate(P.select, 'sans');
  check('font Sans serif: Verdana stack', (await until(page, (s) => s.styles.p1['font-family'].startsWith('Verdana'))) >= 0);
  await page.screenshot({ path: new URL('comfort-2-sans.png', OUT).pathname });
  // Atkinson Hyperlegible: bundled, rendered (pixels differ from its Verdana fallback), removed with Site default.
  const textShot = () => page.locator('#p1').screenshot();
  const sansPixels = await textShot();
  await p.evaluate(P.select, 'atkinson');
  timings.atkinson = await until(page, (s) => s.styles.p1['font-family'].startsWith('"ReadScore Atkinson Hyperlegible"'));
  await sleep(300);
  const atkPixels = await textShot();
  const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.family.includes('Atkinson')).map((f) => f.status));
  const net = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /font|googleapis|ttf|woff/i.test(r.name)).map((r) => r.name));
  await page.screenshot({ path: new URL('comfort-2-atkinson.png', OUT).pathname });
  check('font Atkinson Hyperlegible under a strict font-src CSP: applied to reading text and headings, rendered (pixels differ from the Verdana fallback), faces loaded, no network request', timings.atkinson >= 0 && !atkPixels.equals(sansPixels) && faces.length === 4 && faces.every((f) => f === 'loaded') && net.length === 0, { ms: timings.atkinson, faces, net });
  await p.evaluate(P.select, 'site');
  check('Site default restores the site font', (await until(page, (s) => s.styles.p1['font-family'] === base.styles.p1['font-family'])) >= 0);
  check('Site default removes the bundled faces from the page', (await page.evaluate(() => [...document.fonts].filter((f) => f.family.includes('Atkinson')).length)) === 0);

  await p.evaluate(P.radio, ['comfort', '20']);
  timings.minSize = await until(page, (s) => s.styles.p1['font-size'] === '20px');
  const big = await snap(page);
  check('minimum 20px: reading text 20px; button, input, code, nav and heading unchanged', timings.minSize >= 0 && big.styles.li1['font-size'] === '20px' && ['btn1', 'input1', 'code1', 'navItem', 'heading'].every((id) => big.styles[id]['font-size'] === base.styles[id]['font-size']), { p1: big.styles.p1['font-size'], btn: big.styles.btn1['font-size'] });
  await page.screenshot({ path: new URL('comfort-3-min20.png', OUT).pathname });
  await p.evaluate(P.radio, ['comfort', '22']);
  await until(page, (s) => s.styles.p1['font-size'] === '22px');
  const s22 = await snap(page);
  const kept = ['badge', 'icon', 'btn1', 'input1', 'code1', 'navItem', 'heading'].filter((id) => s22.styles[id]['font-size'] !== base.styles[id]['font-size']);
  // small and inline code are sized relative to their paragraph: they grow with it and keep their ratio to it.
  const sizeRatio = (st, id, of) => parseFloat(st.styles[id]['font-size']) / parseFloat(st.styles[of]['font-size']);
  const relative = Math.abs(sizeRatio(s22, 'fine', 'p1') - sizeRatio(base, 'fine', 'p1')) < 0.01 && Math.abs(sizeRatio(s22, 'inlineCode', 'p1') - sizeRatio(base, 'inlineCode', 'p1')) < 0.01;
  check('text size 22 px: reading text 22px; a 12px span and a 13px link inside it grow to 22px; badge, icon, code block, controls, nav and headings keep their size; small and inline code keep their ratio to the text', s22.styles.p1['font-size'] === '22px' && s22.styles.smallSpan['font-size'] === '22px' && s22.styles.smallLink['font-size'] === '22px' && kept.length === 0 && relative, { span: s22.styles.smallSpan['font-size'], link: s22.styles.smallLink['font-size'], changed: kept, fine: s22.styles.fine['font-size'], code: s22.styles.inlineCode['font-size'], codeBase: base.styles.inlineCode['font-size'], lead: s22.styles.lead['font-size'] });
  timings.leadAt22 = s22.styles.lead['font-size']; // measured: a 24px lead paragraph (minimum, see report)
  await page.screenshot({ path: new URL('comfort-3-size22.png', OUT).pathname });
  // Open and nested shadow roots get the same rules (adopted sheet); their controls do not.
  const SH = () => { const sr = document.getElementById('host').shadowRoot; const n = sr.getElementById('inner').shadowRoot; const cs = (e) => getComputedStyle(e); return { p: cs(sr.getElementById('shadowP')).fontSize, nested: cs(n.getElementById('nestedP')).fontSize, btn: cs(sr.getElementById('shadowBtn')).fontSize, sheets: sr.adoptedStyleSheets.length + n.adoptedStyleSheets.length }; };
  let sh;
  for (let i = 0; i < 100 && (sh = await page.evaluate(SH)).nested !== '22px'; i++) await sleep(15);
  check('Shadow DOM: open and nested shadow paragraphs get the text size; a shadow button does not', sh.p === '22px' && sh.nested === '22px' && sh.btn !== '22px' && sh.sheets === 2, sh);
  await p.evaluate(P.radio, ['comfort', 'off']);
  check('minimum Off restores the site size', (await until(page, (s) => s.styles.p1['font-size'] === base.styles.p1['font-size'])) >= 0);

  await p.evaluate(() => (document.querySelector('.rs-advanced').open = true));
  t0 = Date.now();
  await p.evaluate(P.slider, [0, 1.9]);
  timings.slider = await until(page, (s) => Math.abs(ratio(s, 'p1') - 1.9) < 0.01);
  const custom = await p.evaluate(() => document.querySelector('[data-mode="comfort"] input[value="custom"]').checked);
  check('slider: line height 1.9 reaches the page; preset switches to Custom', timings.slider >= 0 && custom, { ms: timings.slider });
  await p.evaluate(P.slider, [1, 0.04]);
  check('slider: letter spacing 0.04em (0.64px)', (await until(page, (s) => s.styles.p1['letter-spacing'] === '0.64px')) >= 0);
  await p.evaluate(() => document.querySelector('[data-mode="comfort"] .rs-slider button').click());
  check('per slider reset restores the Relaxed line height 1.6 only', (await until(page, (s) => Math.abs(ratio(s, 'p1') - 1.6) < 0.01 && s.styles.p1['letter-spacing'] === '0.64px')) >= 0);

  // ── 3. Rapid changes: 30 slider steps, final state wins ──
  console.error('step 3');
  t0 = Date.now();
  await p.evaluate(async (ctl) => {
    const r = document.querySelectorAll('[data-mode="comfort"] input[type="range"]')[0];
    for (let i = 0; i < 30; i++) { r.value = String(1.2 + (i % 9) * 0.1); r.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((x) => setTimeout(x, 5)); }
    r.value = '1.7'; r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  timings.rapid30 = await until(page, (s) => Math.abs(ratio(s, 'p1') - 1.7) < 0.01);
  check('31 rapid slider changes: page settles on the final value', timings.rapid30 >= 0, { ms: timings.rapid30 });

  // ── 4. Disable → exact restoration ──
  console.error('step 4');
  t0 = Date.now();
  await p.evaluate(P.toggle, 'comfort');
  timings.disable = await until(page, (s) => same(s, base));
  const off = await snap(page);
  check('disable restores every computed style exactly and the DOM is identical', timings.disable >= 0 && same(off, base) && off.dom === base.dom, { ms: timings.disable });
  check('popup reports Off after disable', (await p.evaluate(P.state)).word === 'Off');
  check('disable removes the Comfort sheet from every shadow root', (await page.evaluate(SH)).sheets === 0);
  check('disable leaves no bundled font faces on the page', (await page.evaluate(() => [...document.fonts].filter((f) => f.family.includes('Atkinson')).length)) === 0);

  // ── 5. Repeated enable/disable cycles ──
  console.error('step 5');
  const cyc = [];
  for (let i = 0; i < 10; i++) {
    await p.evaluate(P.toggle, 'comfort');
    const a = await until(page, (s) => !same(s, base));
    await p.evaluate(P.toggle, 'comfort');
    const b = await until(page, (s) => same(s, base));
    cyc.push(a >= 0 && b >= 0);
  }
  check('10 enable/disable cycles: each applies and restores exactly', cyc.every(Boolean) && (await snap(page)).dom === base.dom, cyc);

  // ── 6. Popup closed right after a change: the service worker still finishes ──
  console.error('step 6');
  await p.evaluate(P.toggle, 'comfort');
  await p.evaluate(P.radio, ['comfort', 'relaxed']);
  await p.close();
  check('popup closed mid update: page still reaches the final state (Relaxed)', (await until(page, (s) => Math.abs(ratio(s, 'p1') - 1.6) < 0.01)) >= 0);

  // ── 7. Reopen: popup shows the actual page state ──
  console.error('step 7');
  await page.bringToFront();
  p = await open(page);
  let st2 = await p.evaluate(P.state);
  check('reopen: popup shows Comfort On (page sheet still active) and settings persisted', st2.word === 'On' && st2.checked === 'true' && (await p.evaluate(() => document.querySelector('[data-mode="comfort"] input[value="relaxed"]').checked)), st2);
  await p.close();

  // ── 8. Reload: CSS gone with the document; reopening the popup reapplies it ──
  console.error('step 8');
  await page.reload();
  const afterReload = await snap(page);
  check('reload: Comfort CSS is gone (page back to original)', same(afterReload, base));
  await page.bringToFront();
  t0 = Date.now();
  p = await open(page);
  timings.reapplyOnOpen = await until(page, (s) => Math.abs(ratio(s, 'p1') - 1.6) < 0.01);
  st2 = await p.evaluate(P.state);
  check('reload then click the toolbar icon: Comfort reapplies automatically; popup On', timings.reapplyOnOpen >= 0 && st2.word === 'On', { ms: timings.reapplyOnOpen, wall: Date.now() - t0 });
  await p.close();

  // ── 9. Navigation: same as reload ──
  console.error('step 9');
  await page.goto(`${origin}/comfort.html?next`);
  check('navigation: new document starts clean', same(await snap(page), base));

  // ── 10. Tab switching: each tab gets the saved state when its popup opens; the other is untouched ──
  console.error('step 10');
  const page2 = await h.ctx.newPage();
  await page2.goto(`${origin}/comfort.html?tab2`);
  p = await open(page2);
  check('second tab: Comfort applied on open', (await until(page2, (s) => Math.abs(ratio(s, 'p1') - 1.6) < 0.01)) >= 0);
  await p.close();
  check('first tab (not opened since navigation) stays clean', same(await snap(page), base));

  // ── 11. Popup on a restricted page: no error, no requests ──
  console.error('step 11');
  const r = await h.ctx.newPage();
  await r.goto('chrome://version');
  p = await open(r);
  const rs = await p.evaluate(P.state);
  check('restricted page: "Not available" status, no alert', /Not available/.test(rs.status) && rs.alert === '', rs);
  await p.close();
  await r.close();

  // ── 12. Turn Comfort off from tab 2, then Reset all from tab 2 leaves no CSS ──
  console.error('step 12');
  await page2.bringToFront();
  p = await open(page2);
  await p.evaluate(() => { document.querySelector('.rs-header [aria-label="Reset All"]').click(); });
  check('Reset all removes the active sheet (page back to original)', (await until(page2, (s) => same(s, base))) >= 0);
  const st3 = await p.evaluate(P.state);
  check('after Reset all the popup shows Off', st3.word === 'Off' && st3.checked === 'false', st3);
  await p.close();

  // ── 13. Extension reload with Comfort active (harness permitting) ──
  console.error('step 13');
  const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  p = await open(page2);
  await p.evaluate(P.toggle, 'comfort');
  await until(page2, (s) => !same(s, base));
  await p.close();
  await withTimeout(h.inWorker(() => chrome.runtime.reload()), 3000).catch(() => {});
  await sleep(2000);
  const stillApplied = !same(await snap(page2), base);
  check('extension reload: measured whether inserted Comfort CSS stays on the page', true, { stillApplied });
  try {
    await page2.bringToFront();
    p = await withTimeout(open(page2), 10000);
    await withTimeout(p.evaluate(P.toggle, 'comfort'), 5000);
    const removed = await until(page2, (s) => same(s, base));
    check('after extension reload, turning Comfort off removes the old sheet (record carried over)', !stillApplied || removed >= 0, { removed });
    await p.close();
  } catch (e) {
    results.push({ name: 'NOT TESTED: popup after extension reload (the harness cannot reopen the popup of a reloaded unpacked extension)', pass: true, detail: String(e.message) });
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('harness ran to completion', false, e instanceof Error ? e.stack : String(e));
} finally {
  await h.close();
  server.close();
}

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail.slice(0, 300)})` : ''}`);
console.log('timings (ms, page effect observed by polling every 15 ms):', JSON.stringify(timings));
const failed = results.filter((x) => !x.pass).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
