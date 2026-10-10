/**
 * Reusable popup components. Native controls wherever one exists; every component returns its root
 * node plus a small `set` API so the view can update state without rebuilding (which would lose focus).
 * Class names follow BEM (rs-block__element--modifier) and map 1:1 to rules in popup.css.
 */
import { el } from './el';
import { icon, type IconName } from './icons';

let uid = 0;
export const nextId = (prefix: string): string => `rs-${prefix}-${++uid}`;

// ───────────────────────── Switch ─────────────────────────
/** On/off switch: <button role="switch">. State is shown by thumb position AND a check mark (not colour only). */
export function switchControl(opts: { labelledBy: string; describedBy?: string; checked: boolean; onChange(next: boolean): void }) {
  const thumb = el('span', { class: 'rs-switch__thumb' }, icon('check', 'sm'));
  const node = el('button', { class: 'rs-switch', attrs: { type: 'button', role: 'switch', 'aria-labelledby': opts.labelledBy } }, thumb);
  if (opts.describedBy) node.setAttribute('aria-describedby', opts.describedBy);
  const set = (checked: boolean) => node.setAttribute('aria-checked', String(checked));
  const setDisabled = (disabled: boolean) => (node.disabled = disabled);
  set(opts.checked);
  node.addEventListener('click', () => opts.onChange(node.getAttribute('aria-checked') !== 'true'));
  return { node, set, setDisabled };
}

// ───────────────────────── Buttons ─────────────────────────
export type ButtonVariant = 'primary' | 'secondary' | 'quiet';
/** `block` fills the column (for actions that belong to a full width group, never for quiet text actions). */
export function button(opts: { label: string; variant?: ButtonVariant; icon?: IconName; onClick(): void; describedBy?: string; block?: boolean }) {
  const node = el('button', { class: `rs-button rs-button--${opts.variant ?? 'secondary'}${opts.block ? ' rs-button--block' : ''}`, attrs: { type: 'button' } }, opts.icon ? icon(opts.icon, 'sm') : null, el('span', { text: opts.label }));
  if (opts.describedBy) node.setAttribute('aria-describedby', opts.describedBy);
  node.addEventListener('click', opts.onClick);
  return node;
}

/** Square icon only button. `label` is its accessible name (and native tooltip). */
export function iconButton(opts: { label: string; icon: IconName; onClick(): void; size?: 'sm' | 'md' }) {
  const node = el('button', { class: `rs-icon-button${opts.size === 'sm' ? ' rs-icon-button--sm' : ''}`, attrs: { type: 'button', 'aria-label': opts.label, title: opts.label } }, icon(opts.icon, opts.size === 'sm' ? 'sm' : 'md'));
  node.addEventListener('click', opts.onClick);
  return node;
}

/** Full width disclosure row (<details>) with an optional control (e.g. a reset button) between the label and the chevron. Clicking it does not toggle the row. */
export function disclosureRowWithAction(label: string, action: HTMLElement | null, ...content: Node[]) {
  action?.addEventListener('click', (e) => e.preventDefault());
  return el(
    'details',
    { class: 'rs-advanced' },
    el('summary', { class: `rs-advanced__summary${action ? ' rs-advanced__summary--action' : ''}` }, el('span', { text: label }), ...(action ? [action] : []), el('span', { class: 'rs-advanced__chevron' }, icon('chevron'))),
    el('div', { class: 'rs-advanced__body' }, ...content),
  );
}

/** Disclosure toggle (aria-expanded + aria-controls). The chevron rotates via CSS. */
export function disclosureButton(opts: { label: string; controls: string; onToggle(): void }) {
  const node = el('button', { class: 'rs-icon-button rs-disclosure', attrs: { type: 'button', 'aria-label': opts.label, title: opts.label, 'aria-controls': opts.controls, 'aria-expanded': 'false' } }, icon('chevron'));
  node.addEventListener('click', opts.onToggle);
  return { node, set: (expanded: boolean) => node.setAttribute('aria-expanded', String(expanded)) };
}

// ───────────────────────── Fields ─────────────────────────
export interface Option<V extends string> {
  value: V;
  label: string;
}

/** Segmented control: native radio group in a fieldset (arrow keys work natively). */
export function segmented<V extends string>(opts: { legend: string; options: readonly Option<V>[]; value: V; onChange(v: V): void; describedBy?: string }) {
  const name = nextId('seg');
  const inputs = opts.options.map((o) => {
    const input = el('input', { class: 'rs-segmented__input', attrs: { type: 'radio', name, value: o.value } });
    input.addEventListener('change', () => input.checked && opts.onChange(o.value));
    return { input, node: el('label', { class: 'rs-segmented__option' }, input, el('span', { class: 'rs-segmented__label', text: o.label })) };
  });
  const node = el('fieldset', { class: 'rs-field rs-segmented' }, el('legend', { class: 'rs-field__label', text: opts.legend }), el('div', { class: 'rs-segmented__track' }, ...inputs.map((i) => i.node)));
  if (opts.describedBy) node.setAttribute('aria-describedby', opts.describedBy);
  const set = (v: V) => inputs.forEach((i) => (i.input.checked = i.input.value === v));
  const setDisabled = (disabled: boolean) => (node.disabled = disabled);
  set(opts.value);
  return { node, set, setDisabled };
}

export function selectField<V extends string>(opts: { label: string; options: readonly Option<V>[]; value: V; onChange(v: V): void }) {
  const id = nextId('select');
  const select = el('select', { class: 'rs-select', attrs: { id } }, ...opts.options.map((o) => el('option', { text: o.label, attrs: { value: o.value } })));
  select.addEventListener('change', () => opts.onChange(select.value as V));
  // Stacked like every other field: label above, control across the full column.
  // The native arrow is replaced by the shared chevron, placed in the same column as every other chevron.
  const node = el('div', { class: 'rs-field' }, el('label', { class: 'rs-field__label', text: opts.label, attrs: { for: id } }), el('div', { class: 'rs-select-wrap' }, select, el('span', { class: 'rs-select-wrap__chevron' }, icon('chevron'))));
  const set = (v: V) => (select.value = v);
  set(opts.value);
  return { node, set, setDisabled: (d: boolean) => (select.disabled = d) };
}

/** Checkbox row: native checkbox, label, optional help text linked with aria-describedby. */
export function checkboxRow(opts: { label: string; checked: boolean; help?: string; onChange(v: boolean): void }) {
  const id = nextId('check');
  const input = el('input', { class: 'rs-check__input', attrs: { type: 'checkbox', id } });
  input.addEventListener('change', () => opts.onChange(input.checked));
  const help = opts.help ? el('p', { class: 'rs-help', text: opts.help, attrs: { id: `${id}-help` } }) : null;
  if (help) input.setAttribute('aria-describedby', help.id);
  const node = el('div', { class: 'rs-check' }, input, el('div', { class: 'rs-check__text' }, el('label', { class: 'rs-check__label', text: opts.label, attrs: { for: id } }), help));
  const set = (v: boolean) => (input.checked = v);
  const setDisabled = (d: boolean) => {
    input.disabled = d;
    node.classList.toggle('rs-check--disabled', d);
  };
  set(opts.checked);
  return { node, set, setDisabled, help };
}

/** Labelled slider: native range + visible <output> + per setting reset button. */
export function slider(opts: { label: string; min: number; max: number; step: number; value: number; format(v: number): string; spoken(v: number): string; resetLabel: string; onInput(v: number): void; onReset(): void }) {
  const id = nextId('range');
  const input = el('input', { class: 'rs-slider__input', attrs: { type: 'range', id, min: String(opts.min), max: String(opts.max), step: String(opts.step) } });
  const output = el('output', { class: 'rs-slider__value', attrs: { for: id, 'aria-hidden': 'true' } });
  const reset = iconButton({ label: opts.resetLabel, icon: 'reset', size: 'sm', onClick: opts.onReset });
  const set = (v: number) => {
    input.value = String(v);
    output.textContent = opts.format(v);
    input.setAttribute('aria-valuetext', opts.spoken(v));
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    set(v);
    opts.onInput(v);
  });
  const node = el('div', { class: 'rs-slider' }, el('label', { class: 'rs-slider__label', text: opts.label, attrs: { for: id } }), output, reset, input);
  set(opts.value);
  // Hidden with visibility (not display) so the row never shifts when a value returns to its default.
  return { node, set, setResetVisible: (visible: boolean) => reset.setAttribute('data-visible', String(visible)) };
}

// ───────────────────────── Feedback ─────────────────────────
export type Tone = 'info' | 'warning' | 'danger' | 'success';
const TONE_ICON: Record<Tone, IconName> = { info: 'info', warning: 'warning', danger: 'error', success: 'check' };

/** Inline message: icon + text (+ optional action). Tone is never conveyed by colour alone (icon shape differs). */
/** `quiet` renders a low emphasis notice (muted text and icon) for standing information. */
export function message(opts: { tone: Tone; text: string; quiet?: boolean; action?: { label: string; onClick(): void } }) {
  return el(
    'div',
    { class: `rs-message rs-message--${opts.tone}${opts.quiet ? ' rs-message--quiet' : ''}` },
    icon(TONE_ICON[opts.tone]),
    el('p', { class: 'rs-message__text', text: opts.text }),
    opts.action ? button({ label: opts.action.label, variant: 'quiet', onClick: opts.action.onClick }) : null,
  );
}

/** Help text paragraph with a stable id for aria-describedby. `attached` pulls it close to the field above. */
export function help(text: string, attached = false) {
  return el('p', { class: attached ? 'rs-help rs-help--attached' : 'rs-help', text, attrs: { id: nextId('help') } });
}
