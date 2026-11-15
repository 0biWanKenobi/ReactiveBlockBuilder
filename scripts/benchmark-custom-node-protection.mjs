// bun scripts/benchmark-custom-node-protection.mjs
import assert from 'node:assert/strict';
import { EditorState } from '@tiptap/pm/state';
import { CustomNodeProtection } from '../src/lib/editor/customNodes.ts';
import { instance, pluginsFor, schema } from './fixtures/editor.ts';

const text = (id) => schema.node('textBlock', { nodeId: id }, schema.text('Editable value'));
const scenarios = [
	...[100, 1000, 5000].map((count) => ({
		name: `${count} stock text blocks`,
		doc: schema.node(
			'doc',
			null,
			Array.from({ length: count }, (_, i) => text(`stock-${i}`))
		)
	})),
	...[100, 1000].map((count) => ({
		name: `Stock edit before ${count} unchanged custom instances, 60 leaves each`,
		doc: schema.node('doc', null, [
			text('before'),
			...Array.from({ length: count }, (_, i) => instance(`custom-${i}`, 60))
		])
	}))
];

const edit = (state) => state.applyTransaction(state.tr.insertText('!', 2));
const median = (samples) => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];

for (const { name, doc } of scenarios) {
	const states = [
		EditorState.create({ doc }),
		EditorState.create({ doc, plugins: pluginsFor(CustomNodeProtection) })
	];
	// Validate the same accepted edit and unchanged input outside the timed region.
	const input = doc.toJSON();
	const results = states.map(edit);
	for (const result of results) assert.equal(result.transactions.length, 1);
	assert.ok(results[0].state.doc.eq(results[1].state.doc));
	assert.notEqual(results[0].state.doc.firstChild.textContent, doc.firstChild.textContent);
	for (let i = 0; i < 20; i++) states.forEach(edit);
	const times = [[], []];
	for (let i = 0; i < 101; i++) {
		// Alternate order to reduce systematic bias between the two controls.
		for (const index of i % 2 ? [1, 0] : [0, 1]) {
			const start = performance.now();
			edit(states[index]);
			times[index].push(performance.now() - start);
		}
	}
	assert.deepEqual(doc.toJSON(), input);
	console.log(
		JSON.stringify({
			scenario: name,
			withoutProtectionMedianMs: Number(median(times[0]).toFixed(4)),
			withProtectionMedianMs: Number(median(times[1]).toFixed(4))
		})
	);
}
