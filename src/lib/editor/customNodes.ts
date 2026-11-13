import { Extension, type Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { prepareDocument } from '../custom-blocks/model';
import type { BlockLibrary } from '../custom-blocks/types';

/** Only definition synchronization and validated full imports may change instance structure. */
export const customNodeSync = 'rbbCustomNodeSync';

function sameStructure(before: Node, after: Node): boolean {
	// ProseMirror shares unchanged subtrees. Typing only needs to check the changed path.
	if (before === after) return true;
	if (before.type !== after.type) return false;
	// Stock attributes are scalars, with the same keys for every node of a given type.
	if (before.attrs !== after.attrs) {
		for (const key in before.attrs) {
			if (
				key === 'field' ||
				key === 'label' ||
				key === 'showLabel' ||
				key === 'src' ||
				key === 'alt'
			)
				continue;
			if (before.attrs[key] !== after.attrs[key]) return false;
		}
	}
	if (before.isTextblock || before.content === after.content) return true;
	if (before.childCount !== after.childCount) return false;
	for (let i = 0; i < before.childCount; i++) {
		if (!sameStructure(before.child(i), after.child(i))) return false;
	}
	return true;
}

export const CustomNodeProtection = Extension.create({
	name: 'customNodeProtection',
	addProseMirrorPlugins() {
		return [
			new Plugin({
				filterTransaction(transaction, state) {
					if (!transaction.docChanged || transaction.getMeta(customNodeSync)) return true;
					const previous = new Map<string, { node: Node; count: number; selected: number }>();
					const nextCounts = new Map<string, number>();
					state.doc.descendants((node, pos) => {
						if (!node.attrs.customNode) return;
						const selected = Number(
							state.selection.from <= pos && state.selection.to >= pos + node.nodeSize
						);
						const existing = previous.get(node.attrs.instanceId);
						if (existing) {
							existing.count++;
							existing.selected += selected;
						} else
							previous.set(node.attrs.instanceId, {
								node,
								count: 1,
								selected
							});
						return false;
					});
					let valid = true;
					transaction.doc.descendants((node) => {
						if (!node.attrs.customNode) return;
						const old = previous.get(node.attrs.instanceId);
						if (old && !sameStructure(old.node, node)) valid = false;
						nextCounts.set(node.attrs.instanceId, (nextCounts.get(node.attrs.instanceId) ?? 0) + 1);
						return false;
					});
					if (!valid) return false;
					// Native Backspace/Delete can lift children out of a non-atom container.
					// Removing the instance requires selecting its whole range (or an ancestor).
					// Counts also handle clipboard copies, which retain the original instance ID.
					return [...previous].every(
						([id, old]) => old.count - (nextCounts.get(id) ?? 0) <= old.selected
					);
				}
			})
		];
	}
});

/** Replace only changed instances, leaving unrelated blocks and selections alone. */
export function synchronizeCustomNodes(editor: Editor, library: BlockLibrary): void {
	const instances: { pos: number; node: Node }[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (!node.attrs.customNode) return;
		instances.push({ pos, node });
		return false;
	});
	if (!instances.length) return;
	// One pass shares definition snapshots across every instance in the editor.
	const prepared = prepareDocument(
		{ type: 'doc', content: instances.map(({ node }) => node.toJSON()) },
		library
	);
	const replacements = instances.flatMap(({ pos, node }, index) => {
		const after = editor.schema.nodeFromJSON(prepared.content[index]);
		return node.eq(after) ? [] : [{ pos, before: node, after }];
	});
	if (!replacements.length) return;
	const transaction = editor.state.tr.setMeta(customNodeSync, true).setMeta('addToHistory', false);
	for (const { pos, before, after } of replacements.reverse()) {
		transaction.replaceWith(pos, pos + before.nodeSize, after);
	}
	editor.view.dispatch(transaction);
}
