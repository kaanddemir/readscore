/**
 * Phase 5 Focus checks in real Chromium, driven through the REAL popup (toolbar action → popup →
 * runtime + service worker). The highlight is verified with screenshot PIXELS (the tint colour), not
 * computed styles: Phase 1 showed styles can be reported without being painted.
 *
 *   npm run build && PLAYWRIGHT_DIR=… node tests/browser/focus.mjs
 * Screenshots: $SHOT_DIR/focus-*.png. Exit code 0 = all checks passed.
 */
import fs from 'node:fs';
import { launch, serveFixtures, sleep, OUT } from './harness.mjs';
import { popupClient } from './popup-client.mjs';
import { colorShare } from './png.mjs';

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const timings = {};
const TINT = { yellow: [255, 236, 163], blue: [207, 226, 255], green: [206, 240, 212], dark: [32, 34, 38] };
const FG = { yellow: [26, 26, 26], blue: [11, 31, 58], green: [14, 42, 22], dark: [244, 244, 245] };

const { server, origin } = await serveFixtures();
const h = await launch();
const bs = await h.ctx.browser().newBrowserCDPSession();
const open = (page) => popupClient(h, bs, page, OUT);

// ── page side probes (main world: the highlight registry is shared with the extension's world) ──
const CUR = () => {
  const hl = [...CSS.highlights.keys()].map((k) => CSS.highlights.get(k))[0];
  if (!hl) return null;
  const r = [...hl][0];
  let n = r.commonAncestorContainer;
  if (n.nodeType !== 1) n = n.parentElement;
  const b = r.getBoundingClientRect(); // the painted text, not the element box (display: contents, etc.)
  return { text: n.textContent.replace(/\s+/g, ' ').trim().slice(0, 48), id: n.id, expect: n.getAttribute('data-expect'), top: b.top, bottom: b.bottom, x: b.x, width: b.width, tint: [...CSS.highlights.keys()][0].replace('rs-focus-', ''), inShadow: n.getRootNode() !== document, collapsed: r.collapsed };
};
const cur = (page) => page.evaluate(CUR);
const hlCount = (page) => page.evaluate(() => CSS.highlights.size);
/** Runtime state through the service worker (GET_STATE), for stats. */
const rsState = async (page) => {
  // Only one fixture tab is open at a time: ask every tab, keep the one whose runtime answers.
  const r = await h.inWorker(async () => {
    for (const t of await chrome.tabs.query({})) {
      try {
        const res = await chrome.tabs.sendMessage(t.id, { rs: 'rs2', type: 'GET_STATE', payload: null }, { frameId: 0 });
        if (res?.ok) return res;
      } catch {
        // no runtime in this tab
      }
    }
    return null;
  });
  return r?.data;
};
/** Tint share (%) inside the highlighted block's visible box. */
async function tintIn(page, tint) {
  // Bring the highlighted paragraph on screen first (reflows from Comfort can move it).
  await page.evaluate(() => { const hl = [...CSS.highlights.keys()].map((k) => CSS.highlights.get(k))[0]; const n = hl && [...hl][0].commonAncestorContainer; const e = n && (n.nodeType === 1 ? n : n.parentElement); const r = e?.getBoundingClientRect(); if (r && (r.top < 0 || r.bottom > innerHeight)) e.scrollIntoView({ block: 'center' }); });
  const c = await cur(page);
  if (!c) return 0;
  const vh = await page.evaluate(() => innerHeight);
  const y = Math.max(0, c.top), bottom = Math.min(vh, c.bottom);
  if (bottom - y < 4) return 0;
  return colorShare(await page.screenshot({ clip: { x: Math.max(0, c.x), y, width: c.width, height: bottom - y } }), TINT[tint ?? c.tint]);
}
const tintPage = async (page, tint = 'yellow') => colorShare(await page.screenshot(), TINT[tint]);
/** Walks the whole list: K to the first paragraph, then J until the highlight stops moving. */
async function walk(page, max = 90) {
  for (let i = 0, last = null; i < max; i++) {
    await page.keyboard.press('k');
    const c = await cur(page);
    if (!c || c.text === last) break;
    last = c.text;
  }
  const seen = [];
  for (let i = 0; i < max; i++) {
    const c = await cur(page);
    if (!c || (seen.length && c.text === seen.at(-1).text)) break;
    seen.push(c);
    await page.keyboard.press('j');
  }
  return seen;
}
const expected = (page) => page.evaluate(() => {
  const roots = [document, ...[...document.querySelectorAll('*')].map((e) => e.shadowRoot).filter(Boolean)];
  for (const r of [...roots]) for (const e of r.querySelectorAll('*')) if (e.shadowRoot && !roots.includes(e.shadowRoot)) roots.push(e.shadowRoot);
  return roots.flatMap((r) => [...r.querySelectorAll('[data-expect="focus"]')]).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 48));
});
const domOf = (page) => page.evaluate(() => document.documentElement.outerHTML.replace(/ style=""/g, ''));

const P = {
  focus: () => document.querySelector('[data-mode="focus"] [role="switch"]').click(),
  comfort: () => document.querySelector('[data-mode="comfort"] [role="switch"]').click(),
  calm: () => document.querySelector('[data-mode="calm"] [role="switch"]').click(),
  blur: () => document.querySelectorAll('[data-mode="calm"] input[type="checkbox"]')[1].click(),
  expand: () => document.querySelector('[data-mode="focus"] [aria-controls]').click(),
  move: (v) => { const r = document.querySelector(`[data-mode="focus"] input[value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); },
  preset: (v) => { const r = document.querySelector(`[data-mode="comfort"] input[value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); },
  pause: () => document.querySelector('[data-mode="focus"] .rs-mode__body > button').click(),
  resetAll: () => document.querySelector('.rs-header [aria-label="Reset All"]').click(),
  color: (v) => { const r = document.querySelector(`[data-mode="focus"] input[value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); },
  state: () => {
    const btn = document.querySelector('[data-mode="focus"] .rs-mode__body > button');
    return { word: document.querySelector('[data-mode="focus"] .rs-mode__state').textContent, on: document.querySelector('[data-mode="focus"]').classList.contains('rs-mode--on'), pause: btn.textContent, pauseDisabled: btn.disabled, status: document.querySelector('[role="status"]').textContent, alert: document.querySelector('[role="alert"]').textContent, comfortWord: document.querySelector('[data-mode="comfort"] .rs-mode__state').textContent, calmWord: document.querySelector('[data-mode="calm"] .rs-mode__state').textContent };
  },
};

async function fixture(name) {
  const page = await h.ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/${name}`);
  await sleep(250);
  return { page, errors };
}

try {
  // ═════════ A. Detection, paint, keyboard (focus-basic: Phase 1 fixture) ═════════
  {
    const { page, errors } = await fixture('focus-basic.html');
    const before = await domOf(page);
    const p = await open(page);
    await p.evaluate(P.expand);
    let t0 = Date.now();
    await p.evaluate(P.focus);
    await sleep(350);
    timings.enableWall = Date.now() - t0;
    const st = await p.evaluate(P.state);
    check('Focus on: popup says On (no Preview label), section active, Pause available', st.word === 'On' && st.on && st.pause === 'Pause' && !st.pauseDisabled && !(await p.evaluate(() => document.body.textContent)).includes('Preview'), st);
    const tint = await tintIn(page);
    await page.screenshot({ path: new URL('focus-1-basic.png', OUT).pathname });
    check('highlight is PAINTED (tint pixels inside the paragraph)', tint > 3, { tint });
    const seen = await walk(page);
    const want = await expected(page);
    const got = seen.map((s) => s.text);
    check('detection: every expected block found, in DOM order', JSON.stringify(got) === JSON.stringify(want), { got: got.length, want: want.length, missing: want.filter((w) => !got.includes(w)) });
    check('detection: excluded UI (header, nav, aside, footer, form, code, editable, hidden) never highlighted', seen.every((s) => s.expect === 'focus'), seen.filter((s) => s.expect !== 'focus').map((s) => s.text));
    check('nested list: outer item highlighted up to its nested list only', seen.some((s) => s.text.startsWith('Outer item')) && seen.some((s) => s.text.startsWith('A nested list item')));
    check('DOM untouched while Focus is on (no wrappers, no attributes)', (await domOf(page)) === before);
    await p.evaluate(P.focus);
    await sleep(300);
    check('Focus off: highlight registry empty and DOM identical', (await hlCount(page)) === 0 && (await domOf(page)) === before);
    check('no page errors (basic)', errors.length === 0, errors);
    await p.close();
    await page.close();
  }

  // ═════════ A2. Description list rows (a skills table: short term + short value) ═════════
  {
    const { page, errors } = await fixture('focus-dl.html');
    const p = await open(page);
    await p.evaluate(P.focus);
    await sleep(350);
    const seen = await walk(page);
    const want = await expected(page);
    check('dl rows: every term + value pair is reached with J/K, in order, nothing else', JSON.stringify(seen.map((c) => c.text)) === JSON.stringify(want), { seen: seen.map((c) => c.text), want });
    await page.evaluate(() => document.querySelectorAll('.about__skill')[2].scrollIntoView({ block: 'center' }));
    const row = seen.findIndex((c) => c.text.startsWith('Web'));
    for (let i = seen.length - 1; i > row; i--) await page.keyboard.press('k');
    await sleep(100);
    check('dl row "Web" is painted as one block (term and value)', (await cur(page))?.text.startsWith('WebJavaScript') && (await tintIn(page)) > 3, await cur(page));
    await page.screenshot({ path: new URL('focus-dl-row.png', OUT).pathname });
    check('no page errors (dl)', errors.length === 0, errors);
    await p.evaluate(P.focus);
    await p.close();
    await page.close();
  }

  // ═════════ A3. Follow scroll groups a heading with the caption beside it (focus-group) ═════════
  {
    const { page, errors } = await fixture('focus-group.html');
    const ids = () => page.evaluate(() => {
      const hl = [...CSS.highlights.values()][0];
      if (!hl) return [];
      return [...hl].map((r) => { const n = r.commonAncestorContainer; return (n.nodeType === 1 ? n : n.parentElement).closest('[id]')?.id; });
    });
    const p = await open(page);
    await p.evaluate(P.expand);
    await p.evaluate(P.move, 'scroll');
    await p.evaluate(P.focus);
    await sleep(350);
    const at = async (y) => { await page.evaluate((v) => scrollTo(0, v), y); await sleep(150); return ids(); };
    const hero = await at(0);
    await page.screenshot({ path: new URL('focus-group-hero.png', OUT).pathname });
    const capTint = colorShare(await page.screenshot({ clip: await page.evaluate(() => { const r = document.getElementById('caption').getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(1, Math.min(r.width, innerWidth - r.x)), height: Math.max(1, Math.min(r.height, innerHeight - r.y)) }; }) }), TINT.yellow);
    check('Follow scroll: hero heading and the caption beside it are highlighted together (pixels on the caption)', hero.join() === 'title,caption' && capTint > 3, { hero, capTint, cap: await page.evaluate(() => JSON.stringify(document.getElementById('caption').getBoundingClientRect())), vw: await page.evaluate(() => [innerWidth, innerHeight]) });
    const steps = [];
    for (let y = 0; y <= 2600; y += 120) steps.push((await at(y)).join('+'));
    const changes = steps.filter((v, i) => i && v !== steps[i - 1]).length;
    check('Follow scroll: the large heading does not trap the highlight (it moves on to the next blocks)', steps.some((v) => v === 'about') && steps.some((v) => v.startsWith('c')), steps);
    check('Follow scroll: stacked heading + paragraph and sibling cards stay single blocks', steps.every((v) => v === 'title+caption' || !v.includes('+')), steps);
    check('Follow scroll: highlight changes stay proportional to the content (no flicker)', changes <= 14, { changes });
    await page.evaluate(() => document.getElementById('cards')?.scrollIntoView());
    await p.evaluate(P.move, 'keyboard');
    await page.evaluate(() => scrollTo(0, 0));
    await sleep(150);
    await page.keyboard.press('k');
    await sleep(80);
    check('Keyboard: one block at a time (heading alone, caption on the next J)', (await ids()).join() === 'title' && (await (async () => { await page.keyboard.press('j'); await sleep(80); return (await ids()).join(); })()) === 'caption', await ids());
    for (const color of ['blue', 'dark']) await p.evaluate(P.color, color);
    await p.evaluate(P.move, 'scroll');
    await page.evaluate(() => scrollTo(0, 0));
    await sleep(200);
    check('Follow scroll group repaints in the chosen colour', (await page.evaluate(() => [...CSS.highlights.keys()].join())) === 'rs-focus-dark' && (await ids()).length === 2);
    await p.evaluate(P.color, 'yellow');
    await p.evaluate(P.move, 'keyboard');
    await p.evaluate(P.focus);
    await sleep(200);
    check('Focus off removes the grouped highlight', (await hlCount(page)) === 0);
    check('no page errors (group)', errors.length === 0, errors);
    await p.close();
    await page.close();
  }

  // ═════════ B. Keyboard safety, scrolling, pause (focus-keys) ═════════
  {
    const { page, errors } = await fixture('focus-keys.html');
    await page.evaluate(() => document.getElementById('k15').scrollIntoView({ block: 'center' }));
    await sleep(100);
    const y0 = await page.evaluate(() => scrollY);
    const p = await open(page);
    await p.evaluate(P.expand);
    await p.evaluate(P.focus);
    await sleep(350);
    let c = await cur(page);
    check('starts at the paragraph at the reading line, not the top of the page', c && ['k14', 'k15', 'k16'].includes(c.id), c);
    check('enabling never scrolls the page', (await page.evaluate(() => scrollY)) === y0);
    const startId = c.id;
    let t0 = performance.now();
    await page.keyboard.press('j');
    timings.jWall = Math.round(performance.now() - t0);
    c = await cur(page);
    check('J moves to the next paragraph', c.id === `k${Number(startId.slice(1)) + 1}`, c.id);
    await page.keyboard.press('k');
    check('K moves to the previous paragraph', (await cur(page)).id === startId);
    check('the page does not also receive J or K', !(await page.evaluate(() => window.pageKeys.includes('j') || window.pageKeys.includes('k'))));
    // Many steps: the highlight stays on screen, scrolling is instant (no animation).
    for (let i = 0; i < 12; i++) await page.keyboard.press('j');
    c = await cur(page);
    const vh = await page.evaluate(() => innerHeight);
    check('after 12 J presses the highlighted paragraph is fully visible', c.top >= 0 && c.bottom <= vh, c);
    const away = await page.evaluate(() => (scrollTo(0, 0), scrollY));
    const idAway = c.id;
    await page.keyboard.press('j');
    c = await cur(page);
    check('J after the reader scrolled away starts again where they are (no jump back)', c.top >= 0 && c.bottom <= vh && Number(c.id.slice(1)) < Number(idAway.slice(1)) - 5 && (await page.evaluate(() => scrollY)) - away < vh, { idAway, c });
    // Typing is never intercepted.
    const hlBefore = (await cur(page)).id;
    for (const sel of ['#inp', '#ta']) {
      await page.focus(sel);
      await page.keyboard.type('jkJK');
    }
    await page.click('#ce p');
    await page.keyboard.type('jk');
    const typed = await page.evaluate(() => ({ inp: document.getElementById('inp').value, ta: document.getElementById('ta').value, ce: document.getElementById('ce').textContent.includes('jk') }));
    check('typing J/K in input, textarea and contenteditable types normally; Focus does not move', typed.inp === 'jkJK' && typed.ta === 'jkJK' && typed.ce && (await cur(page)).id === hlBefore, typed);
    await page.focus('#rt');
    await page.evaluate(() => (window.pageKeys = []));
    await page.keyboard.press('j');
    check('role=textbox widget receives J; Focus does not move', (await page.evaluate(() => window.pageKeys.includes('j'))) && (await cur(page)).id === hlBefore);
    await page.focus('#sel');
    await page.keyboard.press('k');
    check('a focused select keeps its own type ahead (K picks kiwi); Focus does not move', (await page.evaluate(() => document.getElementById('sel').value)) === 'kiwi' && (await cur(page)).id === hlBefore);
    await page.evaluate(() => document.activeElement.blur());
    await page.evaluate(() => (window.pageKeys = []));
    await page.keyboard.press('Control+j');
    await page.keyboard.press('Shift+J');
    check('modified keys (Ctrl+J, Shift+J) are left to the browser and page', (await page.evaluate(() => window.pageKeys.filter((k) => k.toLowerCase() === 'j').length)) === 2 && (await cur(page)).id === hlBefore);
    // Esc pauses; the page still gets Esc; J resumes on the same paragraph (when it is still on screen).
    await page.keyboard.press('k');
    const remembered = (await cur(page)).id;
    await page.keyboard.press('Escape');
    await sleep(50);
    let st = await p.evaluate(P.state);
    const pausedHl = await hlCount(page);
    const pausedTint = await tintPage(page);
    check('Esc pauses: highlight removed (registry and pixels)', pausedHl === 0 && pausedTint < 0.2, { pausedHl, pausedTint });
    check('the page still receives Esc (not swallowed)', await page.evaluate(() => window.escSeen === 1));
    const ps = await p.evaluate(async () => { await new Promise((r) => setTimeout(r, 10)); return null; });
    void ps;
    // The popup reads state on its next update: reopen to see the paused state as a user would.
    await p.close();
    const p2 = await open(page);
    await p2.evaluate(P.expand);
    st = await p2.evaluate(P.state);
    check('popup distinguishes Paused (state word, Resume button), still enabled', st.word === 'Paused' && st.pause === 'Resume' && !st.on, st);
    await page.keyboard.press('j');
    c = await cur(page);
    check('J resumes on the remembered paragraph', c && c.id === remembered && (await tintIn(page)) > 3, c);
    await page.keyboard.press('Escape');
    await p2.evaluate(P.pause); // Resume from the popup
    await sleep(150);
    st = await p2.evaluate(P.state);
    check('popup Resume restores the highlight; Pause pauses it', (await cur(page))?.id === remembered && st.word === 'On' && st.pause === 'Pause', st);
    await p2.evaluate(P.pause);
    await sleep(150);
    st = await p2.evaluate(P.state);
    check('popup Pause button pauses', (await hlCount(page)) === 0 && st.word === 'Paused', st);
    await p2.evaluate(P.pause);
    await sleep(150);
    // Esc while a dialog is open belongs to the dialog.
    await page.evaluate(() => document.getElementById('dlg').showModal());
    await page.keyboard.press('Escape');
    await sleep(50);
    check('Esc that closes a modal dialog does not pause Focus', (await hlCount(page)) === 1 && !(await page.evaluate(() => document.getElementById('dlg').open)));
    // Follow scroll: J/K are no longer taken; the paragraph at the middle follows the scroll.
    const yS = await page.evaluate(() => scrollY);
    t0 = performance.now();
    await p2.evaluate(P.move, 'scroll');
    await sleep(120);
    timings.switchWall = Math.round(performance.now() - t0);
    check('switching to Follow scroll does not scroll the page', (await page.evaluate(() => scrollY)) === yS);
    await page.evaluate(() => (window.pageKeys = []));
    const beforeJ = (await cur(page))?.id;
    await page.keyboard.press('j');
    check('in Follow scroll J goes to the page; Focus does not take it', (await page.evaluate(() => window.pageKeys.includes('j'))) && (await cur(page))?.id === beforeJ);
    let follow = 0, tries = 0;
    for (const dy of [300, 450, 600, -900, 250]) {
      await page.mouse.wheel(0, dy);
      await sleep(160);
      const cc = await cur(page);
      tries++;
      if (cc && cc.top <= vh / 2 + 24 && cc.bottom >= vh / 2 - 24) follow++;
    }
    check('Follow scroll: the highlighted paragraph is the one at the middle after each scroll', follow === tries, { follow, tries });
    const pd = await page.evaluate(() => document.querySelector('header').getBoundingClientRect().bottom);
    check('sticky header is not highlighted', !(await cur(page)).text.startsWith('Sticky'), pd);
    await page.keyboard.press('Escape');
    await sleep(50);
    const yP = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 500);
    await sleep(160);
    check('paused Follow scroll stops tracking (no highlight while scrolling)', (await hlCount(page)) === 0 && (await page.evaluate(() => scrollY)) > yP);
    // A user opens the popup after pressing Esc on the page: it shows the fresh state.
    await p2.close();
    const p3 = await open(page);
    await p3.evaluate(P.expand);
    check('Follow scroll paused: popup offers Resume', (await p3.evaluate(P.state)).pause === 'Resume');
    await p3.evaluate(P.pause);
    await sleep(150);
    c = await cur(page);
    check('resume in Follow scroll highlights the paragraph at the middle', c && c.top <= vh / 2 + 24 && c.bottom >= vh / 2 - 24, c);
    await p3.evaluate(P.move, 'keyboard');
    await sleep(80);
    await page.keyboard.press('j');
    check('switching back to Keyboard is immediate (J steps again)', (await cur(page))?.id !== c.id);
    // Off: listeners gone, page gets J again.
    await p3.evaluate(P.focus);
    await sleep(250);
    await page.evaluate(() => (window.pageKeys = []));
    await page.keyboard.press('j');
    check('Focus off: no highlight, J reaches the page again', (await hlCount(page)) === 0 && (await page.evaluate(() => window.pageKeys.includes('j'))));
    check('no page errors (keys)', errors.length === 0, errors);
    await p3.close();
    await page.close();
  }

  // ═════════ C. Nested scroll container ═════════
  {
    const { page, errors } = await fixture('focus-nested.html');
    const p = await open(page);
    await p.evaluate(P.focus);
    await sleep(300);
    let c = await cur(page);
    check('nested pane: starts in the pane, sidebar nav never highlighted', c && c.text.startsWith('Pane paragraph'), c);
    for (let i = 0; i < 15; i++) await page.keyboard.press('j');
    c = await cur(page);
    const pane = await page.evaluate(() => { const r = document.getElementById('pane').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, scrollTop: document.getElementById('pane').scrollTop }; });
    check('J scrolls the nested container to keep the paragraph visible', pane.scrollTop > 0 && c.top >= pane.top && c.bottom <= pane.bottom, { c, pane });
    await p.evaluate(P.expand);
    await p.evaluate(P.move, 'scroll');
    await sleep(100);
    let ok = 0;
    for (const dy of [400, 700, -300]) {
      await page.mouse.move(700, 300);
      await page.mouse.wheel(0, dy);
      await sleep(180);
      const cc = await cur(page);
      const vh = await page.evaluate(() => innerHeight);
      if (cc && cc.top <= vh / 2 + 24 && cc.bottom >= vh / 2 - 24) ok++;
    }
    check('Follow scroll tracks scrolling inside the nested container (capture phase)', ok === 3, ok);
    const st = await rsState(page);
    timings.nestedFollow = { frames: st.focus.stats.followFrames, maxMs: st.focus.stats.followMsMax, blocks: st.focus.blocks };
    await p.evaluate(P.move, 'keyboard');
    await p.evaluate(P.focus);
    check('no page errors (nested)', errors.length === 0, errors);
    await p.close();
    await page.close();
  }

  // ═════════ D. Shadow DOM ═════════
  {
    const { page, errors } = await fixture('focus-shadow.html');
    const p = await open(page);
    await p.evaluate(P.focus);
    await sleep(300);
    const seen = await walk(page);
    const texts = seen.map((s) => s.text);
    check('open and nested open shadow paragraphs detected in order; closed shadow root unreachable', texts.length === 4 && texts[1].includes('OPEN shadow') && texts[2].includes('NESTED') && !texts.some((t) => t.includes('CLOSED')), texts);
    // Paint inside the shadow root needs the adopted sheet.
    await page.keyboard.press('k');
    await page.keyboard.press('k');
    const c = await cur(page);
    const tint = await tintIn(page);
    check('highlight inside an open shadow root is PAINTED (pixels)', c.inShadow && tint > 3, { c, tint });
    const sheetsOn = await page.evaluate(() => document.querySelector('x-open').shadowRoot.adoptedStyleSheets.length);
    await p.evaluate(P.focus);
    await sleep(250);
    const sheetsOff = await page.evaluate(() => [document.querySelector('x-open').shadowRoot.adoptedStyleSheets.length, document.querySelector('x-open').shadowRoot.querySelector('x-inner').shadowRoot.adoptedStyleSheets.length]);
    check('Focus off removes the shadow root sheets', sheetsOn >= 1 && sheetsOff[0] === 0 && sheetsOff[1] === 0, { sheetsOn, sheetsOff });
    check('no page errors (shadow)', errors.length === 0, errors);
    await p.close();
    await page.close();
  }

  // ═════════ E. Dynamic content, SPA, mutation floods ═════════
  {
    const { page, errors } = await fixture('focus-dynamic.html');
    const p = await open(page);
    await p.evaluate(P.focus);
    await sleep(300);
    let st = await rsState(page);
    const n0 = st.focus.blocks;
    await page.evaluate(() => window.addItems(5));
    await sleep(500);
    st = await rsState(page);
    check('added paragraphs are detected after the debounce', st.focus.blocks === n0 + 5, { n0, now: st.focus.blocks });
    // Remove the highlighted paragraph: recover at the reading line.
    const removed = await page.evaluate(() => { const hl = [...CSS.highlights.keys()].map((k) => CSS.highlights.get(k))[0]; const n = [...hl][0].commonAncestorContainer; const id = n.id; n.remove(); return id; });
    await sleep(500);
    const c = await cur(page);
    check('highlighted paragraph removed: Focus recovers on another paragraph', c && c.id !== removed && !c.collapsed && (await tintIn(page)) > 3, { removed, c });
    // Flood: thousands of mutations, scans stay capped.
    const r0 = (await rsState(page)).focus.stats.rescans;
    const muts = await page.evaluate(() => window.flood(3000));
    await sleep(400);
    st = await rsState(page);
    const scans = st.focus.stats.rescans - r0;
    check('mutation flood (3 s): re-detection is debounced and capped (≤ 4 scans)', scans <= 4, { mutations: muts, scans, batches: st.focus.stats.mutationBatches });
    timings.flood = { mutations: muts, scans, rescanMsMax: st.focus.stats.rescanMsMax };
    // SPA route: the content is replaced.
    await page.evaluate(() => window.spa());
    await sleep(600);
    const c2 = await cur(page);
    check('SPA route change: Focus moves to the new content', c2 && (c2.text.startsWith('Route two') || c2.text.startsWith('New route')), c2);
    // Pause, remove the remembered paragraph, resume.
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const hl = document.querySelector('#feed p'); hl.remove(); });
    await page.evaluate(() => (document.getElementById('feed').innerHTML = '<p>Replacement paragraph after the pause, long enough to be read.</p>'));
    await sleep(600);
    await page.keyboard.press('j');
    const c3 = await cur(page);
    check('resume after the remembered paragraph was removed: recovers gracefully', c3 && c3.text.startsWith('Replacement'), c3);
    await p.evaluate(P.focus);
    await sleep(200);
    st = await rsState(page);
    check('Focus off: no focus state, no highlight', !st.focus && (await hlCount(page)) === 0);
    check('no page errors (dynamic)', errors.length === 0, errors);
    await p.close();
    await page.close();
  }

  // ═════════ F. Dark page, consent shell, multiple articles, empty page ═════════
  {
    // Every colour on a dark page and a light page: background pixels inside the paragraph, and text
    // pixels in the colour's own foreground (the site's text colour is replaced, so contrast holds).
    const ratio = (a, b) => { const lum = (c) => { const ch = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; }; const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return Math.round(((x + 0.05) / (y + 0.05)) * 10) / 10; };
    for (const pageName of ['focus-dark.html', 'focus-basic.html']) {
      const { page: pg } = await fixture(pageName);
      const pp = await open(pg);
      await pp.evaluate(P.focus);
      await sleep(300);
      for (const color of Object.keys(TINT)) {
        await pp.evaluate(P.color, color);
        await sleep(250);
        const c = await cur(pg);
        const bg = await tintIn(pg, color);
        const vh = await pg.evaluate(() => innerHeight);
        const y = Math.max(0, c.top), bottom = Math.min(vh, c.bottom);
        const fg = colorShare(await pg.screenshot({ clip: { x: Math.max(0, c.x), y, width: c.width, height: bottom - y } }), FG[color], 24);
        await pg.screenshot({ path: new URL(`focus-color-${pageName.replace('.html', '')}-${color}.png`, OUT).pathname });
        check(`${pageName} ${color}: painted at once with its own text colour, contrast ${ratio(TINT[color], FG[color])}:1 (≥ 4.5)`, c.tint === color && bg > 3 && fg > 0.5 && ratio(TINT[color], FG[color]) >= 4.5, { bg, fg });
      }
      await pp.evaluate(P.color, 'yellow');
      await pp.evaluate(P.focus);
      await sleep(300);
      check(`${pageName}: Focus off restores the page (no highlight, no tint)`, (await hlCount(pg)) === 0 && (await tintPage(pg)) < 0.2);
      await pp.close();
      await pg.close();
    }
    const { page } = await fixture('focus-dark.html');
    const p = await open(page);
    await p.evaluate(P.focus);
    await p.evaluate(P.focus);
    await p.close();
    await page.close();
  }
  {
    const { page } = await fixture('focus-consent.html');
    const p = await open(page);
    await p.evaluate(P.focus);
    await sleep(300);
    const seen = await walk(page);
    const want = await expected(page);
    check('page sized fixed app shell + body scroll lock (consent pattern): article detected, cookie bar and sticky header skipped', JSON.stringify(seen.map((s) => s.text)) === JSON.stringify(want), { got: seen.length, want: want.length, odd: seen.filter((s) => s.expect !== 'focus').map((s) => s.text) });
    await p.evaluate(P.focus);
    await p.close();
    await page.close();
  }
  {
    const { page } = await fixture('focus-multi.html');
    const p = await open(page);
    await p.evaluate(P.focus);
    await sleep(300);
    const seen = await walk(page);
    const want = await expected(page);
    check('several articles, no main landmark: all stories found, ad and footer skipped', JSON.stringify(seen.map((s) => s.text)) === JSON.stringify(want), { got: seen.map((s) => s.text), want });
    await p.evaluate(P.focus);
    await p.close();
    await page.close();
  }
  {
    const { page } = await fixture('focus-empty.html');
    const p = await open(page);
    await p.evaluate(P.expand);
    await p.evaluate(P.focus);
    await sleep(300);
    const st = await p.evaluate(P.state);
    check('no readable text: popup says No text with a short message; Pause disabled; nothing highlighted', st.word === 'No Text' && st.status.includes('No paragraphs') && st.pauseDisabled && !st.on && (await hlCount(page)) === 0, st);
    await page.evaluate(() => { const m = document.createElement('main'); m.innerHTML = '<p>Late paragraph one, loaded after the page, with enough words.</p><p>Late paragraph two, loaded after the page, with enough words.</p>'; document.body.append(m); });
    await sleep(600);
    check('text that arrives later is picked up (mode becomes active)', (await hlCount(page)) === 1);
    await p.evaluate(P.focus);
    await p.close();
    await page.close();
  }

  // ═════════ G. Coexistence with Comfort and Calm; reset; reload; navigation ═════════
  {
    const { page, errors } = await fixture('focus-keys.html');
    const p = await open(page);
    await p.evaluate(P.focus);
    await p.evaluate(P.comfort);
    await p.evaluate(P.calm);
    await p.evaluate(P.blur);
    await sleep(500);
    let st = await p.evaluate(P.state);
    const t1 = await tintIn(page);
    check('Focus + Comfort + Calm (blur): all three On and the highlight is painted', st.word === 'On' && st.comfortWord === 'On' && st.calmWord === 'On' && t1 > 3, { st, t1 });
    const lh1 = await page.evaluate(() => getComputedStyle(document.querySelector('main p')).lineHeight);
    await p.evaluate(P.preset, 'roomy');
    await sleep(400);
    const c = await cur(page);
    const t2 = await tintIn(page);
    check('Comfort spacing change: highlight follows the reflowed text (tint inside the paragraph box)', t2 > 3 && c, { t2, lh1 });
    await page.keyboard.press('j');
    check('Calm Reduce motion does not break J navigation', (await cur(page)).id !== c.id);
    await p.evaluate(P.comfort);
    await p.evaluate(P.calm);
    await sleep(400);
    st = await p.evaluate(P.state);
    check('Comfort and Calm off: Focus stays on and painted', st.word === 'On' && (await tintIn(page)) > 3 && st.comfortWord === 'Off', st);
    await p.evaluate(P.comfort);
    await sleep(300);
    await p.evaluate(P.focus);
    await sleep(300);
    const lh = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('main p')).lineHeight) / parseFloat(getComputedStyle(document.querySelector('main p')).fontSize));
    check('Focus off: Comfort effect stays (Roomy line height 1.5 still applied)', (await hlCount(page)) === 0 && Math.abs(lh - 1.5) < 0.02, { lh });
    await p.evaluate(P.focus);
    await p.evaluate(P.calm);
    await sleep(400);
    await p.evaluate(P.resetAll);
    await sleep(500);
    st = await p.evaluate(P.state);
    const lhR = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('main p')).lineHeight) / parseFloat(getComputedStyle(document.querySelector('main p')).fontSize));
    check('Reset all removes all three modes and their effects', st.word === 'Off' && st.comfortWord === 'Off' && st.calmWord === 'Off' && (await hlCount(page)) === 0 && lhR < 1.6, { st, lhR });
    // Undo brings them back, then reload.
    await p.evaluate(() => [...document.querySelectorAll('[role="status"] button')].find((b) => b.textContent === 'Undo').click());
    await sleep(500);
    await p.evaluate(P.comfort);
    await p.evaluate(P.calm);
    await sleep(300);
    check('Undo restores Focus', (await hlCount(page)) === 1);
    await p.close();
    await page.reload();
    await sleep(300);
    check('reload: effects are gone with the document (no highlight, no sheet)', (await hlCount(page)) === 0 && (await tintPage(page)) < 0.2);
    const p2 = await open(page);
    await sleep(300);
    st = await p2.evaluate(P.state);
    check('reopening the popup reapplies saved Focus and reports it accurately', st.word === 'On' && (await hlCount(page)) === 1 && (await tintIn(page)) > 3, st);
    await p2.close();
    await page.goto(`${origin}/focus-dark.html`);
    await sleep(300);
    check('navigation: no highlight carried into the next page', (await hlCount(page)) === 0);
    const p3 = await open(page);
    await p3.evaluate(P.focus);
    await sleep(200);
    await p3.close();
    check('no page errors (coexistence)', errors.length === 0, errors);
    await page.close();
  }

  // ═════════ H. Rapid toggling and a failed sheet ═════════
  {
    const { page, errors } = await fixture('focus-basic.html');
    const before = await domOf(page);
    const p = await open(page);
    for (let i = 0; i < 9; i++) await p.evaluate(P.focus); // ends on
    await sleep(600);
    let st = await p.evaluate(P.state);
    check('rapid toggling (9 clicks): ends On, exactly one highlight, painted', st.word === 'On' && (await hlCount(page)) === 1 && (await tintIn(page)) > 3, st);
    await p.evaluate(P.focus);
    await sleep(400);
    check('after rapid toggling and off: DOM identical, nothing left', (await domOf(page)) === before && (await hlCount(page)) === 0 && (await tintPage(page)) < 0.2);
    check('no page errors (rapid)', errors.length === 0, errors);
    await p.close();
    await page.close();
  }
} catch (e) {
  check('suite ran without exceptions', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await h.close();
  server.close();
}

fs.writeFileSync(new URL('focus-results.json', OUT), JSON.stringify({ results, timings }, null, 2));
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ${r.detail}`}`);
console.log('timings', JSON.stringify(timings));
console.log(failed.length ? `focus: ${failed.length} check(s) failed` : `focus: all ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
