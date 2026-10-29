import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { selectedBlock } from './selection.js';

export const blockSelector =
  'section[data-custom-block-type], section[data-sheet-container], p[data-sheet-text], [data-sheet-block]';
export const blockTypes = new Set(['container', 'textBlock', 'formula', 'image', 'customBlock']);
const dragModeKey = new PluginKey<boolean>('rbbBlockDragMode');
const hoverKey = new PluginKey<number | null>('rbbHoveredBlock');

/** ProseMirror-managed decoration prevents its DOM observer from reverting hover styles. */
export function setHoveredBlock(view: EditorView, element: Element | null): void {
  const boundary = element ? blockBoundary(view, element) : null;
  const pos = boundary?.from ?? null;
  if (hoverKey.getState(view.state) === pos) return;
  view.dispatch(view.state.tr.setMeta(hoverKey, pos).setMeta('addToHistory', false));
}

export function isBlockDragMode(state: EditorState): boolean {
  return dragModeKey.getState(state) === true;
}

export function canDragBlocks(view: EditorView): boolean {
  // Tiptap remains editable in Design/Edit mode, but block dragging is
  // intentionally enabled only by the dedicated Drag tool.
  return isBlockDragMode(view.state);
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

/** A custom block is indivisible in the sheet's drag mode. */
export function outermostCustomBlock(view: EditorView, target: Element): Element | null {
  let outermost: Element | null = null;
  let current: Element | null = target;
  while (current && current !== view.dom) {
    if (current.matches('section[data-custom-block-type]')) outermost = current;
    current = current.parentElement;
  }
  return outermost;
}

/** The deepest block under the pointer, except that custom blocks drag atomically. */
export function pointerBlock(view: EditorView, target: EventTarget | null): HTMLElement | null {
  const element = target instanceof Element ? target
    : target instanceof globalThis.Node ? target.parentElement : null;
  if (!element || !view.dom.contains(element)) return null;
  const block = (isBlockDragMode(view.state) ? outermostCustomBlock(view, element) : null)
    ?? element.closest(blockSelector);
  return block instanceof HTMLElement && view.dom.contains(block) ? block : null;
}

function pointerSelection(view: EditorView, target: EventTarget | null): NodeSelection | null {
  const block = pointerBlock(view, target);
  const boundary = block && blockBoundary(view, block);
  if (!boundary) return null;
  return NodeSelection.create(view.state.doc, boundary.from);
}

/** Disable native content editing while keeping block drag events available. */
export const BlockInteraction = Extension.create({
  name: 'blockInteraction',

  addProseMirrorPlugins() {
    return [new Plugin<number | null>({
      key: hoverKey,
      state: {
        init: () => null,
        apply(transaction, current) {
          if (transaction.docChanged) return null;
          const next = transaction.getMeta(hoverKey);
          return next === undefined ? current : next;
        }
      },
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          // A caret/text selection still selects a block in the inspector.
          // Decorate it without replacing native text selection or editing.
          const selected = state.selection instanceof NodeSelection ? null : selectedBlock({ state });
          const selectedNode = selected && state.doc.nodeAt(selected.pos);
          if (selected && selectedNode && blockTypes.has(selected.type)) {
            decorations.push(Decoration.node(selected.pos, selected.pos + selectedNode.nodeSize,
              { 'data-rbb-selected': '' }));
          }
          const pos = hoverKey.getState(state);
          const node = pos === null || pos === undefined ? null : state.doc.nodeAt(pos);
          if (node && pos !== null && pos !== undefined && blockTypes.has(node.type.name)) {
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-rbb-hovered': '' }));
          }
          return DecorationSet.create(state.doc, decorations);
        }
      }
    }), new Plugin<boolean>({
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
            if (event.button !== 0) return false;
            const block = pointerBlock(view, event.target);
            if (!block) return false;
            const dragMode = isBlockDragMode(view.state);
            // In Edit mode, only intercept clicks on container surfaces.
            // Text, formula and image clicks retain their native editing behavior.
            if (!dragMode && !block.matches('section[data-sheet-container], section[data-custom-block-type]')) {
              return false;
            }
            const selection = pointerSelection(view, event.target);
            if (!selection) return false;
            if (!dragMode) event.preventDefault();
            view.dispatch(view.state.tr.setSelection(selection));
            // Crucial: do not let ProseMirror's own mousedown handler
            // overwrite our block selection, causing flickering.
            // In Drag mode leave native mousedown defaults intact so HTML
            // draggable elements can still start a drag gesture.
            return true;
          },
          click(view, event) {
            const block = pointerBlock(view, event.target);
            if (!block) return false;
            if (!isBlockDragMode(view.state) &&
                !block.matches('section[data-sheet-container], section[data-custom-block-type]')) {
              return false;
            }
            const selection = pointerSelection(view, event.target);
            if (!selection) return false;
            view.dispatch(view.state.tr.setSelection(selection));
            event.preventDefault();
            return true;
          }
        },
        decorations(state) {
          if (!isBlockDragMode(state)) return DecorationSet.empty;
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (!blockTypes.has(node.type.name)) return;
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { draggable: 'true' }));
            // A custom block's descendants are never individual drag targets.
            if (node.type.name === 'customBlock') return false;
          });
          return DecorationSet.create(state.doc, decorations);
        }
      }
    })];
  }
});
