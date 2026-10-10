# Browser tests

Real Chromium checks for the built extension. They complement the unit tests (`npm test`), which stay
the standard validation for every change.

## Setup

Playwright is not a project dependency. Point `PLAYWRIGHT_DIR` at a directory that contains the
`playwright` package (an npx cache works) and install Chromium once:

```sh
npx playwright install chromium
export PLAYWRIGHT_DIR=~/.npm/_npx/<hash>/node_modules
```

The harness uses Playwright's Chromium. Set `CHROME_PATH` to use another Chromium or Chrome for Testing
build (branded Chrome ignores `--load-extension`). Each run uses a temporary browser profile.

The runner builds `dist/` once, runs the suites in order and prints a timed summary. Screenshots and
JSON results go to a new directory under the OS temp directory (printed at the start of the run), so
nothing is written to the repository. Set `SHOT_DIR` to choose the directory.

## Which tests to run

| Change | Run |
| --- | --- |
| Small change | `npm test` and the touched feature's suite, e.g. `npm run test:browser:focus` |
| Feature change | `npm test`, the feature suite and `npm run test:browser:core` |
| Major architecture change | `npm run check` and `npm run test:browser:all` |
| Release | `npm run test:release` (check, full local suite, full site sweeps) |

Site sweeps need the network. They are not part of routine validation: run `npm run test:sites` when a
change affects detection or styling on real pages.

## Commands

| Command | Runs | Network |
| --- | --- | --- |
| `npm run test:browser:core` | smoke, popup-ui | no |
| `npm run test:browser:focus` / `:comfort` / `:calm` | that feature's fixture suite | no |
| `npm run test:browser:all` | smoke, popup-ui, focus, comfort, calm | no |
| `npm run test:browser -- <suite or group> ...` | any mix, e.g. `focus calm` or `core focus` | depends |
| `npm run test:sites` | focus, comfort and calm sweeps on 4 sites: heykaan.dev, Wikipedia, GitHub, YouTube | yes |
| `npm run test:sites:full` | the same sweeps on every site in each script | yes |
| `npm run test:release` | `check`, then the full local suite, then the full sweeps | yes |

Pass `--no-build` to the runner to reuse an existing `dist/`. `SITES=name=url,...` overrides a sweep's
site list. `WAIT=ms` changes how long a sweep waits after loading each site.

## Suites

| Suite | Covers |
| --- | --- |
| `smoke` | extension loads, popup injects the runtime, re-injection no-op, DOM untouched, navigation cleanup |
| `popup-ui` | Paper layout and alignment, themes, tab order, accessible names, target sizes |
| `focus` | detection and order (description lists, Shadow DOM, nested scrolling, dynamic content, consent shells), keys, pause, Follow scroll, highlight colours with pixel checks, Comfort/Calm coexistence, cleanup |
| `comfort` | spacing, fonts, minimum size, presets, multiple tabs, Reset all |
| `calm` | reduced motion, image and video blur (incl. thumbnails in clickable tiles), Show all images, cleanup |
| `*-sites` | the same features on real websites |

Local fixtures live in `fixtures/` and are served from `127.0.0.1`.
