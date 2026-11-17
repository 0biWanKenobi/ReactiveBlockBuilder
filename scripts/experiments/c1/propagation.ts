import type { JSONContent } from '@tiptap/core';
import type { BlockLibrary, CustomBlockDefinition } from '../../../src/lib/custom-blocks/types';
import { prepareDocument } from '../../../src/lib/custom-blocks/model';

/** Direct references stop at custom roots; copied descendants belong to that type. */
export function affectedDefinitionIds(library: BlockLibrary, changedType: string): Set<string> {
	const parents = new Map<string, Set<string>>();
	for (const definition of library.list()) {
		const visit = (node: JSONContent) => {
			if (node.attrs?.customNode === true) {
				const child = String(node.attrs.typeId);
				let users = parents.get(child);
				if (!users) parents.set(child, (users = new Set()));
				users.add(definition.typeId);
				return;
			}
			node.content?.forEach(visit);
		};
		visit(definition.structure);
	}
	const affected = new Set([changedType]);
	for (const type of affected) {
		for (const parent of parents.get(type) ?? []) affected.add(parent);
	}
	return affected;
}

/** Compute against one candidate library before persisting or upserting results. */
export function reconcileAffectedDefinitions(
	library: BlockLibrary,
	changedType: string,
	clone: (typeId: string) => CustomBlockDefinition
): CustomBlockDefinition[] {
	const affected = affectedDefinitionIds(library, changedType);
	const candidates = library
		.list()
		.filter((entry) => affected.has(entry.typeId))
		.map((entry) => clone(entry.typeId));
	// One preparation pass shares definition-template copies across the batch.
	const prepared = prepareDocument(
		{ type: 'doc', content: candidates.map((entry) => entry.structure) },
		library
	);
	return candidates.flatMap((current, index) => {
		const structure = prepared.content[index] as CustomBlockDefinition['structure'];
		return JSON.stringify(structure) === JSON.stringify(current.structure)
			? []
			: [{ ...current, structure }];
	});
}
