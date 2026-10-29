import { expect, test } from 'bun:test';
import type { Editor } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { selectedBlock, updateBlockAttribute } from '../src/lib/editor/selection.js';

const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		container: { group: 'block', content: 'block+', attrs: { class: { default: '' } } },
		textBlock: { group: 'block', content: 'text*', attrs: { class: { default: '' } } },
		formula: { group: 'block', atom: true, attrs: { field: { default: 'STR' } } },
		image: { group: 'block', atom: true, attrs: { alt: { default: '' } } },
		text: {}
	}
});

function editorWithSelection(selection: 'node' | 'text', pos: number, to = pos) {
	const doc = schema.node('doc', null, [
		schema.node('container', { class: 'header' }, [
			schema.node('textBlock', { class: 'title' }, schema.text('Title')),
			schema.node('formula'),
			schema.node('image')
		]),
		schema.node('textBlock', null, schema.text('Next block'))
	]);
	let state = EditorState.create({
		doc,
		selection:
			selection === 'node' ? NodeSelection.create(doc, pos) : TextSelection.create(doc, pos, to)
	});
	return {
		get state() {
			return state;
		},
		view: {
			dispatch(transaction) {
				state = state.apply(transaction);
			}
		}
	} as Editor;
}

for (const [type, pos, attribute] of [
	['container', 0, 'class'],
	['textBlock', 1, 'class'],
	['formula', 8, 'field'],
	['image', 9, 'alt']
] as const) {
	test(`inspector typing keeps ${type} selected across attribute edits`, () => {
		const editor = editorWithSelection('node', pos);
		const selection = editor.state.selection.toJSON();
		const originalContent = editor.state.doc.nodeAt(pos)!.content;
		for (const value of ['n', 'ne', 'new', 'new value']) {
			updateBlockAttribute(editor, pos, attribute, value);
			expect(editor.state.selection.toJSON()).toEqual(selection);
			expect(selectedBlock(editor)).toMatchObject({ pos, type, attrs: { [attribute]: value } });
			expect(editor.state.doc.nodeAt(pos)!.content.eq(originalContent)).toBe(true);
		}
	});
}

for (const to of [3, 5]) {
	test(`inspector edits preserve text selection from 3 to ${to}`, () => {
		const editor = editorWithSelection('text', 3, to);
		const selection = editor.state.selection.toJSON();
		updateBlockAttribute(editor, 1, 'class', 'updated-title');
		expect(editor.state.selection.toJSON()).toEqual(selection);
		expect(selectedBlock(editor)).toMatchObject({ pos: 1, type: 'textBlock' });
		expect(editor.state.doc.nodeAt(1)!.textContent).toBe('Title');
	});
}
