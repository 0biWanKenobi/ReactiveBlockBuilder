import { expect, test } from 'bun:test';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import { BlockInteraction } from '../src/lib/editor/blockInteraction';
import { BlockDragPreview } from '../src/lib/editor/blockDragPreview';
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

test('drop preview decorations reuse selection updates and refresh geometry, document and mode', () => {
	const interaction = pluginsFor(BlockInteraction);
	const [preview] = pluginsFor(BlockDragPreview);
	const decorations = (state: EditorState) =>
		preview.props.decorations!.call(preview, state) as DecorationSet;
	const doc = schema.node('doc', null, schema.node('textBlock', null, schema.text('Stock')));
	let state = EditorState.create({ doc, plugins: [...interaction, preview] });
	expect(decorations(state)).toBe(DecorationSet.empty);
	state = state.apply(state.tr.setMeta(interaction[1], true));
	const target = {
		pos: doc.content.size,
		width: 100,
		height: 24,
		source: { from: 0, to: doc.content.size }
	};
	state = state.apply(state.tr.setMeta(preview, target));
	const first = decorations(state);
	expect(first.find()).toHaveLength(2);
	state = state.apply(state.tr.setSelection(TextSelection.create(doc, 2)));
	expect(decorations(state)).toBe(first);
	state = state.apply(state.tr.setMeta('gutter-hover', 0));
	expect(decorations(state)).toBe(first);
	state = state.apply(state.tr.setMeta(preview, { ...target, height: 48 }));
	const resized = decorations(state);
	expect(resized).not.toBe(first);
	expect(
		resized.find().find((decoration) => decoration.from === decoration.to)?.spec.key
	).toContain('-48-100');
	state = state.apply(state.tr.setMeta(interaction[1], false));
	expect(decorations(state)).toBe(DecorationSet.empty);
	state = state.apply(state.tr.setMeta(preview, { pos: 0, width: 100, height: 24 }));
	const palette = decorations(state);
	expect(palette.find()).toHaveLength(1);
	state = state.apply(state.tr.setSelection(TextSelection.create(doc, 3)));
	expect(decorations(state)).toBe(palette);
	state = state.apply(state.tr.insertText('!', 1));
	expect(decorations(state)).toBe(DecorationSet.empty);
	state = state.apply(state.tr.setMeta(preview, { pos: 0, width: 100, height: 24 }));
	expect(decorations(state)).not.toBe(palette);
});
