<script lang="ts">
	import '../../styles/shared.css';
	import { validateId, type Sheet } from '#lib';
	import type { CustomBlockLibrary } from '#lib/custom-blocks/library.svelte.ts';
	import { expandDocument } from '#lib/custom-blocks/model.ts';
	import type { CustomBlockRepository } from '#lib/custom-blocks/repository.ts';
	import type { CustomBlockDefinition } from '#lib/custom-blocks/types.ts';
	import { endPaletteDrag, startPaletteDrag } from '#lib/editor/blockDragPreview.ts';
	import BlockPalette from '#lib/editor/BlockPalette.svelte';
	import type { OpResult } from '#lib/types/shared.ts';
	import type { Editor, JSONContent } from '@tiptap/core';

	export type EditorMode = 'design' | 'play';
	export type SaveBehavior = 'ask' | 'replace' | 'keep';

	let {
		mode,
		saveBehavior = $bindable('ask'),
		library,
		repository,
		sheet,
		editor,
		onDragPaletteBlock,
		onBlockEdit,
		onBlockDelete
	}: {
		mode: EditorMode;
		saveBehavior: SaveBehavior;
		library: CustomBlockLibrary;
		repository: CustomBlockRepository;
		sheet: Sheet;
		editor: Editor | null;
		onDragPaletteBlock: (res: OpResult) => void;
		onBlockEdit: (block: CustomBlockDefinition) => void;
		onBlockDelete: (res: OpResult) => Promise<void>;
	} = $props();

	let newField = $state('');
	let newExpression = $state('1');
	let fieldError = $state('');

	function addField() {
		const id = newField.trim().toUpperCase();
		const invalid = validateId(id);
		if (invalid) {
			fieldError = invalid;
			return;
		}
		if (Object.hasOwn(sheet, id)) {
			fieldError = 'Field already exists';
			return;
		}
		sheet[id] = { id, formula: newExpression };
		newField = '';
		newExpression = '1';
		fieldError = '';
	}

	function _onDragPaletteBlock(event: DragEvent, block: JSONContent) {
		if (!editor || mode !== 'design') {
			event.preventDefault();
			onDragPaletteBlock({
				success: false,
				message: 'Editor is not initialized or mode is not Design'
			});
			return;
		}

		try {
			const expanded = expandDocument({ type: 'doc', content: [block] }, library).content?.[0];
			if (expanded) startPaletteDrag(editor.view, event, expanded);
			onDragPaletteBlock({ success: true });
		} catch (error) {
			event.preventDefault();
			onDragPaletteBlock({
				success: false,
				message: `Cannot drag block: ${error instanceof Error ? error.message : String(error)}`
			});
		}
	}

	function onFinishPaletteDrag() {
		if (editor) endPaletteDrag(editor.view);
	}

	async function _onBlockDelete(definition: CustomBlockDefinition) {
		if (
			!window.confirm(
				`Delete "${definition.name}"? Sheets and custom blocks that reference it will fail to import.`
			)
		) {
			await onBlockDelete({ success: false, message: 'Delete canceled' });
			return;
		}
		try {
			await repository.delete(definition.typeId);
			library.remove(definition.typeId);
			await onBlockDelete({
				success: true,
				message: `Deleted custom block: ${definition.name}`
			});
		} catch (error) {
			await onBlockDelete({
				success: false,
				message: `Delete failed: ${error instanceof Error ? error.message : String(error)}`
			});
		}
	}
</script>

<aside class="sidebar" inert={mode === 'play'}>
	<div class="panel-heading">Block palette</div>
	<p class="muted">
		Drag blocks onto the sheet, inside containers or between blocks. Use the canvas gutters for
		top-level placement. Click to insert at the cursor.
	</p>
	<div class="panel-heading">Stock blocks</div>
	<label class="property">
		<span>After saving a custom block</span>
		<select aria-label="After saving a custom block" bind:value={saveBehavior}>
			<option value="ask">Ask every time</option>
			<option value="replace">Replace original with custom block</option>
			<option value="keep">Keep original unchanged</option>
		</select>
	</label>
	<BlockPalette
		customBlocks={library.definitions}
		draggable={mode === 'design'}
		onDragStart={_onDragPaletteBlock}
		onDragEnd={onFinishPaletteDrag}
		onEdit={onBlockEdit}
		onDelete={_onBlockDelete}
	/>
	<div class="separator"></div>
	<div class="panel-heading">Formula fields</div>
	<p class="muted">Modify STR to watch STR_MOD, ATTACK and the stat blocks update.</p>
	<div class="field-list">
		{#each Object.keys(sheet) as id (id)}
			<label class="field-row">
				<span>{id}</span>
				<input aria-label={`Formula for ${id}`} spellcheck="false" bind:value={sheet[id].formula} />
			</label>
		{/each}
	</div>
	<div class="separator"></div>
	<form
		class="new-field"
		onsubmit={(event) => {
			event.preventDefault();
			addField();
		}}
	>
		<input aria-label="New field identifier" placeholder="FIELD_ID" bind:value={newField} />
		<input aria-label="New field formula" placeholder="Formula" bind:value={newExpression} />
		<button type="submit">+ Add field</button>
	</form>
	{#if fieldError}<p class="error">{fieldError}</p>{/if}
</aside>

<style>
	.field-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.field-row {
		display: grid;
		gap: 4px;
	}

	.field-row span {
		color: #746353;
		font:
			700 0.67rem ui-monospace,
			monospace;
	}

	.new-field {
		display: grid;
		gap: 8px;
		margin-top: 15px;
	}

	.new-field button {
		padding: 8px;
		border: 1px solid #a57e4f;
		border-radius: 7px;
		color: #5b401e;
		background: #f8e9d0;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.error {
		color: #b34536;
		font-size: 0.73rem;
	}

	.field-row input,
	.new-field input {
		font:
			0.73rem ui-monospace,
			monospace;
	}

	select {
		width: 100%;
		padding: 8px;
		border: 1px solid #d8d2c9;
		border-radius: 6px;
		background: white;
	}
</style>
