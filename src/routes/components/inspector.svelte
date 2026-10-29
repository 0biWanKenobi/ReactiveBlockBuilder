<script lang="ts">
	import '../../styles/shared.css';
	import type { Editor } from '@tiptap/core';
	import { allowedNodeTypes, type SheetNodeType } from '#lib';
	import { selectedBlock, updateBlockAttribute } from '#lib/editor/selection.js';
	import type { EditorMode } from './leftSidebar.svelte';

	let { mode, editor }: { mode: EditorMode; editor: Editor | null } = $props();

	type SelectedBlock = {
		type: SheetNodeType;
		pos: number;
		attrs: Record<string, unknown>;
	};

	let selected = $state<SelectedBlock | null>(null);

	$effect(() => {
		const current = editor;
		if (!current) {
			selected = null;
			return;
		}

		const synchronizeSelection = () => {
			const found = selectedBlock(current);
			selected =
				found && allowedNodeTypes.includes(found.type as SheetNodeType)
					? { ...found, type: found.type as SheetNodeType }
					: null;
		};

		synchronizeSelection();
		current.on('transaction', synchronizeSelection);
		return () => {
			current.off('transaction', synchronizeSelection);
		};
	});

	function selectedCustomBlockPosition() {
		if (!editor || !selected) return null;
		const resolved = editor.state.doc.resolve(selected.pos);
		for (let depth = 1; depth <= resolved.depth; depth++) {
			if (resolved.node(depth).type.name === 'customBlock') return resolved.before(depth);
		}
		return selected.type === 'customBlock' ? selected.pos : null;
	}

	function selectedIsInsideCustomBlock() {
		const position = selectedCustomBlockPosition();
		return position !== null && position !== selected?.pos;
	}

	function editAttribute(attribute: string, value: string) {
		if (!editor || !selected) return;
		const node = editor.state.doc.nodeAt(selected.pos);
		if (!node || node.type.name !== selected.type) return;
		if (attribute === 'class' && (selected.type === 'customBlock' || selectedIsInsideCustomBlock()))
			return;
		updateBlockAttribute(editor, selected.pos, attribute, value);
	}

	function removeSelected() {
		if (!editor || !selected) return;
		// Descendants belong to the definition; delete their whole sheet instance.
		const position = selectedCustomBlockPosition() ?? selected.pos;
		const node = editor.state.doc.nodeAt(position);
		if (!node) return;
		editor.commands.deleteRange({ from: position, to: position + node.nodeSize });
		selected = null;
	}
</script>

<aside class="sidebar" inert={mode === 'play'}>
	<div class="panel-heading">Properties</div>
	{#if mode !== 'design'}
		<p class="muted">Switch to Design to modify nodes.</p>
	{:else if selected}
		<div class="selection-heading">
			<strong>{selected.type}</strong><span>node at {selected.pos}</span>
		</div>
		{#if selected.type !== 'customBlock' && !selectedIsInsideCustomBlock()}
			<label class="property">
				<span>CSS classes</span>
				<input
					aria-label="Selected block CSS classes"
					value={String(selected.attrs.class ?? '')}
					oninput={(event) => editAttribute('class', event.currentTarget.value)}
				/>
			</label>
		{/if}
		{#if selected.type === 'formula'}
			<label class="property">
				<span>Field ID</span>
				<input
					aria-label="Selected formula field"
					value={String(selected.attrs.field ?? '')}
					oninput={(event) => editAttribute('field', event.currentTarget.value)}
				/>
			</label>
		{:else if selected.type === 'image'}
			<label class="property">
				<span>Image URL</span>
				<input
					aria-label="Selected image URL"
					value={String(selected.attrs.src ?? '')}
					oninput={(event) => editAttribute('src', event.currentTarget.value)}
				/>
			</label>
			<label class="property">
				<span>Alt text</span>
				<input
					aria-label="Selected image description"
					value={String(selected.attrs.alt ?? '')}
					oninput={(event) => editAttribute('alt', event.currentTarget.value)}
				/>
			</label>
		{:else if selected.type === 'textBlock'}
			<p class="muted">Edit the text directly on the canvas.</p>
		{:else}
			<p class="muted">
				The container can hold other blocks. Select its inner blocks or edit its CSS layout rules.
			</p>
		{/if}
		<button class="danger-button" onclick={removeSelected}>
			{selectedIsInsideCustomBlock() ? 'Delete custom block' : 'Delete selected block'}
		</button>
	{:else}
		<p class="muted">Select a text, formula, image or container block to edit its properties.</p>
	{/if}
	<div class="separator"></div>
	<div class="panel-heading">Notes</div>
	<p class="muted">
		The editor uses only our registered nodes. The formulas are shared reactive state, not copied
		into Tiptap nodes.
	</p>
</aside>

<style>
	.selection-heading {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		margin: 18px 0;
	}
	.selection-heading strong {
		font-size: 0.85rem;
	}
	.selection-heading span {
		color: #8c7f70;
		font-size: 0.67rem;
	}
	.property input {
		font-size: 0.77rem;
	}
	.danger-button {
		border: 1px solid #e5c8c0;
		border-radius: 7px;
		background: #fff5f3;
		color: #a74335;
		padding: 9px;
		font-size: 0.76rem;
	}
</style>
