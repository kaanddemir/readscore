/**
 * Phase 4 Calm sweep on real websites (needs network), driven through the REAL popup.
 * Per site: Calm on (Reduce motion) + Blur images (Light), pixel blur on visible marked visuals,
 * Strong vs Light, hover reveal, Show all images, muted video pausing, then Calm off with a cleanup check.
 *
 *   npm run build && PLAYWRIGHT_DIR=… node tests/browser/calm-sites.mjs   (SITES=name=url,... to override)
 * Output: $SHOT_DIR/calm-sites.json and calm-site-<name>-*.png
 */
import fs from 'node:fs';
import { launch, sleep, siteList, OUT } from './harness.mjs';
import { popupClient } from './popup-client.mjs';
import { sharpness } from './png.mjs';

const SITES = siteList([
  ['heykaan', 'https://heykaan.dev/'],
  ['wikipedia', 'https://en.wikipedia.org/wiki/Cat'],
  ['news-bbc', 'pick:https://www.bbc.com/news|/news/articles/'],
  ['docs-mdn', 'https://developer.mozilla.org/en-US/docs/Web/CSS/filter'],
  ['github-readme', 'https://github.com/microsoft/vscode'],
  ['images-commons', 'https://commons.wikimedia.org/wiki/Category:Featured_pictures_of_landscapes'],
  ['images-flickr', 'https://www.flickr.com/explore'],
  ['images-natgeo', 'https://www.nationalgeographic.com/animals'],
  ['video-youtube', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
  ['video-vimeo', 'https://vimeo.com/76979871'],
  ['anim-css-stripe', 'https://stripe.com/'],
  ['anim-js-gsap', 'https://gsap.com/'],
  ['shadow-msn', 'https://www.msn.com/en-us'],
  ['form-govuk', 'https://www.gov.uk/contact-electoral-registration-office'],
  ['reddit', 'https://www.reddit.com/r/pics/'],
]);

const INFO = () => {
  const roots = [document, ...[...document.querySelectorAll('*')].map((e) => e.shadowRoot).filter(Boolean)];
  const marked = roots.flatMap((r) => [...r.querySelectorAll('[data-rs-calm]')]);
  const onTop = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    if (r.width < 60 || r.height < 60 || cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
    const hit = (el.getRootNode().elementFromPoint ? el.getRootNode() : document).elementFromPoint(cx, cy);
    if (!hit || hit.tagName === 'IFRAME') return false;
    return hit === el || el.contains(hit) || hit.contains(el) || (getComputedStyle(hit).backgroundColor === 'rgba(0, 0, 0, 0)' && !(hit.textContent ?? '').trim());
  };
  const visible = marked.filter(onTop).slice(0, 4).map((el) => { const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth - Math.max(0, r.x)), height: Math.min(r.height, innerHeight - Math.max(0, r.y)), inShadow: el.getRootNode() !== document }; });
  const media = roots.flatMap((r) => [...r.querySelectorAll('video, audio')]);
  return {
    marked: marked.length,
    inShadow: marked.filter((e) => e.getRootNode() !== document).length,
    // only OUR sheets (sites such as MDN adopt their own constructed sheets too)
    shadowRootsWithSheet: roots.filter((r) => r !== document && [...r.adoptedStyleSheets].some((sh) => [...sh.cssRules].some((x) => x.cssText.includes('0.01ms') || x.cssText.includes('data-rs-calm')))).length,
    shadowRoots: roots.length - 1,
    visible,
    mutedPlaying: media.filter((m) => !m.paused && (m.muted || m.volume === 0)).length,
    loudPlaying: media.filter((m) => !m.paused && !(m.muted || m.volume === 0)).length,
    attrs: marked.length + roots.reduce((n, r) => n + r.querySelectorAll('[data-rs-calm-reveal]').length, 0) + (document.documentElement.hasAttribute('data-rs-calm-show-all') ? 1 : 0),
    layout: marked.slice(0, 50).map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y + scrollY)}`; }).join(';'),
    running: document.getAnimations().filter((a) => a.playState === 'running').length,
  };
};
const P = {
  calm: () => document.querySelector('[data-mode="calm"] [role="switch"]').click(),
  blur: () => document.querySelectorAll('[data-mode="calm"] input[type="checkbox"]')[1].click(),
  strength: (v) => { const r = document.querySelector(`[data-mode="calm"] input[value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); },
  showAll: () => document.querySelector('[data-mode="calm"] .rs-group button').click(),
  state: () => ({ word: document.querySelector('[data-mode="calm"] .rs-mode__state').textContent, btn: document.querySelector('[data-mode="calm"] .rs-group button').textContent, alert: document.querySelector('[role="alert"]').textContent }),
};
const shots = async (page, rects) => { const out = []; for (const r of rects) out.push(r.width > 4 && r.height > 4 ? sharpness(await page.screenshot({ clip: r })) : null); return out; };

const h = await launch();
const bs = await h.ctx.browser().newBrowserCDPSession();
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
    const i0 = await page.evaluate(INFO);
    r.shadowRootsBefore = i0.shadowRoots;
    r.before = { mutedPlaying: i0.mutedPlaying, loudPlaying: i0.loudPlaying, running: i0.running };
    const errBefore = errors.length;

    const p = await popupClient(h, bs, page, OUT);
    await p.evaluate(P.calm);
    await sleep(300);
    const iM = await page.evaluate(INFO);
    r.motion = { running: iM.running, mutedPlaying: iM.mutedPlaying, loudPlaying: iM.loudPlaying };
    await p.evaluate(P.blur);
    await sleep(600);
    await page.mouse.move(1279, 719);
    await sleep(100);
    const i1 = await page.evaluate(INFO);
    r.marked = i1.marked;
    r.inShadow = i1.inShadow;
    r.shadowRootsWithSheet = i1.shadowRootsWithSheet;
    const light = await shots(page, i1.visible);
    await page.screenshot({ path: new URL(`calm-site-${name}-1-light.png`, OUT).pathname });
    // clear reference: Show all images
    await p.evaluate(P.showAll);
    await sleep(250);
    const clear = await shots(page, i1.visible);
    r.showAllBtn = (await p.evaluate(P.state)).btn;
    await page.screenshot({ path: new URL(`calm-site-${name}-2-show-all.png`, OUT).pathname });
    await p.evaluate(P.showAll);
    await p.evaluate(P.strength, 'strong');
    await sleep(250);
    const strong = await shots(page, i1.visible);
    r.samples = i1.visible.map((v, k) => ({ inShadow: v.inShadow, clear: clear[k], light: light[k], strong: strong[k] }));
    r.blurVerified = r.samples.filter((s) => s.clear > 2 && s.light < s.clear * 0.6).length + '/' + r.samples.filter((s) => s.clear > 2).length;
    r.strongerVerified = r.samples.filter((s) => s.clear > 2 && s.strong <= s.light).length + '/' + r.samples.filter((s) => s.clear > 2).length;
    r.layoutStable = i1.layout === (await page.evaluate(INFO)).layout;
    // hover reveal on the first sample
    if (i1.visible[0]) {
      const v = i1.visible[0];
      await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
      await sleep(120);
      const hv = sharpness(await page.screenshot({ clip: v }));
      r.hoverReveal = clear[0] > 2 ? hv > clear[0] * 0.7 : null;
      await page.mouse.move(1279, 719);
    }
    // dynamic: scroll to load more
    for (let k = 0; k < 4; k++) (await page.mouse.wheel(0, 900), await sleep(350));
    await sleep(500);
    r.markedAfterScroll = (await page.evaluate(INFO)).marked;
    await page.evaluate(() => scrollTo(0, 0));
    await p.evaluate(P.strength, 'light');
    r.popup = await p.evaluate(P.state);
    // off: cleanup
    await p.evaluate(P.calm);
    await sleep(400);
    const i2 = await page.evaluate(INFO);
    r.cleanup = { attrs: i2.attrs, shadowRootsWithSheet: i2.shadowRootsWithSheet };
    r.pageErrorsDuringCalm = errors.length - errBefore;
    await p.evaluate(P.blur); // reset saved Blur to off for the next site
    await p.close();
    r.ok = true;
  } catch (e) {
    r.error = String(e?.message ?? e).split('\n')[0].slice(0, 160);
  } finally {
    await page.close().catch(() => {});
  }
  console.log(r.ok ? `DONE ${name} st=${r.status} marked=${r.marked} shadow=${r.inShadow}/${r.shadowRootsWithSheet} blur=${r.blurVerified} strong>=light=${r.strongerVerified} layout=${r.layoutStable} hover=${r.hoverReveal} showAll=${r.showAllBtn} scroll=${r.markedAfterScroll} muted ${r.before.mutedPlaying}->${r.motion.mutedPlaying} loud ${r.before.loudPlaying}->${r.motion.loudPlaying} anim ${r.before.running}->${r.motion.running} cleanup=${JSON.stringify(r.cleanup)} roots=${r.shadowRootsBefore} errs=${r.pageErrorsDuringCalm} title=${r.title}` : `ERR  ${name} ${r.error}`);
}
fs.writeFileSync(new URL('calm-sites.json', OUT), JSON.stringify(results, null, 2));
await h.close();
