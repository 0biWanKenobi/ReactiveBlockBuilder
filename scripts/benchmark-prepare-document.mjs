// bun scripts/benchmark-prepare-document.mjs [path-to-baseline-module]
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createDefinition, makeInstance, prepareDocument } from '../src/lib/custom-blocks/model.ts';

function library(...definitions) {
	return {
		get: (id) => definitions.find((d) => d.typeId === id),
		clone: (id) => structuredClone(definitions.find((d) => d.typeId === id)),
		list: () => definitions
	};
}
const text = (id, value = 'A field value long enough to resemble sheet content') => ({
	type: 'textBlock',
	attrs: { nodeId: id, class: 'label', customNode: false },
	content: [{ type: 'text', text: value }]
});
const container = (id, content) => ({
	type: 'container',
	attrs: { nodeId: id, class: 'layout', customNode: false, typeId: '', instanceId: '' },
	content
});
const leaves = (count) =>
	Array.from({ length: count }, (_, i) =>
		i % 3 === 0
			? text('leaf-' + i)
			: i % 3 === 1
				? {
						type: 'formula',
						attrs: { nodeId: 'leaf-' + i, class: 'value', customNode: false, field: 'STR' }
					}
				: {
						type: 'image',
						attrs: {
							nodeId: 'leaf-' + i,
							class: 'image',
							customNode: false,
							src: 'portrait.png',
							alt: 'Portrait'
						}
					}
	);
let deep = container('bottom', leaves(10));
for (let i = 0; i < 12; i++)
	deep = container('depth-' + i, [
		deep,
		...leaves(8).map((n, j) => ({ ...n, attrs: { ...n.attrs, nodeId: `level-${i}-${j}` } }))
	]);
const child = createDefinition('Benchmark Child', container('child', leaves(24)), library());
const parent = createDefinition(
	'Benchmark Parent',
	container('parent', [...leaves(12), ...Array.from({ length: 6 }, () => makeInstance(child))]),
	library(child)
);
const repeated = createDefinition(
	'Benchmark Repeated',
	container('repeated', leaves(60)),
	library()
);
const definitions = library(child, parent, repeated);
const scenarios = [
	{
		name: 'stock depth 12, 40 roots',
		document: { type: 'doc', content: Array.from({ length: 40 }, () => structuredClone(deep)) }
	},
	{
		name: '100 instances, 60 leaves each',
		document: { type: 'doc', content: Array.from({ length: 100 }, () => makeInstance(repeated)) }
	},
	{
		name: '60 parent instances, 6 nested children each',
		document: { type: 'doc', content: Array.from({ length: 60 }, () => makeInstance(parent)) }
	}
];
const baseline = process.argv[2]
	? (await import(pathToFileURL(resolve(process.argv[2])).href)).prepareDocument
	: undefined;
const count = (node) => 1 + (node.content ?? []).reduce((sum, n) => sum + count(n), 0);
function measure(fn, doc) {
	for (let i = 0; i < 3; i++) fn(doc, definitions);
	const times = [];
	for (let i = 0; i < 15; i++) {
		const start = performance.now();
		fn(doc, definitions);
		times.push(performance.now() - start);
	}
	times.sort((a, b) => a - b);
	return Number(times[7].toFixed(2));
}
for (const scenario of scenarios) {
	const input = JSON.stringify(scenario.document);
	if (baseline)
		assert.deepStrictEqual(
			prepareDocument(scenario.document, definitions),
			baseline(scenario.document, definitions)
		);
	const before = baseline ? measure(baseline, scenario.document) : undefined;
	const after = measure(prepareDocument, scenario.document);
	assert.equal(JSON.stringify(scenario.document), input, 'Reconciliation must not mutate input');
	console.log(
		JSON.stringify({
			scenario: scenario.name,
			nodes: count(scenario.document),
			baselineMedianMs: before,
			medianMs: after,
			speedup: before ? Number((before / after).toFixed(2)) : undefined
		})
	);
}
