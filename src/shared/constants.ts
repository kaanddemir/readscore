declare const __BUILD_ID__: string;

/** Unique per build; lets the popup detect and replace a runtime injected by an older build. */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** Path of the bundled content runtime inside dist/. */
export const CONTENT_RUNTIME_FILE = 'content/runtime.js';

/** Global key used by the content runtime's injection guard (isolated world only). */
export const RUNTIME_GLOBAL_KEY = '__readScoreV2__';

const RESTRICTED_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'chrome-search://',
  'chrome-untrusted://',
  'devtools://',
  'edge://',
  'about:',
  'view-source:',
  'data:',
  'javascript:',
];

const RESTRICTED_URL_PARTS = ['chromewebstore.google.com', 'chrome.google.com/webstore', 'microsoftedge.microsoft.com/addons'];

/**
 * Known page classes where Chrome forbids script injection. Returns false for unknown URLs;
 * injection errors are reported separately.
 */
export function isRestrictedUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (RESTRICTED_PREFIXES.some((p) => lower.startsWith(p))) return true;
  return RESTRICTED_URL_PARTS.some((p) => lower.includes(p));
}
