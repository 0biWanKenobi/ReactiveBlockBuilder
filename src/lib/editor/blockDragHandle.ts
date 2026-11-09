import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
	blockBoundary,
	blockSelector,
	isBlockDragMode,
	createGutterHover,
	outermostCustomBlock,
	pointerBlock
} from './blockInteraction';
import { endPaletteDrag } from './blockDragPreview';

interface HandleTarget {
	element: HTMLElement;
	from: number;
	type: string;
	classes: string;
}

const GRIP_WIDTH = 20;
const GRIP_GAP = 4;
const BRIDGE_WIDTH = 6;

const gripSvg =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="20" ' +
	'viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
	'<circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>' +
	'<circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>' +
	'<circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>';

function createHandles(view: EditorView) {
	// The rail is deliberately a sibling of the ProseMirror surface. It must
	// never become part of the sheet, affect its layout or appear in exports.
	const rail = document.createElement('div');
	rail.className = 'rbb-block-drag-rail';
	rail.hidden = true;
	view.dom.parentElement!.appendChild(rail);
	let targets: HandleTarget[] = [];
	const gutterHover = createGutterHover(view, rail, targetFromEvent, () => targets.at(-1));
	let hovered: HTMLElement | null = null;
	let dragging = false;
	let pressed = false;

	function hide(force = false) {
		if (!force && (dragging || pressed)) return;
		if (!hovered && rail.hidden) return;
		gutterHover.clear();
		hovered = null;
		targets = [];
		rail.hidden = true;
		rail.replaceChildren();
	}

	function ancestors(block: HTMLElement): HandleTarget[] {
		const result: HandleTarget[] = [];
		let element: HTMLElement | null =
			(outermostCustomBlock(view, block) as HTMLElement | null) ?? block;
		while (element && element !== view.dom) {
			if (element.matches(blockSelector)) {
				const boundary = blockBoundary(view, element);
				const node = boundary && view.state.doc.nodeAt(boundary.from);
				if (boundary && node) {
					result.push({
						element,
						from: boundary.from,
						type: node.type.name,
						classes: String(node.attrs.class ?? '')
					});
				}
				if (element.matches('section[data-custom-block-type]')) break;
			}
			element = element.parentElement;
		}
		// The outermost container gets the leftmost grip. The hovered block is
		// last, so even coincident rectangles have distinct, reachable handles.
		return result.reverse();
	}

	function position() {
		// The outline is the block's own CSS outline. Only drag handles
		// need repositioning; they exist exclusively in Drag mode.
		if (!hovered || !view.dom.contains(hovered)) {
			rail.hidden = true;
			return;
		}
		const rect = hovered.getBoundingClientRect();
		if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
			hide();
			return;
		}
		const count = targets.length;
		const width = count * GRIP_WIDTH + Math.max(0, count - 1) * GRIP_GAP;
		rail.style.left = `${rect.left - width - BRIDGE_WIDTH}px`;
		rail.style.top = `${rect.top + Math.min(6, Math.max(0, (rect.height - 24) / 2))}px`;
	}

	function makeGrip(target: HandleTarget): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'rbb-block-drag-handle';
		button.draggable = true;
		button.innerHTML = gripSvg;
		const kind = target.type === 'textBlock' ? 'text' : target.type;
		const label = `${kind} ${target.classes ? `.${target.classes.trim().split(/\s+/).join('.')}` : '(no class)'}`;
		button.title = label;
		button.setAttribute('aria-label', `Select or drag ${label}`);
		return button;
	}

	function show(block: HTMLElement) {
		const next = ancestors(block);
		if (!next.length) {
			hide();
			return;
		}
		const same =
			targets.length === next.length &&
			targets.every(
				(target, index) =>
					target.element === next[index].element &&
					target.from === next[index].from &&
					target.classes === next[index].classes
			);

		hovered = block;
		if (!same) {
			targets = next;
			rail.replaceChildren(...targets.map(makeGrip));
		}
		rail.hidden = false;
		position();
	}

	function mousemove(event: MouseEvent) {
		if (!isBlockDragMode(view.state)) {
			hide(true);
			return;
		}
		if (dragging || pressed) return;
		const target = event.target;

		// Resolve the same block as click selection to position its ancestor grips.
		const block = pointerBlock(view, target);
		if (block) {
			gutterHover.clear();
			if (hovered !== block || rail.hidden) show(block);
			return;
		}

		if (gutterHover.keepVisible(event)) return;
		hide();
	}

	function targetFromEvent(event: Event): HandleTarget | null {
		const button =
			event.target instanceof Element ? event.target.closest('button.rbb-block-drag-handle') : null;
		if (!button || !rail.contains(button)) return null;
		const index = Array.prototype.indexOf.call(rail.children, button) as number;
		return targets[index] ?? null;
	}

	function select(target: HandleTarget | null): NodeSelection | null {
		if (!target || !isBlockDragMode(view.state)) return null;
		const boundary = blockBoundary(view, target.element);
		if (!boundary) return null;
		const selection = NodeSelection.create(view.state.doc, boundary.from);
		if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection));
		return selection;
	}

	function click(event: MouseEvent) {
		if (select(targetFromEvent(event))) view.focus();
	}

	function mousedown(event: MouseEvent) {
		if (event.button === 0 && targetFromEvent(event)) pressed = true;
	}

	function mouseup(event: MouseEvent) {
		pressed = false;
		if (
			!(event.target instanceof Node && rail.contains(event.target)) &&
			!(event.target instanceof Node && view.dom.contains(event.target))
		) {
			hide();
		}
	}

	function dragstart(event: DragEvent) {
		const target = targetFromEvent(event);
		const selection = select(target);
		if (!selection || !target || !event.dataTransfer) {
			event.preventDefault();
			return;
		}
		gutterHover.handleOver(event);
		const { dom, text, slice } = view.serializeForClipboard(selection.content());
		event.dataTransfer.setData('text/html', dom.innerHTML);
		event.dataTransfer.setData('text/plain', text);
		event.dataTransfer.effectAllowed = 'copyMove';
		event.dataTransfer.setDragImage(target.element, 0, 0);
		// Keep the same native drag state used before the multi-handle change.
		view.dragging = { slice, move: true, node: selection } as typeof view.dragging;
		dragging = true;
	}

	function dragend() {
		view.dragging = null;
		endPaletteDrag(view);
		dragging = false;
		pressed = false;
		hide(true);
	}

	// Follow the pointer across the DOM gap between canvas and fixed gutter.
	window.addEventListener('mousemove', mousemove);
	rail.addEventListener('click', click);
	rail.addEventListener('mousedown', mousedown);
	rail.addEventListener('dragstart', dragstart);
	rail.addEventListener('dragend', dragend);
	window.addEventListener('scroll', position, true);
	window.addEventListener('resize', position);
	window.addEventListener('mouseup', mouseup);

	return {
		update(_view: EditorView, previousState: EditorState) {
			if (!isBlockDragMode(view.state)) {
				hide(true);
				return;
			}
			if (view.state.doc === previousState.doc) return;
			if (hovered && !view.dom.contains(hovered)) hide(true);
			if (hovered && !dragging && !pressed) {
				// A changed document may replace elements or move positions.
				show(hovered);
			} else position();
		},
		destroy() {
			window.removeEventListener('mousemove', mousemove);
			rail.removeEventListener('click', click);
			rail.removeEventListener('mousedown', mousedown);
			rail.removeEventListener('dragstart', dragstart);
			rail.removeEventListener('dragend', dragend);
			window.removeEventListener('scroll', position, true);
			window.removeEventListener('resize', position);
			window.removeEventListener('mouseup', mouseup);
			gutterHover.destroy();
			rail.remove();
		}
	};
}

export const BlockDragHandle = Extension.create({
	name: 'blockDragHandle',
	addProseMirrorPlugins() {
		return [new Plugin({ view: createHandles })];
	}
});
