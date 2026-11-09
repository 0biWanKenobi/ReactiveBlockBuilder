import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { selectedBlock } from './selection';

export const blockSelector = 'section[data-sheet-container], [data-sheet-text], [data-sheet-block]';
export const blockTypes = new Set(['container', 'textBlock', 'formula', 'image']);
const dragModeKey = new PluginKey<boolean>('rbbBlockDragMode');
const hoverKey = new PluginKey<number | null>('rbbHoveredBlock');

/** Gutter hover uses known handle positions; ordinary sheet hover stays in CSS. */
function setGutterHover(view: EditorView, pos: number | null): void {
	if (hoverKey.getState(view.state) === pos) return;
	view.dispatch(view.state.tr.setMeta(hoverKey, pos).setMeta('addToHistory', false));
}

/** The rail and block are separate subtrees; their physical gap is still a hover target. */
function withinGutterBridge(event: MouseEvent, rail: HTMLElement, block: HTMLElement): boolean {
	const grip = rail.getBoundingClientRect();
	const rect = block.getBoundingClientRect();
	return (
		event.clientX >= grip.left - 4 &&
		event.clientX < rect.left &&
		event.clientY >= Math.min(grip.top, rect.top) - 6 &&
		event.clientY <= Math.max(grip.bottom, rect.bottom) + 6
	);
}

/** Gutter listeners reuse the handle's targets without keeping a second anchor. */
export function createGutterHover(
	view: EditorView,
	rail: HTMLElement,
	getTarget: (event: Event) => { from: number } | null,
	getAnchor: () => { element: HTMLElement; from: number } | undefined
) {
	function clear() {
		setGutterHover(view, null);
	}

	function handleOver(event: Event) {
		if (rail.hidden || !isBlockDragMode(view.state)) return;
		setGutterHover(view, getTarget(event)?.from ?? getAnchor()?.from ?? null);
	}

	function handleOut(event: MouseEvent) {
		if (rail.hidden || !isBlockDragMode(view.state)) return;
		if (event.relatedTarget instanceof Node && rail.contains(event.relatedTarget)) return;
		setGutterHover(view, getAnchor()?.from ?? null);
	}

	function keepVisible(event: MouseEvent): boolean {
		if (rail.hidden || !isBlockDragMode(view.state)) return false;
		if (event.target instanceof Node && rail.contains(event.target)) return true;
		const anchor = getAnchor();
		if (!anchor || !withinGutterBridge(event, rail, anchor.element)) return false;
		setGutterHover(view, anchor.from);
		return true;
	}

	rail.addEventListener('mouseover', handleOver);
	rail.addEventListener('mouseout', handleOut);
	return {
		handleOver,
		keepVisible,
		clear,
		destroy() {
			rail.removeEventListener('mouseover', handleOver);
			rail.removeEventListener('mouseout', handleOut);
			clear();
		}
	};
}

export function isBlockDragMode(state: EditorState): boolean {
	return dragModeKey.getState(state) === true;
}

export function setBlockDragMode(view: EditorView, enabled: boolean): void {
	if (isBlockDragMode(view.state) === enabled) return;
	view.dispatch(view.state.tr.setMeta(dragModeKey, enabled).setMeta('addToHistory', false));
}

export function blockBoundary(
	view: EditorView,
	element: Element
): { from: number; to: number } | null {
	const parent = element.parentNode;
	if (!parent || !view.dom.contains(element)) return null;

	const index = Array.prototype.indexOf.call(parent.childNodes, element);

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
	const element =
		target instanceof Element
			? target
			: target instanceof globalThis.Node
				? target.parentElement
				: null;
	if (!element || !view.dom.contains(element)) return null;
	const block =
		(isBlockDragMode(view.state) ? outermostCustomBlock(view, element) : null) ??
		element.closest(blockSelector);
	return block instanceof HTMLElement && view.dom.contains(block) ? block : null;
}

function selectPointerBlock(view: EditorView, target: EventTarget | null): boolean {
	const block = pointerBlock(view, target);
	if (!block) return false;
	// Edit keeps native text/formula/image behavior and selects container surfaces only.
	if (!isBlockDragMode(view.state) && !block.matches('section[data-sheet-container]')) return false;
	const boundary = blockBoundary(view, block);
	if (!boundary) return false;
	const selection = NodeSelection.create(view.state.doc, boundary.from);
	if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection));
	return true;
}

/** Disable native content editing while keeping block drag events available. */
export const BlockInteraction = Extension.create({
	name: 'blockInteraction',

	addProseMirrorPlugins() {
		let decoratedDocument: EditorState['doc'] | undefined;
		let dragDecorations = DecorationSet.empty;
		return [
			new Plugin<number | null>({
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
						const selected =
							state.selection instanceof NodeSelection ? null : selectedBlock({ state });
						const selectedNode = selected && state.doc.nodeAt(selected.pos);
						if (selected && selectedNode && blockTypes.has(selected.type)) {
							decorations.push(
								Decoration.node(selected.pos, selected.pos + selectedNode.nodeSize, {
									'data-rbb-selected': ''
								})
							);
						}
						const pos = hoverKey.getState(state);
						const node = pos === null || pos === undefined ? null : state.doc.nodeAt(pos);
						if (node && pos !== null && pos !== undefined && blockTypes.has(node.type.name)) {
							decorations.push(
								Decoration.node(pos, pos + node.nodeSize, { 'data-rbb-hovered': '' })
							);
						}
						return DecorationSet.create(state.doc, decorations);
					}
				}
			}),
			new Plugin<boolean>({
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
							if (event.button !== 0 || !selectPointerBlock(view, event.target)) return false;
							// Keep native drag gestures, but stop ProseMirror replacing our selection.
							if (!isBlockDragMode(view.state)) event.preventDefault();
							return true;
						},
						click(view, event) {
							if (!selectPointerBlock(view, event.target)) return false;
							event.preventDefault();
							return true;
						}
					},
					decorations(state) {
						if (!isBlockDragMode(state)) return DecorationSet.empty;
						// Hover and selection transactions keep the same immutable document.
						if (decoratedDocument === state.doc) return dragDecorations;
						const decorations: Decoration[] = [];
						state.doc.descendants((node, pos) => {
							if (!blockTypes.has(node.type.name)) return;
							decorations.push(Decoration.node(pos, pos + node.nodeSize, { draggable: 'true' }));
							// A custom block's descendants are never individual drag targets.
							if (node.attrs.customNode) return false;
						});
						decoratedDocument = state.doc;
						dragDecorations = DecorationSet.create(state.doc, decorations);
						return dragDecorations;
					}
				}
			})
		];
	}
});
