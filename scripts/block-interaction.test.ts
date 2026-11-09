import { expect, test } from 'bun:test';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import { BlockInteraction } from '../src/lib/editor/blockInteraction';
import { instance, pluginsFor, schema } from './fixtures/editor';

test('drag decorations reuse unchanged documents and refresh after edits and tool changes', () => {
	const plugins = pluginsFor(BlockInteraction);
	const drag = plugins[1];
	const decorations = (state: EditorState) =>
		drag.props.decorations!.call(drag, state) as DecorationSet;
	const custom = instance();
	const doc = schema.node('doc', null, [
		custom,
		schema.node('container', null, schema.node('textBlock', null, schema.text('Stock')))
	]);
	let state = EditorState.create({ doc, plugins });
	expect(decorations(state)).toBe(DecorationSet.empty);
	state = state.apply(state.tr.setMeta(drag, true));
	const first = decorations(state);
	// Only the outer custom block is draggable; stock descendants get individual targets.
	expect(first.find()).toHaveLength(3);
	state = state.apply(state.tr.setSelection(TextSelection.create(doc, 3)));
	expect(decorations(state)).toBe(first);
	state = state.apply(state.tr.setMeta('hover-only', 1));
	expect(decorations(state)).toBe(first);
	state = state.apply(state.tr.insertText('!', 3));
	const changed = decorations(state);
	expect(changed).not.toBe(first);
	expect(changed.find()[0].to).toBe(custom.nodeSize + 1);
	expect(changed.find()[1].from).toBe(custom.nodeSize + 1);
	state = state.apply(state.tr.setMeta(drag, false));
	expect(decorations(state)).toBe(DecorationSet.empty);
	state = state.apply(state.tr.setMeta(drag, true));
	expect(decorations(state)).toBe(changed);
});
