/**
 * Phase 2B real-Chromium popup check: opens the REAL popup through the toolbar action, drives it
 * over CDP (real key events), and captures screenshots of every state in light and dark themes and
 * at larger text sizes. Also measures layout invariants (no overflow, shared edges, target sizes).
 *
 *   npm run build && PLAYWRIGHT_DIR=… node tests/browser/popup-ui.mjs
 * Screenshots: $SHOT_DIR/popup-*.png. Exit code 0 = all checks passed.
 */
import fs from 'node:fs';
import { launch, serveFixtures, sleep, OUT } from './harness.mjs';
import { popupClient as popupClientFor } from './popup-client.mjs';

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });

const { server, origin } = await serveFixtures();
const h = await launch();
const bs = await h.ctx.browser().newBrowserCDPSession();

const popupClient = (page) => popupClientFor(h, bs, page, OUT);

/** Layout invariants measured in the rendered popup. */
const LAYOUT = () => {
  const r = (el) => el.getBoundingClientRect();
  const doc = document.documentElement;
  const gutterL = r(document.querySelector('.rs-header__title')).left;
  const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
  const names = [...document.querySelectorAll('.rs-mode__name')].map((n) => Math.round(r(n).left));
  const switchesRight = [...document.querySelectorAll('.rs-mode__controls')].map((n) => Math.round(r(n).right));
  const menuRight = Math.round(r(document.querySelector('.rs-header [aria-controls]')).right);
  const controls = [...document.querySelectorAll('button, input, select, summary')].filter(visible);
  const small = controls
    .map((c) => {
      const b = r(c);
      return { tag: c.className || c.type || c.tagName, w: Math.round(b.width), h: Math.round(b.height) };
    })
    .filter((b) => (b.w < 24 || b.h < 24) && !String(b.tag).includes('rs-segmented__input') && !String(b.tag).includes('rs-check__input') && !String(b.tag).includes('rs-slider__input'));
  const outside = controls.filter((c) => r(c).right > doc.clientWidth + 0.5 || r(c).left < -0.5).map((c) => c.className);
  const clippedText = [...document.querySelectorAll('p, label, legend, span, dd, h1, h2')].filter((t) => visible(t) && (t.scrollWidth > t.clientWidth + 1) && getComputedStyle(t).overflow !== 'visible').length;
  return {
    width: doc.clientWidth,
    height: doc.scrollHeight,
    hOverflow: doc.scrollWidth > doc.clientWidth,
    gutterLeft: Math.round(gutterL),
    namesLeft: [...new Set(names)],
    rightEdges: [...new Set([...switchesRight, menuRight])],
    smallTargets: small,
    outside,
    clippedText,
  };
};

try {
  const page = await h.ctx.newPage();
  await page.goto(`${origin}/article.html`);

  // ── 1. Light, collapsed ──
  let p = await popupClient(page);
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  const lightBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('system light preference renders the light theme', lightBg === 'rgb(250, 248, 245)', lightBg);
  const base = await p.evaluate(LAYOUT);
  check('light: no horizontal overflow', !base.hOverflow, base);
  check('light: popup width 360px at default text size', base.width === 360, `${base.width}`);
  check('mode names share the gutter left edge with the title', base.namesLeft.length === 1 && base.namesLeft[0] === base.gutterLeft, base);
  check('switch/disclosure group and menu button share one right edge', base.rightEdges.length === 1, base.rightEdges);
  check('all targets ≥ 24px (WCAG 2.5.8)', base.smallTargets.length === 0, base.smallTargets);
  const statusText = await p.evaluate(() => document.querySelector('[role="status"]').textContent);
  const focusWord = await p.evaluate(() => document.querySelector('[data-mode="focus"] .rs-mode__state').textContent);
  const anyPreview = await p.evaluate(() => /Preview|does not work yet|Dim other text/.test(document.body.textContent));
  check('ready page: no global notice; Focus is Off and nothing is marked Preview or unavailable', statusText === '' && focusWord === 'Off' && !anyPreview, { statusText, focusWord, anyPreview });
  await p.shot('light-collapsed');

  // ── 2. Keyboard: focus order, toggles, single expansion ──
  const order = [];
  for (let i = 0; i < 10; i++) {
    await p.key('Tab');
    order.push(await p.evaluate(() => {
      const a = document.activeElement;
      const name = a.getAttribute('aria-label') ?? (a.getAttribute('aria-labelledby') && document.getElementById(a.getAttribute('aria-labelledby'))?.textContent) ?? a.textContent;
      return `${a.getAttribute('role') ?? a.tagName.toLowerCase()}:${name.trim().slice(0, 20)}`;
    }));
  }
  check('Tab order: Reset all, settings, then each mode switch and its settings button', order.slice(0, 8).join(' | ') === 'button:Reset All | button:Settings | switch:Focus | button:Focus Settings | switch:Comfort | button:Comfort Settings | switch:Calm | button:Calm Settings', order.join(' | '));
  // Focus the Focus switch, toggle with Space, expand with Enter on its settings button
  await p.evaluate(() => document.querySelector('[data-mode="focus"] [role="switch"]').focus());
  await p.key('Space');
  const focusOn = await p.evaluate(() => document.querySelector('[data-mode="focus"] [role="switch"]').getAttribute('aria-checked'));
  check('Space toggles a switch', focusOn === 'true', focusOn);
  await p.key('Tab');
  await p.key('Enter');
  const exp = await p.evaluate(() => ({ focus: !document.querySelector('[data-mode="focus"] .rs-mode__body').hidden, active: document.activeElement.getAttribute('aria-label') }));
  check('Enter expands settings and keeps focus on the toggle', exp.focus && exp.active === 'Focus Settings', exp);
  await p.key('Tab');
  await p.key('ArrowRight');
  const seg = await p.evaluate(() => document.querySelector('[data-mode="focus"] input[value="scroll"]').checked);
  check('Arrow keys move within a segmented control (native radios)', seg);
  await p.key('ArrowRight'); // back to keyboard (wraps)
  const ring = await p.evaluate(() => getComputedStyle(document.activeElement.nextElementSibling).outlineStyle);
  check('focused segmented option shows a visible focus ring', ring === 'solid', ring);
  await p.shot('light-focus-expanded');

  await p.evaluate(() => document.querySelector('[data-mode="comfort"] [aria-controls]').click());
  const single = await p.evaluate(() => [...document.querySelectorAll('.rs-mode__body')].filter((b) => !b.hidden).length);
  check('only one mode expanded at a time', single === 1, `${single}`);
  await p.evaluate(() => (document.querySelector('.rs-advanced').open = true));
  await p.evaluate(() => { const r = document.querySelector('[data-mode="comfort"] input[type="range"]'); r.value = '1.8'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  const comfort = await p.evaluate(LAYOUT);
  check('comfort expanded with advanced: no overflow, targets ok', !comfort.hOverflow && comfort.smallTargets.length === 0 && comfort.outside.length === 0, comfort);
  const sliderAlign = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.rs-slider')].map((s) => ({ v: Math.round(s.querySelector('output').getBoundingClientRect().right), r: Math.round(s.querySelector('input').getBoundingClientRect().right) }));
    return { valueRights: [...new Set(rows.map((x) => x.v))], rangeRights: [...new Set(rows.map((x) => x.r))] };
  });
  const edges = await p.evaluate(() => {
    const body = document.querySelector('[data-mode="comfort"] .rs-mode__body');
    const wide = [...body.querySelectorAll('.rs-segmented__track, .rs-select, .rs-slider__input, .rs-advanced__summary')].map((e) => e.getBoundingClientRect());
    const head = document.querySelector('[data-mode="comfort"] .rs-mode__head').getBoundingClientRect();
    const chev = document.querySelector('[data-mode="comfort"] .rs-disclosure .rs-icon').getBoundingClientRect();
    const rowChev = body.querySelector('.rs-advanced__chevron .rs-icon').getBoundingClientRect();
    const selChev = body.querySelector('.rs-select-wrap__chevron .rs-icon').getBoundingClientRect();
    return { selectChevron: Math.round(selChev.left + selChev.width / 2), lefts: [...new Set(wide.map((r) => Math.round(r.left)))], rights: [...new Set(wide.map((r) => Math.round(r.right)))], headRight: Math.round(head.right), chevronCentres: [Math.round(chev.left + chev.width / 2), Math.round(rowChev.left + rowChev.width / 2)] };
  });
  check('comfort: every full width control shares one left and one right edge (= the section edge)', edges.lefts.length === 1 && edges.rights.length === 1 && edges.rights[0] === edges.headRight, edges);
  check('Adjust spacing and Font chevrons are centred on the mode chevron column', Math.abs(edges.chevronCentres[0] - edges.chevronCentres[1]) <= 1 && Math.abs(edges.chevronCentres[0] - edges.selectChevron) <= 1, edges);
  check('slider values and tracks align in columns', sliderAlign.valueRights.length === 1 && sliderAlign.rangeRights.length === 1, sliderAlign);
  const resets = await p.evaluate(() => {
    const all = document.querySelector('.rs-header [aria-label="Reset All"]');
    const comfort = document.querySelector('[data-mode="comfort"] .rs-advanced__summary [aria-label="Reset Comfort"]');
    const menu = document.querySelector('.rs-header [aria-controls]').getBoundingClientRect();
    const chev = comfort.closest('summary').querySelector('.rs-advanced__chevron').getBoundingClientRect();
    return [all, comfort].map((b) => {
      const br = b.getBoundingClientRect(), cs = getComputedStyle(b);
      return { w: Math.round(br.width), h: Math.round(br.height), style: [b.className, cs.color].join('|'), beside: b === all ? Math.round(menu.left - br.right) : Math.round(chev.left - br.right) };
    });
  });
  check('both resets: icon buttons of one style, beside the menu / the row chevron, target ≥ 24px',
    resets.length === 2 && new Set(resets.map((r) => r.style)).size === 1 && resets.every((r) => r.w >= 24 && r.h >= 24 && r.beside >= 0 && r.beside <= 16), resets);
  await p.shot('light-comfort-advanced');

  await p.evaluate(() => document.querySelector('[data-mode="calm"] [aria-controls]').click());
  await p.evaluate(() => { document.querySelector('[data-mode="calm"] [role="switch"]').click(); [...document.querySelectorAll('[data-mode="calm"] input[type="checkbox"]')][1].click(); });
  const calmEdges = await p.evaluate(() => [...document.querySelectorAll('[data-mode="calm"] .rs-segmented__track, [data-mode="calm"] .rs-button--block')].map((e) => [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().right)].join('-')));
  check('calm: strength and Show all images share one width', new Set(calmEdges).size === 1, calmEdges);
  await p.shot('light-calm-blur');
  await p.evaluate(() => document.querySelector('.rs-header [aria-controls]').click());
  await p.shot('light-menu');

  // ── 3. Dark: system preference, then manual Dark under a light system ──
  await p.evaluate(() => document.querySelector('.rs-header [aria-controls]').click());
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  const darkBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('system dark preference switches the theme', darkBg === 'rgb(20, 21, 23)', darkBg);
  await p.shot('dark-calm-blur');
  await p.evaluate(() => document.querySelector('[data-mode="comfort"] [aria-controls]').click());
  await p.shot('dark-comfort-advanced');
  await p.evaluate(() => document.querySelector('[data-mode="comfort"] [aria-controls]').click());
  await p.shot('dark-collapsed');
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await p.evaluate(() => { document.querySelector('.rs-header [aria-controls]').click(); const d = document.querySelector('.rs-menu input[value="dark"]'); d.click(); });
  const manual = await p.evaluate(() => ({ attr: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
  check('manual Dark overrides a light system theme', manual.attr === 'dark' && manual.bg === 'rgb(20, 21, 23)', manual);
  await p.shot('dark-menu-manual');
  await p.evaluate(() => document.querySelector('.rs-menu input[value="system"]').click());

  // ── 4. Persistence: settings survive closing and reopening the popup ──
  await sleep(600);
  await bs.send('Target.closeTarget', { targetId: (await bs.send('Target.getTargets', { filter: [{}] })).targetInfos.find((t) => t.url.includes('/popup/')).targetId });
  await page.bringToFront();
  p = await popupClient(page);
  const persisted = await p.evaluate(() => ({
    focus: document.querySelector('[data-mode="focus"] [role="switch"]').getAttribute('aria-checked'),
    calm: document.querySelector('[data-mode="calm"] [role="switch"]').getAttribute('aria-checked'),
    lh: document.querySelector('[data-mode="comfort"] input[type="range"]').value,
    custom: document.querySelector('[data-mode="comfort"] input[value="custom"]').checked,
  }));
  check('settings persist across popup reopen (chrome.storage.sync)', persisted.focus === 'true' && persisted.calm === 'true' && persisted.lh === '1.8' && persisted.custom, persisted);

  // ── 5. Larger text: Chrome default font size 16 → 24 (150%) and 32 (200%) ──
  for (const size of [24, 32]) {
    await p.send('Page.setFontSizes', { fontSizes: { standard: size } });
    await p.evaluate(() => document.querySelector('[data-mode="comfort"] [aria-controls]').click());
    await p.evaluate(() => (document.querySelector('.rs-advanced').open = true));
    const big = await p.evaluate(LAYOUT);
    check(`text ${size}px: no horizontal overflow or clipped text; controls inside the popup`, !big.hOverflow && big.clippedText === 0 && big.outside.length === 0, big);
    await p.shot(`light-text${size}-comfort`);
    await p.evaluate(() => document.querySelector('[data-mode="comfort"] [aria-controls]').click());
    await p.shot(`light-text${size}-collapsed`);
  }
  await p.send('Page.setFontSizes', { fontSizes: { standard: 16 } });

  // ── 6. Long labels (pseudo localisation, +60% text) on a fresh popup at default size ──
  await bs.send('Target.closeTarget', { targetId: (await bs.send('Target.getTargets', { filter: [{}] })).targetInfos.find((t) => t.url.includes('/popup/')).targetId });
  await page.bringToFront();
  p = await popupClient(page);
  await p.evaluate(() => {
    const w = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim().length > 2) n.textContent = n.textContent + ' ' + n.textContent.slice(0, Math.ceil(n.textContent.length * 0.6));
    document.querySelector('[data-mode="calm"] [aria-controls]').click();
  });
  const longL = await p.evaluate(LAYOUT);
  check('long labels: wrap without overflow or clipping', !longL.hOverflow && longL.clippedText === 0 && longL.outside.length === 0, longL);
  await p.shot('light-long-labels');


  // ── 7. Restricted page ──
  const r = await h.ctx.newPage();
  await r.goto('chrome://version');
  const rp = await popupClient(r);
  const restricted = await rp.evaluate(() => ({ text: document.querySelector('[role="status"]').textContent, disabled: [...document.querySelectorAll('[role="switch"]')].every((s) => s.disabled), off: !document.querySelector('.rs-footer') }));
  check('restricted page: explained, switches disabled, no footer', /Not available on this page/.test(restricted.text) && restricted.disabled && restricted.off, restricted);
  await rp.shot('light-restricted');
  await rp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await rp.shot('dark-restricted');

  // ── 8. Reduced motion zeroes transitions ──
  await rp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const dur = await rp.evaluate(() => getComputedStyle(document.querySelector('.rs-switch')).transitionDuration);
  check('prefers-reduced-motion: transitions are 0s', /^0s(, 0s)*$/.test(dur), dur);
} catch (e) {
  check('harness ran to completion', false, e instanceof Error ? e.stack : String(e));
} finally {
  await h.close();
  server.close();
}

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail.slice(0, 400)})` : ''}`);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
