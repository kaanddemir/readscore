/**
 * CDP client for the REAL extension popup (opened through the toolbar action). Shared by the popup UI
 * check and the Comfort checks. Playwright cannot address extension popups directly, so this talks
 * to the popup target over a non flattened CDP session.
 */
import fs from 'node:fs';
import { sleep } from './harness.mjs';

/** Opens the real popup for `page` and returns a small CDP client attached to it. */
export async function popupClient(h, bs, page, outDir) {
  const target = await h.clickAction(page);
  if (!target) throw new Error('popup did not open');
  const { sessionId } = await bs.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let nextId = 1;
  const pending = new Map();
  bs.on('Target.receivedMessageFromTarget', (e) => {
    if (e.sessionId !== sessionId) return;
    const msg = JSON.parse(e.message);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      bs.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });
  const evaluate = async (fn, arg) => {
    const r = await send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg ?? null)})`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const key = async (k) => {
    const map = { Tab: ['Tab', 'Tab', 9, ''], ShiftTab: ['Tab', 'Tab', 9, ''], Space: [' ', 'Space', 32, ' '], Enter: ['Enter', 'Enter', 13, '\r'], ArrowRight: ['ArrowRight', 'ArrowRight', 39, ''] };
    const [keyName, code, vk, text] = map[k];
    const modifiers = k === 'ShiftTab' ? 8 : 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: vk, text, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(60);
  };
  // Chrome caps popups at 600px tall; a beyond-viewport capture of a popup tiles the viewport, so tall
  // states are captured as scrolled viewport parts (-1, -2, ...). The theme is pinned with data-theme
  // because captures drop emulated media (same mechanism as the manual theme choice).
  const shot = async (name) => {
    await sleep(800); // let Chrome finish resizing the popup (its size label overlays early captures)
    const theme = name.startsWith('dark') ? 'dark' : 'light';
    const prev = await evaluate((t) => { const p = document.documentElement.dataset.theme ?? null; document.documentElement.dataset.theme = t; return p; }, theme);
    const { total, view } = await evaluate(() => ({ total: document.documentElement.scrollHeight, view: innerHeight }));
    const parts = Math.max(1, Math.ceil((total - 1) / view));
    for (let i = 0; i < parts; i++) {
      await evaluate((y) => scrollTo(0, y), i * view);
      await sleep(120);
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(new URL(`popup-${name}${parts > 1 ? `-${i + 1}` : ''}.png`, outDir), Buffer.from(r.data, 'base64'));
    }
    await evaluate(() => scrollTo(0, 0));
    await evaluate((p) => (p ? (document.documentElement.dataset.theme = p) : delete document.documentElement.dataset.theme), prev);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  // Paint-time auto darkening is invisible to computed styles; keep screenshots faithful to our CSS.
  await send('Emulation.setAutoDarkModeOverride', { enabled: false });
  // Wait until the popup finished connecting (aria-busy cleared), polling up to 5 s.
  await evaluate(() => new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => { const app = document.getElementById('app'); if ((app && app.childElementCount && !app.hasAttribute('aria-busy')) || Date.now() - t0 > 5000) resolve(); else setTimeout(poll, 50); };
    poll();
  }));
  /** Closes this popup (like the user clicking away). */
  const close = async () => {
    await bs.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
  };
  return { send, evaluate, key, shot, close };
}
