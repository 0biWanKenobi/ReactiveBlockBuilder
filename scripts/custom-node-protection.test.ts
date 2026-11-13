import { expect, test } from 'bun:test';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CustomNodeProtection, customNodeSync } from '../src/lib/editor/customNodes';
import { instance, pluginsFor, schema } from './fixtures/editor';

function stateWith(...nodes: ReturnType<typeof instance>[]) {
	const doc = schema.node('doc', null, nodes.length ? nodes : [instance()]);
	return EditorState.create({
		doc,
		selection: TextSelection.atStart(doc),
		plugins: pluginsFor(CustomNodeProtection)
	});
}

test('custom nodes allow text and leaf value edits but protect structure and classes', () => {
	const state = stateWith();
	expect(state.applyTransaction(state.tr.insertText('!', 2)).transactions).toHaveLength(1);
	expect(
		state.applyTransaction(state.tr.setNodeAttribute(1, 'class', 'changed')).transactions
	).toHaveLength(0);
	expect(
		state.applyTransaction(state.tr.delete(1, state.doc.firstChild!.firstChild!.nodeSize + 1))
			.transactions
	).toHaveLength(0);
	expect(
		state.applyTransaction(state.tr.setNodeAttribute(0, 'typeId', 'changed')).transactions
	).toHaveLength(0);
	const values = stateWith(
		schema.node('container', { customNode: true, instanceId: 'values' }, [
			schema.node('formula'),
			schema.node('image')
		])
	);
	const tr = values.tr
		.setNodeAttribute(1, 'field', 'DEX')
		.setNodeAttribute(2, 'src', 'portrait.png')
		.setNodeAttribute(2, 'alt', 'Portrait');
	expect(values.applyTransaction(tr).transactions).toHaveLength(1);
});

test('nested custom node structure remains protected', () => {
	const state = stateWith(
		schema.node('container', { customNode: true, instanceId: 'outer' }, [instance()])
	);
	expect(state.applyTransaction(state.tr.insertText('!', 3)).transactions).toHaveLength(1);
	expect(
		state.applyTransaction(state.tr.setNodeAttribute(1, 'class', 'changed')).transactions
	).toHaveLength(0);
});

test('formula labels and visibility are editable inside direct and nested custom nodes', () => {
	for (const nested of [false, true]) {
		const child = schema.node('container', { customNode: true, instanceId: 'child' }, [
			schema.node('formula', { field: 'STR', showLabel: false })
		]);
		let state = stateWith(
			nested ? schema.node('container', { customNode: true, instanceId: 'parent' }, [child]) : child
		);
		const position = nested ? 2 : 1;
		const edited = state.applyTransaction(state.tr.setNodeAttribute(position, 'label', 'Power'));
		expect(edited.transactions).toHaveLength(1);
		state = edited.state;
		expect(state.doc.nodeAt(position)!.attrs.label).toBe('Power');
		for (const showLabel of [true, false]) {
			const result = state.applyTransaction(
				state.tr.setNodeAttribute(position, 'showLabel', showLabel)
			);
			expect(result.transactions).toHaveLength(1);
			state = result.state;
			expect(state.doc.nodeAt(position)!.attrs.showLabel).toBe(showLabel);
		}
	}
});

test('only whole selected instances may be removed, including copies with duplicate IDs', () => {
	const node = instance();
	const state = stateWith(node, node);
	expect(state.applyTransaction(state.tr.delete(0, node.nodeSize)).transactions).toHaveLength(0);
	const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
	expect(selected.applyTransaction(selected.tr.delete(0, node.nodeSize)).transactions).toHaveLength(
		1
	);
	expect(
		selected.applyTransaction(selected.tr.delete(0, node.nodeSize * 2)).transactions
	).toHaveLength(0);
	// Every copy is checked against the original structure, even if another copy is unchanged.
	expect(
		state.applyTransaction(state.tr.setNodeAttribute(node.nodeSize + 1, 'class', 'changed'))
			.transactions
	).toHaveLength(0);
});

test('new instances and explicit definition synchronization remain allowed', () => {
	const state = stateWith();
	expect(
		state.applyTransaction(state.tr.insert(state.doc.content.size, instance('new'))).transactions
	).toHaveLength(1);
	expect(
		state.applyTransaction(
			state.tr.setNodeAttribute(1, 'class', 'changed').setMeta(customNodeSync, true)
		).transactions
	).toHaveLength(1);
});
