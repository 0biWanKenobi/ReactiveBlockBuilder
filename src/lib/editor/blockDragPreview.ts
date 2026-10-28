import { Extension, type JSONContent } from '@tiptap/core';
import { DOMSerializer, Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { blockSelector, blockTypes, blockBoundary, canDragBlocks, isBlockDragMode } from './blockInteraction.js';

/**
 * A temporary, layout-participating drop placeholder. Unlike a thin drop
 * cursor, it makes siblings in normal flow, flex and CSS grid move aside.
 * No preview information is persisted in the character sheet document.
 */
interface DragPreview {
  pos: number;
  width: number;
  height: number;
  source?: { from: number; to: number };
}

const previewKey = new PluginKey<DragPreview | null>('rbbBlockDropPreview');
const paletteMime = 'application/x-rbb-palette-block';
const paletteDrags = new WeakMap<EditorView, ProseMirrorNode>();

/** Keep the node locally: browsers hide drag payloads until the drop event. */
export function startPaletteDrag(view: EditorView, event: DragEvent, content: JSONContent): void {
  if (!canDragBlocks(view) || !event.dataTransfer || !content.type || !blockTypes.has(content.type)) {
    event.preventDefault();
    return;
  }

  const node = view.state.schema.nodeFromJSON(content);
  const wrapper = document.createElement('div');
  wrapper.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeNode(node));
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(paletteMime, node.type.name);
  event.dataTransfer.setData('text/html', wrapper.innerHTML);
  event.dataTransfer.setData('text/plain', node.textContent);
  paletteDrags.set(view, node);
}

export function endPaletteDrag(view: EditorView): void {
  paletteDrags.delete(view);
  if (!view.isDestroyed) updatePreview(view, null);
}

function paletteBlock(view: EditorView, event: DragEvent): ProseMirrorNode | null {
  return event.dataTransfer?.types.includes(paletteMime)
    ? paletteDrags.get(view) ?? null
    : null;
}

function draggedBlock(view: EditorView): NodeSelection | null {
  // ProseMirror records a directly dragged node separately from the editor
  // selection, which can remain a text cursor (or select another block).
  // The optional node is used by its native drop handler but isn't declared
  // in EditorView.dragging's public type.
  const dragging = view.dragging as (NonNullable<EditorView['dragging']> & {
    node?: NodeSelection;
  }) | null;
  if (!dragging) return null;
  return dragging.node ?? (view.state.selection instanceof NodeSelection
    ? view.state.selection
    : null);
}

function isHorizontalLayout(element: Element): boolean {
  const parent = element.parentElement;
  if (!parent) return false;
  const style = getComputedStyle(parent);
  return (
    style.display.includes('grid') ||
    (style.display.includes('flex') && style.flexDirection.startsWith('row'))
  );
}

function insertAfter(element: Element, event: DragEvent): boolean {
  const rect = element.getBoundingClientRect();
  return isHorizontalLayout(element)
    ? event.clientX >= rect.left + rect.width / 2
    : event.clientY >= rect.top + rect.height / 2;
}

function nearestBlock(container: Element, event: DragEvent): Element | null {
  let nearest: Element | null = null;
  let distance = Infinity;
  for (const child of Array.from(container.children)) {
    if (!child.matches(blockSelector)) continue;
    const rect = child.getBoundingClientRect();
    // Distance to the block's rectangle rather than its centre helps with
    // large nested containers and uneven grid-cell sizes.
    const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
    const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
    const next = dx * dx + dy * dy;
    if (next < distance) {
      distance = next;
      nearest = child;
    }
  }
  return nearest;
}

function targetPosition(view: EditorView, event: DragEvent): number | null {
  const rawTarget = event.target instanceof Element
    ? event.target
    : event.target instanceof Node
      ? event.target.parentElement
      : null;
  let block = rawTarget?.closest(blockSelector) ?? null;
  if (block && !view.dom.contains(block)) block = null;

  const container = rawTarget === view.dom
    ? view.dom
    : block?.matches('section[data-sheet-container]') && rawTarget === block
      ? block
      : null;
  if (container) {
    // Resolve gaps and outer gutters against direct children, including at
    // the document root. Coordinate mapping alone descends into the first
    // or last container, making their outer boundaries unreachable.
    const closestChild = nearestBlock(container, event);
    if (closestChild) block = closestChild;
    else {
      try {
        return view.posAtDOM(container, container.childNodes.length);
      } catch {
        // Fall back to ProseMirror's normal coordinate mapping.
      }
    }
  }

  if (block) {
    const boundary = blockBoundary(view, block);
    if (boundary) return insertAfter(block, event) ? boundary.to : boundary.from;
  }

  return view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
}

function calculatePreview(view: EditorView, event: DragEvent): DragPreview | null {
  const dragging = view.dragging;
  const palette = paletteBlock(view, event);
  const source = palette ? null : draggedBlock(view);
  if (!canDragBlocks(view) || (!palette && (!source || !dragging))) return null;
  if (source && !blockTypes.has(source.node.type.name)) return null;
  const slice = palette ? new Slice(Fragment.from(palette), 0, 0) : dragging?.slice;
  if (!slice || slice.openStart !== 0 || slice.openEnd !== 0) return null;

  const origin = source ? view.nodeDOM(source.from) : null;
  const originRect = origin instanceof Element ? origin.getBoundingClientRect() : null;
  if (source && !originRect) return null;

  // While the pointer is over the existing placeholder, retain its position
  // instead of chasing blocks that the placeholder itself has displaced.
  const current = previewKey.getState(view.state);
  const existing = view.dom.querySelector('.rbb-drop-placeholder');
  if (current && existing) {
    const rect = existing.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom) {
      return current;
    }
  }

  const target = targetPosition(view, event);
  if (target === null) return null;
  const candidate = dropPoint(view.state.doc, target, slice);
  if (candidate === null) return null;

  // Never offer a target inside the dragged block's subtree or immediately
  // next to itself (which would be a no-op).
  if (source && candidate >= source.from && candidate <= source.to) return null;

  return {
    pos: candidate,
    width: Math.max(24, Math.ceil(originRect?.width ?? view.dom.clientWidth)),
    height: Math.max(24, Math.ceil(originRect?.height ?? 48)),
    source: source ? { from: source.from, to: source.to } : undefined
  };
}

function updatePreview(view: EditorView, next: DragPreview | null): void {
  const old = previewKey.getState(view.state);
  if (JSON.stringify(old) === JSON.stringify(next)) return;
  view.dispatch(view.state.tr.setMeta(previewKey, next).setMeta('addToHistory', false));
}

function decorations(preview: DragPreview | null, viewState: EditorView['state']): DecorationSet {
  if (!preview) return DecorationSet.empty;
  return DecorationSet.create(viewState.doc, [
    Decoration.widget(preview.pos, () => {
      const element = document.createElement('div');
      element.className = 'rbb-drop-placeholder';
      element.dataset.dropPosition = String(preview.pos);
      element.style.height = `${preview.height}px`;
      element.style.width = `min(100%, ${preview.width}px)`;
      element.setAttribute('aria-hidden', 'true');
      return element;
    }, { side: -1, key: `rbb-drop-${preview.pos}-${preview.height}-${preview.width}` }),
    ...(preview.source ? [Decoration.node(preview.source.from, preview.source.to, {
      class: 'rbb-drag-origin'
    })] : [])
  ]);
}

function dropBlock(view: EditorView, event: DragEvent, slice: Slice, moved: boolean): boolean {
  if (!canDragBlocks(view)) return false;
  const palette = paletteBlock(view, event);
  const preview = previewKey.getState(view.state) ?? calculatePreview(view, event);
  const source = palette ? null : draggedBlock(view);
  if (!preview || (!palette && (!source || slice.openStart !== 0 ||
      slice.openEnd !== 0 || slice.content.childCount !== 1))) return false;

  const node = palette ?? slice.content.firstChild;
  if (!node || !blockTypes.has(node.type.name)) return false;

  // Use the placeholder's exact boundary, including after removing a source.
  const transaction = view.state.tr;
  if (moved && source) source.replace(transaction);
  const pos = transaction.mapping.map(preview.pos);
  try {
    transaction.replaceRangeWith(pos, pos, node);
    if (transaction.doc.eq(view.state.doc)) return false;
    if (transaction.doc.nodeAt(pos)?.type === node.type && NodeSelection.isSelectable(node)) {
      transaction.setSelection(NodeSelection.create(transaction.doc, pos));
    }
    transaction.setMeta(previewKey, null).setMeta('uiEvent', 'drop');
    view.dispatch(transaction.scrollIntoView());
    view.focus();
    event.preventDefault();
    return true;
  } catch {
    return false;
  }
}

function dragCopies(view: EditorView, event: DragEvent): boolean {
  let copy: boolean | undefined;
  view.someProp('dragCopies', (test) => { copy = copy || test(event); });
  return copy ?? (/Mac|iPhone|iPad/.test(navigator.platform) ? event.altKey : event.ctrlKey);
}

export const BlockDragPreview = Extension.create({
  name: 'blockDragPreview',

  addProseMirrorPlugins() {
    return [
      new Plugin<DragPreview | null>({
        key: previewKey,
        state: {
          init: () => null,
          apply(transaction, current, _oldState, newState) {
            // Mode changes must clear any stale placeholder immediately.
            if (!isBlockDragMode(newState)) return null;
            const meta = transaction.getMeta(previewKey) as DragPreview | null | undefined;
            if (meta !== undefined) return meta;
            return transaction.docChanged ? null : current;
          }
        },
        props: {
          decorations(state) {
            return decorations(previewKey.getState(state) ?? null, state);
          },
          handleDOMEvents: {
            dragover(view, event) {
              const palette = paletteBlock(view, event);
              if (!palette && !draggedBlock(view)) return false;
              updatePreview(view, calculatePreview(view, event));
              if (canDragBlocks(view) && (palette || isBlockDragMode(view.state))) {
                event.preventDefault();
                if (event.dataTransfer) {
                  event.dataTransfer.dropEffect = palette || dragCopies(view, event) ? 'copy' : 'move';
                }
                return true;
              }
              return false; // Keep ProseMirror's native drag handling intact.
            },
            dragleave(view, event) {
              if (!view.dom.contains(event.relatedTarget as Node | null)) {
                updatePreview(view, null);
              }
              return false;
            },
            dragend(view) {
              endPaletteDrag(view);
              return false;
            },
            drop(view, event) {
              if (isBlockDragMode(view.state)) {
                // ProseMirror skips native drop handling in a read-only view.
                dropBlock(view, event, view.dragging?.slice ?? Slice.empty,
                  !!view.dragging && !dragCopies(view, event));
                view.dragging = null;
                endPaletteDrag(view);
                event.preventDefault();
                return true;
              }
              // The native drop handler runs after this event handler. Don't
              // collapse the space until the drop has been processed.
              queueMicrotask(() => {
                endPaletteDrag(view);
              });
              return false;
            }
          },
          handleDrop: dropBlock
        }
      })
    ];
  }
});
