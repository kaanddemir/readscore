/**
 * Inline SVG icon set: 24 unit viewBox, stroke 1.75, round caps and joins, colour from currentColor.
 * Size comes from CSS (.rs-icon / .rs-icon--sm → --rs-icon-*). Icons are decorative (aria-hidden);
 * the control that holds one always has a visible label or an accessible name.
 */
const PATHS = {
  chevron: 'M6 9l6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  reset: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  warning: 'M12 9v4M12 17h.01M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  error: 'M12 8v5M12 16.5h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
} as const;
export type IconName = keyof typeof PATHS;

const NS = 'http://www.w3.org/2000/svg';

export function icon(name: IconName, size: 'sm' | 'md' = 'md'): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `rs-icon${size === 'sm' ? ' rs-icon--sm' : ''}${name === 'more' ? ' rs-icon--dots' : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
