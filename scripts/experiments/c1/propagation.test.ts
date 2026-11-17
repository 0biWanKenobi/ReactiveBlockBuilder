import { expect, test } from 'bun:test';
import { affectedDefinitionIds, reconcileAffectedDefinitions } from './propagation';
import { prepareDocument } from '../../../src/lib/custom-blocks/model';
import type { CustomBlockDefinition } from '../../../src/lib/custom-blocks/types';
import fixtures from '../../../examples/smoke-ball/library.json';

function library(definitions: CustomBlockDefinition[]) {
	return { list: () => definitions, get: (id: string) => definitions.find((d) => d.typeId === id) };
}
const smoke = () => structuredClone(fixtures) as CustomBlockDefinition[];

test('affected discovery follows shared/transitive references and stops at copied roots', () => {
	const definitions = smoke();
	const lib = library(definitions);
	definitions.push({
		typeId: 'outer',
		name: 'Outer',
		rootClass: '',
		structure: {
			type: 'container',
			content: [{ type: 'container', attrs: { customNode: true, typeId: 'sb-template-3' } }]
		}
	});
	const affected = affectedDefinitionIds(lib, 'sb-property');
	expect(affected.has('outer')).toBe(true);
	expect(affected.has('sb-template-3')).toBe(true);
	expect(affected.has('sb-template-6')).toBe(true);
	expect(affected.has('sb-template-1')).toBe(false);
	const page = lib.get('sb-template-3')!;
	// Stale embedded copies must not introduce a direct dependency into their owner.
	const custom = page.structure.content.find((n) => n.attrs?.customNode)!;
	custom.content!.push({
		type: 'container',
		attrs: { customNode: true, typeId: 'stale-copy-only' }
	});
	expect([...affectedDefinitionIds(lib, 'stale-copy-only')]).toEqual(['stale-copy-only']);
});

test('Smoke Ball propagation matches the baseline for every type and preserves unrelated identity', () => {
	for (const fixture of fixtures) {
		const before = smoke().sort((a, b) => a.typeId.localeCompare(b.typeId));
		const after = structuredClone(before);
		for (const definitions of [before, after]) {
			const candidate = definitions.find((d) => d.typeId === fixture.typeId)!;
			candidate.rootClass = 'changed-root';
			candidate.structure.content.push({
				type: 'textBlock',
				attrs: { nodeId: 'added-slot', class: 'added' },
				content: [{ type: 'text', text: 'New value' }]
			});
		}
		const baseline = library(before);
		for (const entry of [...before]) {
			const current = structuredClone(entry);
			const structure = prepareDocument(current.structure, baseline);
			if (JSON.stringify(structure) === JSON.stringify(current.structure)) continue;
			before[before.findIndex((d) => d.typeId === current.typeId)] = { ...current, structure };
		}
		const candidate = library(after);
		const affected = affectedDefinitionIds(candidate, fixture.typeId);
		const originals = [...after];
		const cloned: string[] = [];
		const changes = reconcileAffectedDefinitions(candidate, fixture.typeId, (id) => {
			cloned.push(id);
			return structuredClone(candidate.get(id)!);
		});
		for (const change of changes)
			after[after.findIndex((d) => d.typeId === change.typeId)] = change;
		expect(after).toEqual(before);
		expect(new Set(cloned)).toEqual(affected);
		for (const [i, definition] of after.entries())
			if (!affected.has(definition.typeId)) expect(definition).toBe(originals[i]);
	}
});

test('candidate reference changes are discovered without a persistent index', () => {
	const definitions = smoke();
	const lib = library(definitions);
	const journal = lib.get('sb-template-1')!;
	journal.structure.content.push({
		type: 'container',
		attrs: { customNode: true, typeId: 'sb-property' }
	});
	expect(affectedDefinitionIds(lib, 'sb-property').has(journal.typeId)).toBe(true);
	journal.structure.content.pop();
	expect(affectedDefinitionIds(lib, 'sb-property').has(journal.typeId)).toBe(false);
});
