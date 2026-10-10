<p align="center">
  <img src="icons/icon128.png" alt="ReadScore" width="96">
</p>

<h1 align="center">ReadScore</h1>

<p align="center">
  A Chrome extension that makes existing web pages easier to read,<br>
  without replacing their content.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/readscore/ocklmdaccbpakdjnkhckobkoochkajeg"><b>Install from the Chrome Web Store</b></a>
</p>

## How it works

1. Open a web page and click the **ReadScore** icon in the Chrome toolbar.
2. Turn on **Focus**, **Comfort** or **Calm** and adjust their settings.
3. The changes apply to the page right away. **Reset All** in the menu restores the defaults.

The modes work independently and can be combined. ReadScore runs on a page only after you open the popup there, and effects end when the page is reloaded or you navigate away. Open the popup again to reapply your saved settings.

## Focus

Highlights one paragraph at a time.

- **Keyboard**: move with `J` and `K`
- **Follow Scroll**: the highlight follows the middle of the screen as you scroll
- Yellow, blue, green or dark highlight
- **Pause** and **Resume** from the popup or with `Esc`

## Comfort

Adjusts reading text without changing the page's layout or content.

- **Spacing**: Site, Relaxed, Roomy (the WCAG 1.4.12 text spacing values) or Custom line, letter, word and paragraph spacing
- **Font**: the site's own, sans serif, serif or the bundled Atkinson Hyperlegible
- **Text Size**: a minimum of 18, 20 or 22 px; larger text is left as it is

## Calm

Reduces distractions on busy pages.

- **Reduce Motion** makes animations and transitions finish instantly and pauses muted background videos. Videos you start yourself keep playing.
- **Blur Images** blurs large images and videos (Light or Strong) until you hover over or Tab to them
- **Show All Images** reveals every blurred image on the page until you blur them again

## Keyboard controls

With Focus set to **Keyboard**:

| Key | Action |
| --- | --- |
| `J` | Next Paragraph |
| `K` | Previous Paragraph |
| `Esc` | Pause Focus |
| `J` or `K` while paused | Resume at the remembered paragraph |

ReadScore ignores these keys while you type, use a form control or focused widget, hold a modifier key or have a dialog open. Some sites use `J` and `K` themselves; choose **Follow Scroll** there to keep the site's shortcuts.

## Installation

**From the Chrome Web Store:** open [ReadScore on the Chrome Web Store](https://chromewebstore.google.com/detail/readscore/ocklmdaccbpakdjnkhckobkoochkajeg) and choose **Add to Chrome**.

**From source** (Chrome 116 or newer, Node.js 22.12 or newer):

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the `dist` folder.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | Access the current tab, only after you open the popup |
| `scripting` | Load ReadScore and its reading styles into that tab |
| `storage` | Save your settings in Chrome's synced extension storage |

ReadScore requests no host permissions and has no content scripts that run automatically.

## Privacy

ReadScore has no accounts, servers, analytics or tracking, and makes no network requests. Page text and images are processed in the tab and never stored or sent anywhere. Your settings are saved with `chrome.storage.sync`, so Chrome may sync them to other browsers signed in to the same Google account when Chrome sync is on.

Read the full [Privacy Policy](PRIVACY_POLICY.md).

## Good to know

- Works on regular websites. Chrome's own pages and the Chrome Web Store cannot be changed by extensions.
- Focus works best on article-like text and cannot reach content inside closed shadow roots.
- Calm decides which images are meaningful with heuristics. Background images and closed shadow roots are not always detected.
- Muted video autoplay varies by site and browser policy.
- A larger minimum text size can cut off labels on some sites.

## Development

```bash
npm run dev                 # rebuild dist on every change
npm test                    # unit tests
npm run check               # typecheck, unit tests, production build and dist verification
npm run test:browser:core   # browser smoke and popup checks (local fixtures)
npm run test:browser:all    # full local browser regression
npm run test:sites          # real website sweeps (network)
npm run test:release        # check, full local regression and full site sweeps
```

Individual steps are also available as `npm run typecheck`, `npm run build` and `npm run verify`, and each mode has its own browser suite (`test:browser:focus`, `:comfort`, `:calm`). Browser tests need Playwright installed outside the project; see [tests/browser](tests/browser/README.md) for setup and for which tests to run for which change. Release notes are in the [Changelog](CHANGELOG.md).

## Project structure

```text
src/background/   service worker and page stylesheet management
src/content/      injected runtime and the Focus, Comfort and Calm modes
src/shared/       settings, messages and generated mode CSS
src/ui/           popup, shared components, icons and design tokens
scripts/          production build and dist verification
tests/unit/       unit and DOM tests
tests/browser/    real Chromium checks, fixtures and site sweeps
icons/, fonts/    extension icons and the bundled Atkinson Hyperlegible font
assets/brand/     icon SVG masters and the icon renderer
```

## License

Released under the [MIT License](LICENSE). Atkinson Hyperlegible (Braille Institute) is licensed under the [SIL Open Font License 1.1](fonts/OFL.txt).
