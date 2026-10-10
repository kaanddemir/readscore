/**
 * Phase 5 Focus sweep on real websites (needs network), driven through the REAL popup.
 * Per site: Focus on (Keyboard) → paint verified with pixels, J/K steps and reading order sample, UI
 * exclusion on the visited paragraphs, typing in a site field, Esc pause and J resume, Follow scroll,
 * dynamic content stats, Focus with Comfort and Calm, then Focus off with a cleanup check.
 *
 *   npm run build && PLAYWRIGHT_DIR=… node tests/browser/focus-sites.mjs   (SITES=name=url,... to override)
 * Output: $SHOT_DIR/focus-sites.json and focus-site-<name>.png
 */
import fs from 'node:fs';
import { launch, sleep, siteList, OUT } from './harness.mjs';
import { popupClient } from './popup-client.mjs';
import { colorShare } from './png.mjs';

const TINT = { yellow: [255, 236, 163], blue: [207, 226, 255], green: [206, 240, 212], dark: [32, 34, 38] };
const FG = { yellow: [26, 26, 26], blue: [11, 31, 58], green: [14, 42, 22], dark: [244, 244, 245] };
const SITES = siteList([
  ['heykaan', 'https://heykaan.dev/'],
  ['wikipedia', 'https://en.wikipedia.org/wiki/Dyslexia'],
  ['bbc', 'pick:https://www.bbc.com/news|/news/articles/'],
  ['mdn', 'https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API'],
  ['python-docs', 'https://docs.python.org/3/tutorial/introduction.html'],
  ['react-docs', 'https://react.dev/learn/thinking-in-react'],
  ['github-readme', 'https://github.com/microsoft/vscode'],
  ['github-issue', 'https://github.com/microsoft/vscode/issues/1'],
  ['hackernews', 'pick:https://news.ycombinator.com/|item\\?id='],
  ['govuk', 'https://www.gov.uk/browse/driving/driving-licences'],
  ['w3c-wcag', 'https://www.w3.org/TR/WCAG22/'],
  ['youtube', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
  ['msn-shadow', 'https://www.msn.com/en-us'],
]);

const CUR = () => {
  const hl = [...CSS.highlights.keys()].map((k) => CSS.highlights.get(k))[0];
  if (!hl) return null;
  const r = [...hl][0];
  let n = r.commonAncestorContainer;
  if (n.nodeType !== 1) n = n.parentElement;
  const b = r.getBoundingClientRect(); // the painted text, not the element box (display: contents, etc.)
  const closestDeep = (el, sel) => { for (let c = el; c; ) { const h = c.closest(sel); if (h) return h; const root = c.getRootNode(); c = root instanceof ShadowRoot ? root.host : null; } return null; };
  const hf = closestDeep(n, 'header, footer');
  const ui = !!closestDeep(n, 'nav, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], form, dialog, [role="dialog"], pre, code') || (!!hf && !closestDeep(hf, 'article, main, [role="main"]'));
  return { text: n.textContent.replace(/\s+/g, ' ').trim().slice(0, 40), tag: n.localName, top: b.top, bottom: b.bottom, x: b.x, width: b.width, tint: [...CSS.highlights.keys()][0].replace('rs-focus-', ''), inShadow: n.getRootNode() !== document, ui, color: getComputedStyle(n).color };
};
const cur = (page) => page.evaluate(CUR);
const hlCount = (page) => page.evaluate(() => CSS.highlights.size);
async function tintIn(page) {
  await page.evaluate(() => { const hl = [...CSS.highlights.keys()].map((k) => CSS.highlights.get(k))[0]; const n = hl && [...hl][0].commonAncestorContainer; const e = n && (n.nodeType === 1 ? n : n.parentElement); const r = e?.getBoundingClientRect(); if (r && (r.top < 0 || r.bottom > innerHeight)) e.scrollIntoView({ block: 'center', behavior: 'instant' }); });
  await sleep(150);
  const c = await cur(page);
  if (!c) return 0;
  const vh = await page.evaluate(() => innerHeight);
  const y = Math.max(0, c.top), bottom = Math.min(vh, c.bottom);
  if (bottom - y < 4 || c.width < 4) return 0;
  return colorShare(await page.screenshot({ clip: { x: Math.max(0, c.x), y, width: Math.min(c.width, 1280 - Math.max(0, c.x)), height: bottom - y } }), TINT[c.tint]);
}
const contrast = (color, tint) => {
  const lum = (c) => { const ch = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
  const fg = color.match(/[\d.]+/g).slice(0, 3).map(Number);
  const [a, b] = [lum(fg), lum(tint)].sort((x, y) => y - x);
  return Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10;
};
const P = {
  focus: () => document.querySelector('[data-mode="focus"] [role="switch"]').click(),
  comfort: () => document.querySelector('[data-mode="comfort"] [role="switch"]').click(),
  calm: () => document.querySelector('[data-mode="calm"] [role="switch"]').click(),
  move: (v) => { const r = document.querySelector(`[data-mode="focus"] input[value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); },
  state: () => ({ word: document.querySelector('[data-mode="focus"] .rs-mode__state').textContent, status: document.querySelector('[role="status"]').textContent, alert: document.querySelector('[role="alert"]').textContent }),
};

const h = await launch();
const bs = await h.ctx.browser().newBrowserCDPSession();
const rsState = () => h.inWorker(async () => {
  for (const t of await chrome.tabs.query({})) {
    try {
      const res = await chrome.tabs.sendMessage(t.id, { rs: 'rs2', type: 'GET_STATE', payload: null }, { frameId: 0 });
      if (res?.ok) return res.data;
    } catch {
      // no runtime
    }
  }
  return null;
});
const results = [];
for (const [name, spec] of SITES) {
  const r = { name, ok: false };
  results.push(r);
  const page = await h.ctx.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 80)));
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
    await page.waitForTimeout(Number(process.env.WAIT ?? 4000));
    r.title = (await page.title()).slice(0, 60);
    const errBefore = errors.length;

    let p = await popupClient(h, bs, page, OUT);
    const t0 = Date.now();
    await p.evaluate(P.focus);
    await sleep(500);
    r.enableWallMs = Date.now() - t0;
    r.popup = await p.evaluate(P.state);
    let st = await rsState();
    r.blocks = st?.focus?.blocks;
    r.scope = st?.focus?.stats?.scope;
    r.detectMs = st?.focus?.stats?.detectMs;
    r.highlightMs = st?.focus?.stats?.highlightMsMax;
    const c0 = await cur(page);
    r.start = c0 && { text: c0.text, tag: c0.tag, inShadow: c0.inShadow };
    r.tint = await tintIn(page);
    r.paintVerified = r.tint > 2;
    if (c0) r.contrast = contrast(`rgb(${FG[c0.tint].join(',')})`, TINT[c0.tint]);
    await page.screenshot({ path: new URL(`focus-site-${name}.png`, OUT).pathname });
    // J/K: 25 steps; reading order sample; UI exclusion on every visited paragraph.
    const visited = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('j');
      const c = await cur(page);
      if (c) visited.push(c);
    }
    r.jSteps = new Set(visited.map((v) => v.text)).size;
    if (name === 'heykaan') {
      // Every Skills & Expertise row (term + value) must be reachable with J/K.
      for (let i = 0; i < 60; i++) await page.keyboard.press('k');
      const all = [];
      for (let i = 0, last = null; i < 80; i++) {
        const c = await cur(page);
        if (!c || c.text === last) break;
        all.push((last = c.text));
        await page.keyboard.press('j');
      }
      r.skills = ['Programming & Databases', 'Data Analytics & Visualization', 'Web', 'Cloud & Tools'].map((t) => all.some((x) => x.startsWith(t)));
      r.skillsOk = r.skills.every(Boolean);
      r.allBlocks = all;
    }
    r.order = visited.slice(0, 4).map((v) => `${v.tag}:${v.text.slice(0, 24)}`);
    r.uiVisited = visited.filter((v) => v.ui).map((v) => `${v.tag}:${v.text.slice(0, 30)}`);
    r.visibleAfterJ = visited.length ? (() => { const v = visited.at(-1); return v.top >= -2 && v.bottom <= 722; })() : null;
    const beforeK = visited.at(-1)?.text;
    await page.keyboard.press('k');
    r.kWorks = (await cur(page))?.text !== beforeK;
    st = await rsState();
    r.stepMsMax = st?.focus?.stats?.stepMsMax;
    // Typing in a site field.
    const field = await page.evaluate(() => {
      const f = [...document.querySelectorAll('input[type="search"], input[type="text"], input:not([type]), textarea')].find((e) => { const b = e.getBoundingClientRect(); return b.width > 20 && b.height > 10 && !e.disabled && !e.readOnly && getComputedStyle(e).visibility !== 'hidden'; });
      if (!f) return null;
      f.setAttribute('data-rs-test', '1');
      return true;
    });
    if (field) {
      const hlBefore = (await cur(page))?.text;
      await page.focus('[data-rs-test]').catch(() => {});
      await page.keyboard.type('jk');
      const v = await page.evaluate(() => { const f = document.querySelector('[data-rs-test]'); const val = f.value; f.value = ''; f.removeAttribute('data-rs-test'); f.blur(); return val; });
      r.typing = { typed: v?.includes('jk'), focusMoved: (await cur(page))?.text !== hlBefore };
    } else r.typing = 'no visible text field';
    await page.keyboard.press('Escape');
    await sleep(80);
    r.escPauses = (await hlCount(page)) === 0;
    await page.keyboard.press('j');
    await sleep(50);
    r.jResumes = (await hlCount(page)) === 1;
    // Follow scroll.
    await p.evaluate(P.move, 'scroll');
    // Start a fifth of the way down, so the page end (footer, no text at the middle) does not skew it.
    await page.evaluate(() => scrollTo({ top: (document.scrollingElement.scrollHeight - innerHeight) * 0.2, behavior: 'instant' }));
    await sleep(200);
    // Distance (px) from the reading line to the highlighted text after each scroll (0 = crossing it), and
    // whether the highlight moved: the nearest paragraph can be far when an image or code sits at the middle.
    const dist = [];
    let moved = 0;
    for (const dy of [500, 700, -300]) {
      const prev = (await cur(page))?.text;
      await page.mouse.move(640, 360);
      await page.mouse.wheel(0, dy);
      await sleep(250);
      const c = await cur(page);
      dist.push(c ? (c.top <= 360 && c.bottom >= 360 ? 0 : Math.round(Math.min(Math.abs(c.top - 360), Math.abs(c.bottom - 360)))) : null);
      if (c && c.text !== prev) moved++;
    }
    r.followTracked = `${dist.filter((d) => d === 0).length}/3 crossing, distances ${dist.join(',')}, moved ${moved}/3`;
    // Dynamic content over 5 s (sites keep mutating).
    await sleep(5000);
    st = await rsState();
    const s = st?.focus?.stats ?? {};
    r.follow = { frames: s.followFrames, msMax: s.followMsMax, msAvg: s.followFrames ? Math.round((s.followMsTotal / s.followFrames) * 100) / 100 : null };
    r.dynamic = { mutationBatches: s.mutationBatches, rescans: s.rescans, rescanMsMax: s.rescanMsMax, blocksNow: st?.focus?.blocks, stillActive: st?.focus?.status };
    await p.evaluate(P.move, 'keyboard');
    // With Comfort and Calm.
    await p.evaluate(P.comfort);
    await p.evaluate(P.calm);
    await sleep(500);
    r.withComfortCalm = { tint: await tintIn(page), word: (await p.evaluate(P.state)).word };
    await p.evaluate(P.comfort);
    await p.evaluate(P.calm);
    await sleep(300);
    // Off: cleanup.
    await p.evaluate(P.focus);
    await sleep(400);
    r.cleanup = { highlights: await hlCount(page), state: (await rsState())?.focus ?? null };
    r.pageErrorsDuringFocus = errors.length - errBefore;
    await p.close();
    r.ok = true;
  } catch (e) {
    r.error = String(e?.message ?? e).split('\n')[0].slice(0, 160);
  } finally {
    await page.close().catch(() => {});
  }
  console.log(r.ok ? `DONE ${name} st=${r.status} word=${r.popup?.word} blocks=${r.blocks} scope=${r.scope} detect=${r.detectMs}ms paint=${r.paintVerified}(${r.tint}%) contrast=${r.contrast} start=${JSON.stringify(r.start?.text)} jSteps=${r.jSteps} k=${r.kWorks} ui=${r.uiVisited.length} typing=${JSON.stringify(r.typing)} esc=${r.escPauses} resume=${r.jResumes} follow=${r.followTracked} ${JSON.stringify(r.follow)} dyn=${JSON.stringify(r.dynamic)} combo=${JSON.stringify(r.withComfortCalm)} cleanup=${JSON.stringify(r.cleanup)} errs=${r.pageErrorsDuringFocus}` : `ERR  ${name} ${r.error}`);
}
fs.writeFileSync(new URL('focus-sites.json', OUT), JSON.stringify(results, null, 2));
await h.close();
