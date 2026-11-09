import { Node, mergeAttributes, type Extensions } from '@tiptap/core';
import { BlockDragPreview } from './blockDragPreview';
import { BlockInteraction } from './blockInteraction';
import { BlockDragHandle } from './blockDragHandle';
import { CustomNodeProtection } from './customNodes';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { mount, unmount } from 'svelte';
import FormulaBlock from '../blocks/FormulaBlock.svelte';
import ImageBlock from '../blocks/ImageBlock.svelte';
import { reactiveNodeAttrs } from './reactive.svelte';
import type { Sheet } from '../formula/engine';
import type { TypedNode } from '#lib/custom-blocks/types.ts';

export type SheetNodeType = 'container' | 'textBlock' | 'formula' | 'image';
export const allowedNodeTypes: SheetNodeType[] = ['container', 'textBlock', 'formula', 'image'];

const classes = (defaultClass: string) => ({
	class: { default: defaultClass },
	nodeId: { default: '' },
	customNode: {
		default: false,
		parseHTML: (element: HTMLElement) => element.dataset.customNode === 'true',
		renderHTML: (attrs: Record<string, unknown>) =>
			attrs.customNode ? { 'data-custom-node': 'true', 'data-custom-block-type': attrs.typeId } : {}
	}
});

/** Update only document-owned classes; ProseMirror owns selection/decorations. */
function nodeViewClasses(dom: HTMLElement): (value: unknown) => void {
	let current = new Set<string>();
	return (value) => {
		const next = new Set(
			String(value ?? '')
				.split(/\s+/)
				.filter(Boolean)
		);
		for (const name of current) if (!next.has(name)) dom.classList.remove(name);
		for (const name of next) if (!current.has(name)) dom.classList.add(name);
		current = next;
	};
}

/**
 * Creates the intentionally small sheet schema. The custom atom nodes mount Svelte 5
 * components directly, avoiding both runtime compilation and a third-party bridge.
 */
export function createSheetExtensions(fields: Sheet): Extensions {
	const Container = Node.create({
		name: 'container',
		group: 'block',
		content: 'block+',
		defining: true,
		addAttributes: () => ({
			...classes('sheet-container'),
			typeId: { default: '' },
			instanceId: { default: '' }
		}),
		parseHTML: () => [{ tag: 'section[data-sheet-container]' }],
		renderHTML: ({ HTMLAttributes }) => [
			'section',
			mergeAttributes({ 'data-sheet-container': '' }, HTMLAttributes),
			0
		]
	});

	const TextBlock = Node.create({
		name: 'textBlock',
		group: 'block',
		content: 'text*',
		defining: true,
		addAttributes: () => classes('sheet-text'),
		parseHTML: () => [{ tag: 'span[data-sheet-text]' }],
		renderHTML: ({ HTMLAttributes }) => [
			'span',
			mergeAttributes({ 'data-sheet-text': '' }, HTMLAttributes),
			0
		]
	});

	const Formula = Node.create({
		name: 'formula',
		group: 'block',
		atom: true,
		selectable: true,
		addAttributes: () => ({
			...classes('sheet-formula'),
			field: { default: 'STR_MOD' }
		}),
		parseHTML: () => [{ tag: 'cs-formula' }],
		renderHTML: ({ HTMLAttributes }) => ['cs-formula', HTMLAttributes],
		addNodeView() {
			return ({ node }) => {
				const dom = document.createElement('div');
				const attrs = reactiveNodeAttrs({ field: String(node.attrs.field ?? '') });
				const updateClasses = nodeViewClasses(dom);
				updateClasses(node.attrs.class);
				dom.dataset.sheetBlock = 'formula';
				dom.contentEditable = 'false';
				const component = mount(FormulaBlock, { target: dom, props: { attrs, fields } });
				return {
					dom,
					update(next) {
						if (next.type.name !== 'formula') return false;
						attrs.field = String(next.attrs.field ?? '');
						updateClasses(next.attrs.class);
						return true;
					},
					stopEvent(event) {
						return !!(event.target as Element | null)?.closest?.('button');
					},
					destroy() {
						void unmount(component);
					}
				};
			};
		}
	});

	const ImageNode = Node.create({
		name: 'image',
		group: 'block',
		atom: true,
		selectable: true,
		addAttributes: () => ({
			...classes('sheet-image'),
			src: { default: '' },
			alt: { default: '' }
		}),
		parseHTML: () => [{ tag: 'cs-image' }],
		renderHTML: ({ HTMLAttributes }) => ['cs-image', HTMLAttributes],
		addNodeView() {
			return ({ node }) => {
				const dom = document.createElement('div');
				const attrs = reactiveNodeAttrs({
					src: String(node.attrs.src ?? ''),
					alt: String(node.attrs.alt ?? '')
				});
				const updateClasses = nodeViewClasses(dom);
				updateClasses(node.attrs.class);
				dom.dataset.sheetBlock = 'image';
				dom.contentEditable = 'false';
				const component = mount(ImageBlock, { target: dom, props: { attrs } });
				return {
					dom,
					update(next) {
						if (next.type.name !== 'image') return false;
						attrs.src = String(next.attrs.src ?? '');
						attrs.alt = String(next.attrs.alt ?? '');
						updateClasses(next.attrs.class);
						return true;
					},
					destroy() {
						void unmount(component);
					}
				};
			};
		}
	});

	return [
		Document,
		Text,
		Container,
		CustomNodeProtection,
		TextBlock,
		Formula,
		ImageNode,
		BlockInteraction,
		BlockDragPreview,
		BlockDragHandle
	];
}

export const insertionSamples: Record<SheetNodeType, TypedNode> = {
	container: {
		type: 'container',
		attrs: { class: 'sheet-container' },
		content: [
			{
				type: 'textBlock',
				attrs: { class: 'sheet-text' },
				content: [{ type: 'text', text: 'New container' }]
			}
		]
	},
	textBlock: {
		type: 'textBlock',
		attrs: { class: 'sheet-text' },
		content: [{ type: 'text', text: 'Edit this text' }]
	},
	formula: { type: 'formula', attrs: { class: 'sheet-formula', field: 'STR_MOD' } },
	image: { type: 'image', attrs: { class: 'sheet-image', src: '', alt: '' } }
};
