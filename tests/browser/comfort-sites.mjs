/**
 * Phase 3 Comfort sweep on real websites (needs network), driven through the REAL popup.
 * Per site: Standard, then Roomy + Serif + 20px minimum, then off. Measures applied share, excluded
 * elements, page height, new horizontal overflow, newly clipped text containers and exact restoration
 * (with a natural drift control: the page is sampled twice before Comfort is enabled).
 *
 *   npm run build && PLAYWRIGHT_DIR=… node tests/browser/comfort-sites.mjs
 * Output: $SHOT_DIR/comfort-sites.json and comfort-site-<name>-*.png
 */
import fs from 'node:fs';
import { launch, sleep, siteList, OUT } from './harness.mjs';
import { popupClient } from './popup-client.mjs';

const SITES = siteList([
  ['heykaan', 'https://heykaan.dev/'],
  ['wikipedia', 'https://en.wikipedia.org/wiki/Typography'],
  ['shadow-msn', 'https://www.msn.com/en-us'],
  ['docs-mdn', 'https://developer.mozilla.org/en-US/docs/Web/CSS/letter-spacing'],
  ['docs-python', 'https://docs.python.org/3/tutorial/controlflow.html'],
  ['github-readme', 'https://github.com/mozilla/readability'],
  ['github-issue', 'https://github.com/mozilla/readability/issues/1'],
  ['news-bbc', 'pick:https://www.bbc.com/news|/news/articles/'],
  ['news-guardian', 'pick:https://www.theguardian.com/science|/science/\\d{4}/'],
  ['hackernews', 'https://news.ycombinator.com/item?id=8863'],
  ['spa-react', 'https://react.dev/learn/thinking-in-react'],
  ['gov-uk-form', 'https://www.gov.uk/contact-electoral-registration-office'],
  ['w3c-wcag', 'https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html'],
  ['youtube-dynamic', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'],
]);

/** Runs in the page: typography of up to 80 reading elements and 40 excluded ones, plus layout signals. */
const MEASURE = () => {
  const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const pick = (sel, n) => [...document.querySelectorAll(sel)].filter(vis).slice(0, n);
  const EXCL = 'pre, pre *, code, kbd, samp, textarea, input, select, button, [contenteditable], [contenteditable] *, svg, svg *, nav *, [role="navigation"] *, [role="menu"] *, [role="menubar"] *, [role="toolbar"] *, [role="tablist"] *';
  const text = pick('p, li, dd, td', 400).filter((e) => !e.matches(EXCL) && (e.textContent ?? '').trim().length > 20).slice(0, 80);
  const excluded = pick('pre, code, input, textarea, select, button, nav li', 40).filter((e) => !e.closest('p, li, dd, dt, td, th, blockquote, figcaption') || e.matches('nav li'));
  const css = (e) => { const s = getComputedStyle(e); return [s.fontFamily, s.fontSize, s.lineHeight, s.letterSpacing, s.wordSpacing, s.marginBottom].join('|'); };
  const clipped = new Set();
  for (const t of text) for (let c = t, i = 0; c && i < 4; c = c.parentElement, i++) {
    const s = getComputedStyle(c);
    if (/(hidden|clip)/.test(s.overflowY + s.overflowX) && (c.scrollHeight > c.clientHeight + 2 || c.scrollWidth > c.clientWidth + 2)) clipped.add(`${c.tagName}.${c.className}`.slice(0, 60));
  }
  const ratio = (e) => { const s = getComputedStyle(e); return parseFloat(s.lineHeight) / parseFloat(s.fontSize); };
  return {
    textStyles: text.map(css),
    excludedStyles: excluded.map(css),
    ratios: text.map(ratio),
    fonts: text.map((e) => getComputedStyle(e).fontFamily),
    sizes: text.map((e) => parseFloat(getComputedStyle(e).fontSize)),
    height: document.documentElement.scrollHeight,
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    clipped: [...clipped],
  };
};
const P = {
  toggle: () => document.querySelector('[data-mode="comfort"] [role="switch"]').click(),
  radio: (v) => { const r = document.querySelector(`[data-mode="comfort"] input[value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); },
  select: (v) => { const s = document.querySelector('[data-mode="comfort"] select'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); },
  state: () => ({ word: document.querySelector('[data-mode="comfort"] .rs-mode__state').textContent, alert: document.querySelector('[role="alert"]').textContent }),
};

const h = await launch();
const bs = await h.ctx.browser().newBrowserCDPSession();
const results = [];
for (const [name, spec] of SITES) {
  const r = { name, ok: false };
  results.push(r);
  const page = await h.ctx.newPage();
  page.setDefaultTimeout(20000);
  try {
    let url = spec;
    if (spec.startsWith('pick:')) {
      const [index, pattern] = spec.slice(5).split('|');
      await page.goto(index, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      url = await page.evaluate((src) => [...document.querySelectorAll('a[href]')].map((a) => a.href).find((u) => new RegExp(src).test(u)) ?? null, pattern);
      if (!url) throw new Error('no article link');
    }
    r.url = url;
    r.status = (await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }))?.status();
    await page.waitForTimeout(3500);
    r.title = (await page.title()).slice(0, 60);
    await page.screenshot({ path: new URL(`comfort-site-${name}-0.png`, OUT).pathname });
    const m0 = await page.evaluate(MEASURE);
    await page.waitForTimeout(800);
    const m0b = await page.evaluate(MEASURE);
    r.naturalDrift = m0.textStyles.join() !== m0b.textStyles.join();
    r.sampled = m0.textStyles.length;

    const p = await popupClient(h, bs, page, OUT);
    let t = Date.now();
    await p.evaluate(P.toggle);
    await sleep(250);
    r.enableMs = Date.now() - t;
    const m1 = await page.evaluate(MEASURE);
    r.relaxedApplied = Math.round((m1.ratios.filter((x) => Math.abs(x - 1.6) < 0.02).length / Math.max(1, m1.ratios.length)) * 100);
    r.excludedChanged = m1.excludedStyles.filter((s, i) => s !== m0b.excludedStyles[i]).length + '/' + m1.excludedStyles.length;
    r.heightPct = Math.round(((m1.height - m0b.height) / m0b.height) * 100);
    r.newHOverflow = !m0b.hOverflow && m1.hOverflow;
    r.newClipped = m1.clipped.filter((c) => !m0b.clipped.includes(c));
    r.popup = await p.evaluate(P.state);
    await page.screenshot({ path: new URL(`comfort-site-${name}-1-relaxed.png`, OUT).pathname });

    await p.evaluate(P.radio, 'roomy');
    await p.evaluate(P.select, 'atkinson');
    await p.evaluate(P.radio, '22');
    await sleep(800);
    const m2 = await page.evaluate(MEASURE);
    r.roomyApplied = Math.round((m2.ratios.filter((x) => Math.abs(x - 1.5) < 0.02).length / Math.max(1, m2.ratios.length)) * 100);
    // Rendered, not only declared: the bundled faces are loaded (a page CSP must not block them).
    r.facesLoaded = await page.evaluate(() => [...document.fonts].filter((f) => f.family.includes('Atkinson') && f.status === 'loaded').length);
    r.serifApplied = Math.round((m2.fonts.filter((f) => f.startsWith('"ReadScore Atkinson')).length / Math.max(1, m2.fonts.length)) * 100);
    r.min20Applied = Math.round((m2.sizes.filter((s) => s >= 21.99).length / Math.max(1, m2.sizes.length)) * 100);
    // Reading text inside open shadow roots (one level and nested): share that got the Atkinson font.
    r.shadow = await page.evaluate(() => {
      const roots = [];
      const walk = (root) => { for (const e of root.querySelectorAll('*')) if (e.shadowRoot) (roots.push(e.shadowRoot), walk(e.shadowRoot)); };
      walk(document);
      const ps = roots.flatMap((sr) => [...sr.querySelectorAll('p')]).filter((p) => p.textContent.trim().length > 20 && p.getClientRects().length);
      return { roots: roots.length, paragraphs: ps.length, atkinson: ps.filter((p) => getComputedStyle(p).fontFamily.startsWith('"ReadScore Atkinson')).length };
    });
    r.max20HeightPct = Math.round(((m2.height - m0b.height) / m0b.height) * 100);
    r.max20NewClipped = m2.clipped.filter((c) => !m0b.clipped.includes(c));
    r.max20ExcludedChanged = m2.excludedStyles.filter((s, i) => s !== m0b.excludedStyles[i]).length;
    await page.screenshot({ path: new URL(`comfort-site-${name}-2-roomy-atkinson-22.png`, OUT).pathname });

    t = Date.now();
    await p.evaluate(P.toggle);
    await sleep(250);
    r.disableMs = Date.now() - t;
    const m3 = await page.evaluate(MEASURE);
    r.restored = m3.textStyles.join() === m0b.textStyles.join() && m3.excludedStyles.join() === m0b.excludedStyles.join();
    r.restoredHeight = Math.abs(m3.height - m0b.height) <= 2;
    // reset the saved choices for the next site
    await p.evaluate(P.radio, 'relaxed');
    await p.evaluate(P.select, 'site');
    await p.evaluate(P.radio, 'off');
    await sleep(200);
    await p.close();
    r.ok = true;
  } catch (e) {
    r.error = String(e?.message ?? e).split('\n')[0].slice(0, 160);
  } finally {
    await page.close().catch(() => {});
  }
  console.log(r.ok ? `DONE ${name} status=${r.status} n=${r.sampled} relaxed=${r.relaxedApplied}% roomy=${r.roomyApplied}% atkinson=${r.serifApplied}% faces=${r.facesLoaded} size22=${r.min20Applied}% shadow=${JSON.stringify(r.shadow)} excl=${r.excludedChanged} h=${r.heightPct}%/${r.max20HeightPct}% clip=${r.newClipped.length}/${r.max20NewClipped.length} restored=${r.restored} drift=${r.naturalDrift} popup=${r.popup.word}` : `ERR  ${name} ${r.error}`);
}
fs.writeFileSync(new URL('comfort-sites.json', OUT), JSON.stringify(results, null, 2));
await h.close();
