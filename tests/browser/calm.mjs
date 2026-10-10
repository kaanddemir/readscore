/**
 * Phase 4 Calm checks in real Chromium, driven through the REAL popup (toolbar action → popup →
 * runtime + service worker). Visual claims are verified with screenshot PIXELS (sharpness), not
 * computed styles alone.
 *
 *   npm run build && PLAYWRIGHT_DIR=… node tests/browser/calm.mjs
 * Screenshots: $SHOT_DIR/calm-*.png. Exit code 0 = all checks passed.
 */
import fs from 'node:fs';
import { launch, serveFixtures, sleep, OUT } from './harness.mjs';
import { popupClient } from './popup-client.mjs';
import { sharpness } from './png.mjs';

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
const timings = {};

const { server, origin } = await serveFixtures();
const h = await launch();
const bs = await h.ctx.browser().newBrowserCDPSession();
const open = (page) => popupClient(h, bs, page, OUT);

/** Sharpness (mean |horizontal luminance gradient|) of a viewport clip, decoded off page. */
async function sharp(page, sel) {
  const rect = await page.evaluate((s) => {
    const el = s.startsWith('shadow:') ? document.getElementById('host').shadowRoot.querySelector(s.slice(7)) : document.querySelector(s);
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth - Math.max(0, r.x)), height: Math.min(r.height, innerHeight - Math.max(0, r.y)) };
  }, sel);
  await sleep(80);
  return sharpness(await page.screenshot({ clip: rect })); // decoded in Node: opening a tab would close the popup
}
const domOf = (page) => page.evaluate(() => document.documentElement.outerHTML.replace(/ style=""/g, ''));
const attrsLeft = (page) => page.evaluate(() => {
  const all = [document, ...[...document.querySelectorAll('*')].map((e) => e.shadowRoot).filter(Boolean)];
  return all.reduce((n, r) => n + r.querySelectorAll('[data-rs-calm], [data-rs-calm-reveal]').length, 0) + (document.documentElement.hasAttribute('data-rs-calm-show-all') ? 1 : 0);
});
const shadowSheets = (page) => page.evaluate(() => document.getElementById('host')?.shadowRoot?.adoptedStyleSheets.length ?? -1);

const P = {
  calmSwitch: () => document.querySelector('[data-mode="calm"] [role="switch"]').click(),
  comfortSwitch: () => document.querySelector('[data-mode="comfort"] [role="switch"]').click(),
  expandCalm: () => document.querySelector('[data-mode="calm"] [aria-controls]').click(),
  box: (i) => document.querySelectorAll('[data-mode="calm"] input[type="checkbox"]')[i].click(),
  strength: (v) => { const r = document.querySelector(`[data-mode="calm"] input[value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); },
  showAll: () => document.querySelector('[data-mode="calm"] .rs-group button').click(),
  state: () => ({ word: document.querySelector('[data-mode="calm"] .rs-mode__state').textContent, btn: document.querySelector('[data-mode="calm"] .rs-group button').textContent, btnDisabled: document.querySelector('[data-mode="calm"] .rs-group button').disabled, alert: document.querySelector('[role="alert"]').textContent, focusWord: document.querySelector('[data-mode="focus"] .rs-mode__state').textContent }),
};

try {
  // ═════════ A. Reduce motion (calm-motion.html, Phase 1.5 fixture) ═════════
  const mp = await h.ctx.newPage();
  const errors = [];
  mp.on('pageerror', (e) => errors.push(e.message));
  await mp.goto(`${origin}/calm-motion.html`);
  await sleep(400);
  let p = await open(mp);
  await p.evaluate(P.expandCalm);
  let t0 = Date.now();
  await p.evaluate(P.calmSwitch); // Calm on with defaults: Reduce motion only
  await sleep(300);
  timings.motionEnableWall = Date.now() - t0;
  const st = await p.evaluate(P.state);
  check('Calm on by default applies Reduce motion; popup On; Focus stays Off (independent)', st.word === 'On' && st.focusWord === 'Off', st);
  const motion = await mp.evaluate(async () => {
    const out = {};
    out.fadeOpacity = getComputedStyle(document.getElementById('fade')).opacity;
    out.infinite = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity).length;
    document.getElementById('menuBtn').click();
    await new Promise((r) => setTimeout(r, 150));
    out.menu = document.getElementById('menuBtn').getAttribute('aria-expanded');
    document.getElementById('dlgClose').click();
    await new Promise((r) => setTimeout(r, 150));
    out.dialogOpen = document.getElementById('dlg').open;
    out.scrollBehavior = getComputedStyle(document.documentElement).scrollBehavior;
    out.videoPaused = document.getElementById('vid').paused;
    return out;
  });
  check('motion: fade in content visible, infinite spinner finished, menu (transitionend) and dialog (animationend) still work, smooth scroll off', motion.fadeOpacity === '1' && motion.infinite === 0 && motion.menu === 'true' && motion.dialogOpen === false && motion.scrollBehavior === 'auto', motion);
  check('muted background video paused by Reduce motion', motion.videoPaused === true, motion);
  // Deliberate user playback: a real click on a page button that calls play()
  await mp.evaluate(() => { const b = document.createElement('button'); b.id = 'play'; b.textContent = 'Play'; b.onclick = () => document.getElementById('vid').play(); document.body.prepend(b); });
  await mp.bringToFront();
  await mp.click('#play');
  await sleep(500);
  check('a user click on Play starts the video and it keeps playing', await mp.evaluate(() => !document.getElementById('vid').paused));
  await sleep(1500);
  await mp.evaluate(() => { const v = document.getElementById('vid'); v.pause(); v.play(); }); // script replay of a user chosen video
  await sleep(300);
  check('the user chosen video is not paused again later (script replay after 1.5 s)', await mp.evaluate(() => !document.getElementById('vid').paused));
  // keyboard play
  await mp.evaluate(() => { const v = document.createElement('video'); v.id = 'v2'; v.muted = true; v.srcObject = document.getElementById('vid').srcObject; document.body.append(v); const b = document.createElement('button'); b.id = 'kplay'; b.textContent = 'Play 2'; b.onclick = () => v.play(); document.body.prepend(b); });
  await mp.focus('#kplay');
  await mp.keyboard.press('Enter');
  await sleep(400);
  check('keyboard activated play is allowed', await mp.evaluate(() => !document.getElementById('v2').paused));
  // dynamic autoplay with no gesture
  await sleep(1200);
  await mp.evaluate(() => { const v = document.createElement('video'); v.id = 'late'; v.muted = true; v.srcObject = document.getElementById('vid').srcObject; document.body.append(v); v.play().catch(() => {}); });
  await sleep(400);
  check('video inserted and autoplayed later (no gesture) is paused', await mp.evaluate(() => document.getElementById('late').paused));
  await mp.evaluate(() => { const v = document.createElement('video'); v.id = 'loud'; v.srcObject = document.getElementById('vid').srcObject; v.volume = 1; document.body.append(v); v.play().catch(() => {}); });
  await sleep(400);
  const loud = await mp.evaluate(() => ({ paused: document.getElementById('loud').paused, muted: document.getElementById('loud').muted }));
  check('media with sound is never paused by Calm (not a video blocker)', loud.paused === false || loud.muted === false, loud);
  await p.evaluate(P.calmSwitch); // off
  await sleep(300);
  const motionOff = await mp.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  check('Calm off restores smooth scrolling (page rule back)', motionOff === 'smooth', motionOff);
  await p.close();
  check('motion page: no page errors', errors.length === 0, errors.join(' | '));

  // ═════════ B. Blur images (calm-visuals.html) ═════════
  const page = await h.ctx.newPage();
  await page.goto(`${origin}/calm-visuals.html`);
  await sleep(1300);
  await page.screenshot({ path: new URL('calm-0-original.png', OUT).pathname });
  const base = await domOf(page); // after the first screenshot (Playwright leaves style="" on inputs)
  const sharp0 = { photo: await sharp(page, '#photo'), diagram: await sharp(page, '#diagram'), shadow: await sharp(page, 'shadow:#shadowImg'), icon: await sharp(page, '#bar img') };
  const layout0 = await page.evaluate(() => JSON.stringify([...document.querySelectorAll('img, svg, canvas, video')].map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height, r.x, r.y + scrollY]; })));

  p = await open(page);
  await p.evaluate(P.expandCalm);
  await p.evaluate(P.calmSwitch);
  t0 = Date.now();
  await p.evaluate(P.box, 1); // Blur images on (Light)
  await sleep(400);
  timings.blurEnableWall = Date.now() - t0;
  await page.mouse.move(2, 2);
  const light = { photo: await sharp(page, '#photo'), diagram: await sharp(page, '#diagram'), shadow: await sharp(page, 'shadow:#shadowImg'), icon: await page.evaluate(() => document.querySelector('#bar img').hasAttribute('data-rs-calm')) };
  await page.screenshot({ path: new URL('calm-1-light.png', OUT).pathname });
  check('Light blur visible in pixels (photo, diagram, open shadow DOM image); small icon is not selected', light.photo < sharp0.photo * 0.4 && light.diagram < sharp0.diagram * 0.6 && light.shadow < sharp0.shadow * 0.4 && light.icon === false, { sharp0, light });
  const layout1 = await page.evaluate(() => JSON.stringify([...document.querySelectorAll('img, svg, canvas, video')].map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height, r.x, r.y + scrollY]; })));
  check('layout unchanged (every visual keeps size and position)', layout0 === layout1);
  await p.evaluate(P.strength, 'strong');
  await sleep(300);
  const strong = await sharp(page, '#photo');
  check('Strong blurs more than Light (pixels)', strong < light.photo, { light: light.photo, strong });
  await page.screenshot({ path: new URL('calm-2-strong.png', OUT).pathname });

  // hover reveal: directly over the photo; a covered card image; leaving restores
  const r = await page.evaluate(() => { const e = document.getElementById('photo'); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  t0 = Date.now();
  await page.mouse.move(r.x, r.y);
  await sleep(60);
  timings.hoverRevealWall = Date.now() - t0;
  const hov = await page.evaluate(() => document.getElementById('photo').hasAttribute('data-rs-calm-reveal'));
  await page.mouse.move(r.x + 1, r.y + 1); // screenshot helper scrolls; keep pointer on the image
  check('hover reveals the photo (pixels sharp again)', hov && (await sharp(page, '#photo')) > sharp0.photo * 0.8);
  const others = await page.evaluate(() => document.querySelectorAll('[data-rs-calm-reveal]').length);
  check('only the hovered image is revealed (not every image in a large parent)', others === 1, `${others}`);
  const c = await page.evaluate(() => { const e = document.getElementById('cardImg'); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + 30, y: b.y + 30, top: document.elementFromPoint(b.x + 30, b.y + 30)?.id }; });
  await page.mouse.move(c.x, c.y);
  await sleep(60);
  check('image under a transparent covering link is revealed on hover', c.top === 'cover' && (await page.evaluate(() => document.getElementById('cardImg').hasAttribute('data-rs-calm-reveal'))), c);
  await page.mouse.move(2, 2);
  await sleep(60);
  check('pointer leaves: blurred again', (await sharp(page, '#cardImg')) < 3);

  // keyboard reveal: Tab to the linked thumbnail
  await page.evaluate(() => document.body.focus());
  let focused = '';
  for (let i = 0; i < 15 && focused !== 'thumbLink'; i++) (await page.keyboard.press('Tab'), (focused = await page.evaluate(() => document.activeElement?.id)));
  check('keyboard: Tab to a link reveals its image (pixels); no extra tab stops were added', focused === 'thumbLink' && (await sharp(page, '#thumb')) > 10 && (await page.evaluate(() => document.querySelectorAll('[tabindex]').length)) === 0, focused);
  await page.evaluate(() => document.activeElement?.blur());

  // interactions still work
  await page.click('#thumb'); const h1 = await page.evaluate(() => location.hash);
  await page.click('#cover'); const h2 = await page.evaluate(() => location.hash);
  await page.click('#imgSubmit'); const sub = await page.textContent('#res');
  check('linked image, covering link and image submit button still work', h1 === '#t' && h2 === '#card' && sub === 'submitted', { h1, h2, sub });

  // lazy / dynamic images
  t0 = Date.now();
  await page.evaluate(() => { const i = new Image(320, 180); i.id = 'dyn'; i.src = document.getElementById('photo').src; document.querySelector('main').prepend(i); });
  await sleep(450);
  timings.dynamicImageMarkedWithin = Date.now() - t0;
  await page.mouse.move(2, 2);
  check('image inserted later is blurred (pixels)', (await sharp(page, '#dyn')) < 3);
  check('lazy image from the fixture (added at 600 ms) is blurred', (await sharp(page, '#lazy')) < 3);

  // Show all images: popup toggles a page state
  await page.mouse.move(2, 2);
  t0 = Date.now();
  await p.evaluate(P.showAll);
  await sleep(200);
  timings.showAllWall = Date.now() - t0;
  const shownState = await p.evaluate(P.state);
  const shown = { photo: await sharp(page, '#photo'), diagram: await sharp(page, '#diagram'), shadow: await sharp(page, 'shadow:#shadowImg') };
  check('Show all images reveals every image incl. diagram and shadow DOM (pixels); button reads Blur again', shown.photo > sharp0.photo * 0.8 && shown.diagram > sharp0.diagram * 0.8 && shown.shadow > sharp0.shadow * 0.8 && shownState.btn === 'Blur Again', { shown, btn: shownState.btn });
  const motionStill = await page.evaluate(() => getComputedStyle(document.querySelector('main')).transitionDuration);
  check('Show all images keeps Reduce motion', motionStill === '1e-05s' || motionStill.startsWith('0.00001') || motionStill === '0.01ms', motionStill);
  await page.screenshot({ path: new URL('calm-3-show-all.png', OUT).pathname });
  await p.evaluate(P.showAll);
  await sleep(200);
  check('Blur again restores the blur at the chosen strength', (await sharp(page, '#photo')) <= strong + 0.5 && (await p.evaluate(P.state)).btn === 'Show All Images');

  // Comfort + Calm together
  await p.evaluate(P.comfortSwitch);
  await sleep(300);
  const both = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('main p')); return parseFloat(s.lineHeight) / parseFloat(s.fontSize); });
  check('Comfort and Calm work together (Relaxed spacing applied, blur kept)', Math.abs(both - 1.6) < 0.02 && (await sharp(page, '#photo')) < 3, { both });
  await p.evaluate(P.comfortSwitch);
  await sleep(300);
  check('turning Comfort off leaves Calm blur in place', (await sharp(page, '#photo')) < 3);

  // independence: Blur off keeps Reduce motion; Reduce motion off keeps blur
  await p.evaluate(P.box, 0); // motion off
  await sleep(300);
  const indep1 = { blur: (await sharp(page, '#photo')) < 3, motion: await page.evaluate(() => getComputedStyle(document.querySelector('main')).transitionDuration) };
  await p.evaluate(P.box, 0); // motion on
  await p.evaluate(P.box, 1); // blur off
  await sleep(300);
  const indep2 = { photo: await sharp(page, '#photo'), marks: await attrsLeft(page), motion: await page.evaluate(() => getComputedStyle(document.querySelector('main')).transitionDuration) };
  check('Reduce motion off keeps the blur; Blur off removes marks and keeps Reduce motion', indep1.blur && indep1.motion === '0s' && indep2.photo > sharp0.photo * 0.8 && indep2.marks === 0 && indep2.motion !== '0s', { indep1, indep2 });
  await p.evaluate(P.box, 1); // blur back on

  // full disable: the page minus Calm's own attributes must equal the page after disable
  // (this test itself changed the page above: an inserted image, link hashes, a submitted form).
  const beforeOff = (await domOf(page)).replace(/ data-rs-calm(-reveal|-show-all)?(="[^"]*")?/g, '');
  t0 = Date.now();
  await p.evaluate(P.calmSwitch);
  await sleep(300);
  timings.disableWall = Date.now() - t0;
  const domAfter = await domOf(page);
  check('Calm off: DOM identical to the page without Calm, no Calm attributes, no shadow sheets, pixels back', domAfter === beforeOff && (await attrsLeft(page)) === 0 && (await shadowSheets(page)) === 0 && (await sharp(page, '#photo')) > sharp0.photo * 0.8, { attrs: await attrsLeft(page), sheets: await shadowSheets(page) });

  // repeated cycles
  const cyc = [];
  for (let i = 0; i < 6; i++) {
    await p.evaluate(P.calmSwitch);
    await sleep(250);
    const on = (await attrsLeft(page)) > 0;
    await p.evaluate(P.calmSwitch);
    await sleep(250);
    cyc.push(on && (await attrsLeft(page)) === 0 && (await shadowSheets(page)) === 0);
  }
  check('6 Calm on/off cycles: each applies and cleans up completely', cyc.every(Boolean), cyc);

  // reload: effects and Show all are page state → gone; reopening the popup reapplies the saved Calm
  await p.evaluate(P.calmSwitch); // on (blur saved on)
  await sleep(250);
  await p.evaluate(P.showAll);
  await sleep(200);
  await p.close();
  await page.reload();
  await sleep(1300);
  check('reload: no Calm effects remain on the page', (await attrsLeft(page)) === 0 && (await sharp(page, '#photo')) > sharp0.photo * 0.8);
  await page.bringToFront();
  p = await open(page);
  await sleep(400);
  const re = await p.evaluate(P.state);
  await page.mouse.move(2, 2);
  check('reopen after reload: Calm reapplied, Show all reset to blurred', re.word === 'On' && re.btn === 'Show All Images' && (await sharp(page, '#photo')) < 3, re);
  await p.close();

  // ═════════ Clickable image tiles (Google results pattern: thumbnails inside role=button) ═════════
  {
    const tp = await h.ctx.newPage();
    const terr = [];
    tp.on('pageerror', (e) => terr.push(e.message));
    await tp.goto(`${origin}/calm-tiles.html`);
    await sleep(300);
    const ids = ['#collage1', '#collage2', '#vidThumb', '#bgTile', '#place1'];
    const clear = {};
    for (const id of ids) clear[id] = await sharp(tp, id);
    const tp2 = await open(tp); // saved Calm + Blur images are reapplied
    await sleep(500);
    await tp.mouse.move(2, 2);
    const blurred = {};
    for (const id of ids) blurred[id] = await sharp(tp, id);
    await tp.screenshot({ path: new URL('calm-tiles-blurred.png', OUT).pathname });
    check('tiles: photos inside role=button tiles, a video thumbnail, a CSS background tile and a linked place are all blurred (pixels)', ids.every((id) => clear[id] > 3 && blurred[id] < clear[id] * 0.4), { clear, blurred });
    const keep = await tp.evaluate(() => ({
      tileMarked: document.getElementById('vidTile').hasAttribute('data-rs-calm') || document.getElementById('tileMain').hasAttribute('data-rs-calm'),
      metaFilter: getComputedStyle(document.getElementById('vidMeta')).filter,
      textCard: document.getElementById('textCard').hasAttribute('data-rs-calm'),
      svgBtn: document.querySelector('#svgBtn svg').hasAttribute('data-rs-calm'),
    }));
    check('tiles: the tile, its text overlay, a text card and an svg in a button stay sharp', !keep.tileMarked && keep.metaFilter === 'none' && !keep.textCard && !keep.svgBtn, keep);
    await tp.click('h1'); // sequential focus starts after the heading
    await tp.mouse.move(2, 2);
    await tp.keyboard.press('Tab');
    await sleep(100);
    const focused = await tp.evaluate(() => document.activeElement.id);
    check('tiles: Tab to a role=button tile reveals its image (pixels)', focused === 'tileMain' && (await sharp(tp, '#collage1')) > clear['#collage1'] * 0.8, focused);
    await tp.evaluate(() => document.activeElement.blur());
    await tp.mouse.move(150, 150);
    await sleep(150);
    check('tiles: hover reveals a tile image', await tp.evaluate(() => document.getElementById('collage1').hasAttribute('data-rs-calm-reveal')));
    check('tiles: no page errors', terr.length === 0, terr);
    await tp2.close();
    await tp.close();
  }

  // Restricted page
  const rp = await h.ctx.newPage();
  await rp.goto('chrome://version');
  p = await open(rp);
  const rs = await p.evaluate(P.state);
  check('restricted page: Show all disabled, no alert', rs.btnDisabled && rs.alert === '', rs);
  await p.close();
} catch (e) {
  check('harness ran to completion', false, e instanceof Error ? e.stack : String(e));
} finally {
  await h.close();
  server.close();
}

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail.slice(0, 400)})` : ''}`);
console.log('timings (wall ms incl. popup round trips and fixed waits):', JSON.stringify(timings));
const failed = results.filter((x) => !x.pass).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
