import { Extension, type Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { prepareDocument } from '../custom-blocks/model';
import type { BlockLibrary } from '../custom-blocks/types';

/** Only definition synchronization and validated full imports may change instance structure. */
export const customNodeSync = 'rbbCustomNodeSync';

function structure(node: Node): unknown {
	const attrs = Object.fromEntries(
		Object.entries(node.attrs).filter(([key]) => !['field', 'src', 'alt'].includes(key))
	);
	return [node.type.name, attrs, node.isTextblock ? [] : node.content.content.map(structure)];
}

export const CustomNodeProtection = Extension.create({
	name: 'customNodeProtection',
	addProseMirrorPlugins() {
		return [
			new Plugin({
				filterTransaction(transaction, state) {
					if (!transaction.docChanged || transaction.getMeta(customNodeSync)) return true;
					const previous = new Map<
						string,
						{ structure: string; count: number; selected: number }
					>();
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
								structure: JSON.stringify(structure(node)),
								count: 1,
								selected
							});
						return false;
					});
					let valid = true;
					transaction.doc.descendants((node) => {
						if (!node.attrs.customNode) return;
						const old = previous.get(node.attrs.instanceId);
						if (old && old.structure !== JSON.stringify(structure(node))) valid = false;
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
