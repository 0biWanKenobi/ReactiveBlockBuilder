import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export const blockSelector =
  'section[data-sheet-container], p[data-sheet-text], [data-sheet-block]';
export const blockTypes = new Set(['container', 'textBlock', 'formula', 'image']);
const dragModeKey = new PluginKey<boolean>('rbbBlockDragMode');

export function isBlockDragMode(state: EditorState): boolean {
  return dragModeKey.getState(state) === true;
}

export function canDragBlocks(view: EditorView): boolean {
  return view.editable ||
    (isBlockDragMode(view.state) && view.props.editable?.(view.state) !== false);
}

export function setBlockDragMode(view: EditorView, enabled: boolean): void {
  if (isBlockDragMode(view.state) === enabled) return;
  view.dispatch(view.state.tr.setMeta(dragModeKey, enabled).setMeta('addToHistory', false));
}

export function blockBoundary(view: EditorView, element: Element): { from: number; to: number } | null {
  const parent = element.parentNode;
  if (!parent || !view.dom.contains(element)) return null;

  const index = Array.prototype.indexOf.call(parent.childNodes, element) as number;
  if (index < 0) return null;

  try {
    const from = view.posAtDOM(parent, index);
    const node = view.state.doc.nodeAt(from);
    if (!node || !blockTypes.has(node.type.name)) return null;
    return { from, to: from + node.nodeSize };
  } catch {
    return null;
  }
}

/** Disable native content editing while keeping block drag events available. */
export const BlockInteraction = Extension.create({
  name: 'blockInteraction',

  addProseMirrorPlugins() {
    return [new Plugin<boolean>({
      key: dragModeKey,
      state: {
        init: () => false,
        apply(transaction, current) {
          return transaction.getMeta(dragModeKey) ?? current;
        }
      },
      props: {
        editable: (state) => !isBlockDragMode(state),
        attributes: (state) => ({ 'data-rbb-drag-mode': String(isBlockDragMode(state)) }),
        handleDOMEvents: {
          mousedown(view, event) {
            if (!isBlockDragMode(view.state) || !canDragBlocks(view) || event.button !== 0) return false;
            const block = event.target instanceof Element ? event.target.closest(blockSelector) : null;
            const boundary = block ? blockBoundary(view, block) : null;
            if (boundary) {
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, boundary.from)));
            }
            return false;
          }
        },
        decorations(state) {
          if (!isBlockDragMode(state)) return DecorationSet.empty;
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (blockTypes.has(node.type.name)) {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { draggable: 'true' }));
            }
          });
          return DecorationSet.create(state.doc, decorations);
        }
      }
    })];
  }
});
