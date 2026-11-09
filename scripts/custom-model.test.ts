import { expect, test } from 'bun:test';
import type { JSONContent } from '@tiptap/core';
import {
	createDefinition,
	makeInstance,
	prepareDocument,
	resetLeafDefaults,
	validateDefinition,
	ensureNodeIds
} from '../src/lib/custom-blocks/model';
import type { CustomBlockDefinition, PopulatedNode } from '../src/lib/custom-blocks/types';

function library(...definitions: CustomBlockDefinition[]) {
	return {
		get: (id: string) => definitions.find((d) => d.typeId === id),
		clone: (id: string) => structuredClone(definitions.find((d) => d.typeId === id)),
		list: () => definitions
	};
}
const text = (nodeId: string, value: string): JSONContent => ({
	type: 'textBlock',
	attrs: { nodeId },
	content: value ? [{ type: 'text', text: value }] : []
});
const root = (...content: JSONContent[]): PopulatedNode<'container'> => ({
	type: 'container',
	attrs: { nodeId: 'root', class: 'root' },
	content: content as [JSONContent, ...JSONContent[]]
});
const texts = (node: JSONContent): string[] =>
	node.type === 'textBlock'
		? [(node.content ?? []).map((n) => n.text).join('')]
		: (node.content ?? []).flatMap(texts);

test('expanded instances copy definition values and preserve every surviving value', () => {
	const definition = createDefinition(
		'Score',
		root(
			text('label', 'Strength'),
			{ type: 'formula', attrs: { nodeId: 'formula', field: 'STR' } },
			{ type: 'image', attrs: { nodeId: 'image', src: 'portrait.png', alt: 'Portrait' } }
		),
		library()
	);
	const instance = prepareDocument(makeInstance(definition), library(definition));
	expect(instance.type).toBe('container');
	expect(instance.attrs?.customNode).toBe(true);
	expect(instance.attrs?.values).toBeUndefined();
	expect(texts(instance)).toEqual(['Strength']);
	instance.content![0] = text('label', 'Dexterity');
	instance.content![1].attrs!.field = '';
	instance.content![2].attrs = { ...instance.content![2].attrs, src: '', alt: 'Edited' };
	const changed = {
		...definition,
		rootClass: 'new-root',
		structure: root(
			text('label', 'New definition text'),
			{ type: 'formula', attrs: { nodeId: 'formula', field: 'DEX' } },
			{ type: 'image', attrs: { nodeId: 'image', src: 'new.png', alt: 'New' } }
		)
	};
	const refreshed = prepareDocument(instance, library(changed));
	expect(texts(refreshed)).toEqual(['Dexterity']);
	expect(refreshed.content![1].attrs?.field).toBe('');
	expect(refreshed.content![2].attrs).toMatchObject({ src: '', alt: 'Edited' });
	expect(refreshed.attrs?.class).toBe('root new-root');
	// An untouched value is also instance-owned after insertion.
	expect(texts(prepareDocument(makeInstance(definition), library(changed)))).toEqual(['Strength']);
	expect(prepareDocument(refreshed, library(changed))).toEqual(refreshed);
});

test('reset values keeps structure and stable identities, including nested nodes', () => {
	const definition = createDefinition(
		'Header',
		root(
			text('label', 'Arianne'),
			{ type: 'formula', attrs: { nodeId: 'formula', field: 'STR' } },
			{ type: 'image', attrs: { nodeId: 'image', src: 'portrait.png', alt: 'Portrait' } }
		),
		library()
	);
	const reset = resetLeafDefaults(definition.structure);
	expect(reset.attrs?.nodeId).toBe('root');
	expect(texts(reset)).toEqual(['...']);
	expect(reset.content![1].attrs).toMatchObject({ nodeId: 'formula', field: '' });
	expect(reset.content![2].attrs).toMatchObject({ nodeId: 'image', src: '', alt: '' });
});

test('definition validator rejects missing, cyclic and invalid references', () => {
	const child = createDefinition('Child', root(text('label', 'Child')), library());
	const parent = createDefinition('Parent', root(makeInstance(child)), library(child));
	expect(() => validateDefinition(parent, library(child))).not.toThrow();
	expect(() => validateDefinition(parent, library())).toThrow(
		'Missing custom block definition: child'
	);
	const recursive = { ...child, structure: root(makeInstance(parent)) };
	expect(() => validateDefinition(recursive, library(child, parent))).toThrow(/Circular/);
	expect(() =>
		validateDefinition({ ...child, structure: root(makeInstance(child)) }, library(child))
	).toThrow('Circular custom block reference: child → child');
	expect(() =>
		validateDefinition(
			{ ...child, structure: { ...child.structure, attrs: { customNode: true } } },
			library()
		)
	).toThrow(/stock root/);
});

test('definition validator accepts shared dependencies and checks transitive references', () => {
	const child = createDefinition('Child', root(text('label', 'Child')), library());
	const branch = createDefinition('Branch', root(makeInstance(child)), library(child));
	const parent = createDefinition(
		'Parent',
		root(makeInstance(child), makeInstance(branch), makeInstance(branch)),
		library(child, branch)
	);
	expect(() => validateDefinition(parent, library(child, branch))).not.toThrow();
	expect(() => validateDefinition(parent, library())).toThrow(/Missing/);
	const broken = {
		...child,
		structure: root({
			type: 'container',
			attrs: { customNode: true, typeId: 'missing' },
			content: [text('missing-slot', 'Missing')]
		})
	};
	expect(() => validateDefinition(parent, library(broken, branch))).toThrow(
		'Missing custom block definition: missing'
	);
});

test('nested instances retain separate values and propagate additions and removals', () => {
	const child = createDefinition(
		'Child',
		root(text('label', 'Child value'), text('removed', 'Remove me')),
		library()
	);
	const first = makeInstance(child);
	first.content[0] = text('label', 'Parent-specific value');
	const parent = createDefinition('Parent', root(first, makeInstance(child)), library(child));
	const instance = makeInstance(parent);
	instance.content[0].content![0] = text('label', 'Sheet value');
	const updatedChild = {
		...child,
		structure: root(
			text('new', 'Added definition value'),
			text('label', 'Changed definition value')
		)
	};
	const updated = prepareDocument(instance, library(updatedChild, parent));
	expect(texts(updated)).toEqual([
		'Added definition value',
		'Sheet value',
		'Added definition value',
		'Child value'
	]);
	expect(prepareDocument(updated, library(updatedChild, parent))).toEqual(updated);
	const fresh = prepareDocument(makeInstance(parent), library(updatedChild, parent));
	expect(texts(fresh)).toEqual([
		'Added definition value',
		'Parent-specific value',
		'Added definition value',
		'Child value'
	]);
});

test('converting a container preserves nested values and definition slot identities', () => {
	const child = createDefinition('Nested', root(text('label', 'Default')), library());
	const nested = makeInstance(child);
	nested.content[0] = text('label', 'Original instance');
	const source = ensureNodeIds(root(nested));
	const definition = createDefinition('Wrapper', source, library(child));
	const instance = makeInstance(definition);
	const restored = prepareDocument(
		{ ...source, attrs: instance.attrs },
		library(child, definition)
	);
	expect(texts(restored)).toEqual(['Original instance']);
	expect(restored.content![0].attrs?.nodeId).toBe(source.content[0].attrs?.nodeId);
	expect(definition.structure.attrs?.customNode).toBe(false);
});

test('definition evolution reorders, adds and removes nodes without changing surviving values', () => {
	const base = createDefinition(
		'Evolving',
		root(text('first', 'First'), text('second', 'Second')),
		library()
	);
	const instance = makeInstance(base);
	instance.content[0] = text('first', 'Customized');
	const reordered = {
		...base,
		structure: root(
			text('second', 'Changed second'),
			text('first', 'Changed first'),
			text('added', 'New')
		)
	};
	const updated = prepareDocument(instance, library(reordered));
	expect(texts(updated)).toEqual(['Second', 'Customized', 'New']);
	const deleted = {
		...reordered,
		structure: root(text('second', 'Changed again'), text('added', 'Changed again'))
	};
	const revised = prepareDocument(updated, library(deleted));
	expect(texts(revised)).toEqual(['Second', 'New']);
	expect(revised.content!.some((n) => n.attrs?.nodeId === 'first')).toBe(false);
	const readded = prepareDocument(revised, library(reordered));
	expect(texts(readded)).toEqual(['Second', 'Changed first', 'New']);
});

test('moving a surviving node between containers preserves values and updates classes', () => {
	const base = createDefinition(
		'Moving',
		root(
			{ type: 'container', attrs: { nodeId: 'left' }, content: [text('label', 'Original')] },
			{ type: 'container', attrs: { nodeId: 'right' }, content: [text('other', 'Other')] }
		),
		library()
	);
	const instance = makeInstance(base);
	instance.content[0].content![0] = text('label', 'Customized');
	const moved = {
		...base,
		structure: root({
			type: 'container',
			attrs: { nodeId: 'right' },
			content: [
				{ ...text('label', 'Changed'), attrs: { nodeId: 'label', class: 'updated-class' } },
				text('other', 'Changed other')
			]
		})
	};
	const updated = prepareDocument(instance, library(moved));
	expect(texts(updated)).toEqual(['Customized', 'Other']);
	expect(updated.content![0].content![0].attrs?.class).toBe('updated-class');
});

test('definition validation rejects unsupported node formats', () => {
	const compact = { type: 'customBlock', attrs: { typeId: 'missing', values: {} } };
	const invalid = { typeId: 'invalid', name: 'Invalid', rootClass: '', structure: root(compact) };
	expect(() => validateDefinition(invalid, library())).toThrow('Unsupported node: customBlock');
});

test('identity normalization keeps repeated nested definitions in separate scopes', () => {
	const child = createDefinition('Child', root(text('label', 'Value')), library());
	const a = makeInstance(child),
		b = makeInstance(child);
	const normalized = ensureNodeIds(root(a, b));
	expect(normalized.content[0].content![0].attrs?.nodeId).toBe('label');
	expect(normalized.content[1].content![0].attrs?.nodeId).toBe('label');
	expect(normalized.content[0].attrs?.nodeId).not.toBe(normalized.content[1].attrs?.nodeId);
});

test('reconciled instances share no editable nodes or attributes with inputs or definitions', () => {
	const definition = createDefinition(
		'Independent',
		root(text('label', 'Definition text'), {
			type: 'formula',
			attrs: { nodeId: 'formula', field: 'STR' }
		}),
		library()
	);
	const source = { type: 'doc', content: [makeInstance(definition), makeInstance(definition)] };
	const originalSource = structuredClone(source),
		originalDefinition = structuredClone(definition);
	const result = prepareDocument(source, library(definition));
	result.content[0].content[0].attrs!.class = 'Changed class';
	result.content[0].content[0].content![0].text = 'Changed text';
	result.content[0].content[1].attrs!.field = 'DEX';
	expect(source).toEqual(originalSource);
	expect(definition).toEqual(originalDefinition);
	expect(texts(result.content[1])).toEqual(['Definition text']);
	expect(result.content[1].content[0].attrs?.class).toBeUndefined();
	expect(result.content[1].content[1].attrs?.field).toBe('STR');
});
