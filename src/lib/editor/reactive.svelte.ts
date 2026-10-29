/** The shared character values live outside ProseMirror's document model. */
export function reactiveNodeAttrs<T extends object>(value: T): T {
  return $state(value);
}
