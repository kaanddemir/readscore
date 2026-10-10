# ReadScore Privacy Policy

Last updated: October 10, 2026 · Applies to ReadScore 2.0.0

ReadScore is a Chrome extension that makes the page you are viewing easier to read with three modes: **Focus**, **Comfort** and **Calm**. Page processing happens locally in your browser.

## Summary

- ReadScore makes no network requests. It has no servers, analytics, advertising, telemetry or tracking code.
- Nothing ReadScore processes is sent to the developer or to any third party.
- ReadScore runs on a tab only after you open its popup there.
- Page text, images, videos, URLs and reading activity are never stored.
- Only your settings are saved. Chrome may sync them across your signed-in browsers.

## What ReadScore processes

**Page content.** When you open ReadScore on a page, its runtime reads the page's structure, text layout, images and video state in that tab to apply the modes you turn on. Focus finds readable paragraphs, Comfort adjusts text styles, and Calm identifies large images and background videos. Images are classified by their element type and size; their pixels are not read. This information stays in the tab's memory and is discarded when the page is reloaded, navigated away from or closed.

**Keys.** With Focus in Keyboard mode, ReadScore listens for `J`, `K` and `Esc` on the page. Other keys are ignored and no keystrokes are recorded.

**Temporary state.** The current Focus paragraph, the paused state and Calm's **Show All Images** state are kept only in the page's memory.

## Where data is kept

| Data | Where | Removed when |
| --- | --- | --- |
| Mode settings and theme | `chrome.storage.sync` | ReadScore is uninstalled (**Reset All** restores the defaults) |
| Popup theme cache | The popup's local storage on this device | ReadScore is uninstalled |
| Page analysis and temporary state | Memory of the page's ReadScore runtime | The page is reloaded, navigated away from or closed |

Settings include whether each mode is on and the options chosen for it, such as highlight colour, spacing, font, text size and blur strength. They contain no page content.

`chrome.storage.sync` is managed by Chrome. When Chrome sync is turned on, Chrome may synchronize these settings through your Google account to other Chrome browsers where you are signed in, under Google's privacy policy. ReadScore itself does not transmit them or operate a server. When sync is off, they stay in your Chrome profile on this device.

When ReadScore is installed or updated, it deletes any settings left by ReadScore 1.x from `chrome.storage.local`.

## Network and external services

ReadScore does not use cookies, remote code, artificial intelligence services or any other external service. The bundled Atkinson Hyperlegible font is read from the extension package, not downloaded. Chrome itself may handle installation and updates under Google's policies.

## Sharing

ReadScore does not transmit, sell or share any data. The developer never receives it.

ReadScore's use of information received through Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used only to provide the reading features described here.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Temporary access to the current tab after you open the ReadScore popup. |
| `scripting` | Inject the ReadScore runtime and reading styles into that tab on demand. |
| `storage` | Save your settings in Chrome's synced extension storage. |

ReadScore requests no host permissions and is not injected into pages automatically. Chrome blocks extensions on its own pages, the Chrome Web Store and other restricted pages.

## Your control

- Modes apply only when you turn them on, and each can be turned off at any time.
- **Reset All** restores the default settings.
- Reloading or leaving the page removes all of ReadScore's effects and temporary state from it.
- Uninstalling ReadScore removes the extension and its storage.

## Changes and contact

Changes to this policy will be published in this file with an updated date. Questions can be sent to [heykaan.dev@gmail.com](mailto:heykaan.dev@gmail.com) or raised on the project's GitHub issue tracker: <https://github.com/kaanddemir/readscore/issues>.
