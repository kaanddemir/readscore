/**
 * Tiny DOM helpers for extension pages. Text is always set through textContent, never innerHTML.
 */
type Child = Node | string | null | undefined | false;
interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Replaces all children of `root`. */
export function mount(root: Element, ...children: Child[]): void {
  root.replaceChildren(...children.filter((c): c is Node | string => !!c));
}
