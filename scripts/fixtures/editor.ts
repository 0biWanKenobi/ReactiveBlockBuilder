import { getExtensionField, type AnyExtension } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import type { Plugin } from '@tiptap/pm/state';

const attrs = {
	class: { default: '' },
	nodeId: { default: '' },
	customNode: { default: false }
};

export const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		textBlock: { group: 'block', content: 'text*', attrs },
		container: {
			group: 'block',
			content: 'block+',
			attrs: { ...attrs, typeId: { default: '' }, instanceId: { default: '' } }
		},
		formula: {
			group: 'block',
			atom: true,
			attrs: {
				...attrs,
				field: { default: '' },
				label: { default: '' },
				showLabel: { default: false }
			}
		},
		image: {
			group: 'block',
			atom: true,
			attrs: { ...attrs, src: { default: '' }, alt: { default: '' } }
		},
		text: {}
	}
});

export const pluginsFor = (extension: AnyExtension): Plugin[] =>
	getExtensionField<() => Plugin[]>(extension, 'addProseMirrorPlugins')();

export function instance(instanceId = 'instance', count = 60) {
	return schema.node(
		'container',
		{ customNode: true, instanceId, typeId: 'example' },
		Array.from({ length: count }, (_, i) =>
			schema.node('textBlock', { nodeId: `slot-${i}` }, schema.text('Editable value'))
		)
	);
}
