/** Create reactive node attributes for Svelte-backed Tiptap node views. */
export function reactiveNodeAttrs<T extends object>(value: T): T {
  const attrs = $state(value);
  return attrs;
}
