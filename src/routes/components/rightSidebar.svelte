<script lang="ts">
	import '../../styles/shared.css';
	import type { Editor } from '@tiptap/core';
	import { allowedNodeTypes, type Sheet, type SheetNodeType } from '#lib';
	import { selectedBlock, updateBlockAttribute } from '#lib/editor/selection';
	import type { EditorMode } from './leftSidebar.svelte';
	import type { StockBlockType } from '#lib/themes/styles';
	import paletteIcon from '#lib/icons/palette.svg';
	import trashIcon from '#lib/icons/trash.svg';
	import { isBlockDragMode } from '#lib/editor/blockInteraction';
	import Checkbox from '#lib/components/Checkbox.svelte';

	let {
		mode,
		editor,
		sheet,
		onEditThemeCSS
	}: {
		mode: EditorMode;
		editor: Editor | null;
		sheet: Sheet;
		onEditThemeCSS: (type: StockBlockType) => void;
	} = $props();

	type SelectedBlock = {
		type: SheetNodeType;
		pos: number;
		attrs: Record<string, unknown>;
		customParent?: number;
	};

	let selected = $state<SelectedBlock | null>(null);

	const fieldId = $derived(String(selected?.attrs.field));
	const fieldValue = $derived.by(() => {
		if (!fieldId) return null;
		return sheet[fieldId].formula;
	});

	function updateFieldValue(v: string) {
		if (!fieldId) return;
		sheet[fieldId].formula = v;
	}

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

	function editAttribute(attribute: string, value: string | boolean) {
		if (!editor || !selected) return;
		const node = editor.state.doc.nodeAt(selected.pos);
		if (!node || node.type.name !== selected.type) return;
		updateBlockAttribute(editor, selected.pos, attribute, value);
	}

	function setBlockFormula(formulaId: string) {
		if (!sheet[formulaId]) return;
		editAttribute('field', formulaId);
	}

	function removeSelected() {
		if (!editor || !selected) return;
		const position = selected.pos;
		const node = editor.state.doc.nodeAt(position);
		if (!node) return;
		editor.commands.deleteRange({ from: position, to: position + node.nodeSize });
		selected = null;
	}
</script>

<aside class="sidebar" inert={mode === 'play'}>
	<div class="panel-heading">Properties</div>
	{#if selected}
		{@const selectedType = selected.type}
		{@const deleteLabel =
			selected.attrs.customNode && editor && !isBlockDragMode(editor.state)
				? 'Delete custom block'
				: 'Delete selected block'}
		<div class="selection-heading">
			<strong>{selected.type}</strong>
			<div class="selection-actions">
				{#if !selected.attrs.customNode && selected.customParent === undefined}
					<button
						type="button"
						aria-label="Edit Style"
						title="Edit Style"
						onclick={() => onEditThemeCSS(selectedType)}
					>
						<span class="action-icon" style:mask-image={`url("${paletteIcon}")`} aria-hidden="true"
						></span>
					</button>
				{/if}
				{#if selected.customParent === undefined}
					<button
						type="button"
						class="danger-button"
						aria-label={deleteLabel}
						title={deleteLabel}
						onclick={removeSelected}
					>
						<span class="action-icon" style:mask-image={`url("${trashIcon}")`} aria-hidden="true"
						></span>
					</button>
				{/if}
			</div>
		</div>
		{#if !selected.attrs.customNode && selected.customParent === undefined}
			<label class="property">
				<span>CSS classes</span>
				<input
					aria-label="Selected block CSS classes"
					value={String(selected.attrs.class ?? '')}
					oninput={(event) => editAttribute('class', event.currentTarget.value)}
				/>
			</label>
		{/if}
		{#if selected.attrs.customNode}
			<p class="muted">Select inner blocks to edit their values.</p>
		{:else if selected.type === 'formula'}
			<label class="property">
				<span>Field ID</span>
				<input
					aria-label="Selected formula field"
					value={String(selected.attrs.field ?? '')}
					oninput={(event) => setBlockFormula(event.currentTarget.value)}
				/>
			</label>
			<label class="property">
				<span>Field Value</span>
				<input
					aria-label="Selected formula value"
					bind:value={() => fieldValue ?? '', updateFieldValue}
				/>
			</label>
			<label class="property">
				<span>Label</span>
				<input
					aria-label="Selected formula label"
					value={String(selected.attrs.label ?? '')}
					oninput={(event) => editAttribute('label', event.currentTarget.value)}
				/>
			</label>
			<Checkbox
				label="Show Label"
				bind:checked={
					() => !!selected?.attrs.showLabel, (value) => editAttribute('showLabel', value)
				}
			/>
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
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin: 18px 0;
	}
	.selection-heading strong {
		font-size: 0.85rem;
	}
	.selection-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.selection-actions button {
		display: grid;
		place-items: center;
		box-sizing: border-box;
		width: 32px;
		height: 32px;
		padding: 0;
		color: #936a3e;
		font-size: 12px;
		line-height: 1;
	}
	.selection-actions .danger-button {
		border-color: #e5c8c0;
		background: #fff5f3;
		color: #a74335;
	}
	.action-icon {
		width: 16px;
		height: 16px;
		background: currentColor;
		mask-position: center;
		mask-size: contain;
		mask-repeat: no-repeat;
	}
	.property input {
		font-size: 0.77rem;
	}
</style>
