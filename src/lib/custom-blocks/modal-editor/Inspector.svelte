<script lang="ts">
	import { updateBlockAttribute } from '#lib/editor/selection.ts';
	import type { Editor } from '@tiptap/core';
	import Checkbox from '#lib/components/Checkbox.svelte';

	export type SelectedBlock = {
		pos: number;
		type: string;
		attrs: Record<string, unknown>;
		customParent?: number;
	};

	let {
		block,
		editor,
		openNested
	}: {
		block: SelectedBlock;
		editor: Editor;
		openNested: () => void;
	} = $props();

	function updateAttr(attribute: string, value: string | boolean) {
		const node = editor.state.doc.nodeAt(block.pos);
		if (!node) return false;
		updateBlockAttribute(editor, block.pos, attribute, value);
	}
</script>

<div class="section-title" style="margin-top: 10px;">Selected: {block.type}</div>
{#if block.attrs.customNode}
	<p class="hint">Nested block: {String(block.attrs.typeId ?? '')}</p>
	<p class="hint">Select inner blocks to edit their values within this definition.</p>
	<button onclick={openNested}>Edit definition</button>
{:else if block.type === 'formula'}
	<label
		>Field <input
			value={String(block.attrs.field ?? '')}
			oninput={(e) => updateAttr('field', e.currentTarget.value)}
		/></label
	>
	<label
		>Label <input
			aria-label="Selected formula label"
			value={String(block.attrs.label ?? '')}
			oninput={(e) => updateAttr('label', e.currentTarget.value)}
		/></label
	>
	<Checkbox
		label="Show Label"
		bind:checked={() => !!block.attrs.showLabel, (value) => updateAttr('showLabel', value)}
	/>
{:else if block.type === 'image'}
	<label
		>Source <input
			value={String(block.attrs.src ?? '')}
			oninput={(e) => updateAttr('src', e.currentTarget.value)}
		/></label
	>
{/if}
{#if !block.attrs.customNode && block.customParent === undefined}
	<label
		>Classes <input
			value={String(block.attrs.class ?? '')}
			oninput={(e) => updateAttr('class', e.currentTarget.value)}
		/></label
	>
{/if}
{#if block.customParent === undefined}
	<button
		class="danger-button"
		style="margin-top: 12px"
		onclick={() => {
			const n = editor.state.doc.nodeAt(block.pos);
			if (n)
				editor.commands.deleteRange({
					from: block.pos,
					to: block.pos + n.nodeSize
				});
		}}>Delete selected</button
	>
{/if}

<style>
	.section-title {
		font-size: 0.75rem;
		font-weight: 800;
		margin-bottom: 12px;
	}

	.hint {
		font-size: 0.74rem;
		color: #796d61;
	}

	label {
		display: grid;
		gap: 5px;
		font-size: 0.73rem;
		font-weight: 700;
		margin-top: 12px;
	}

	input {
		padding: 7px;
		min-width: 150px;
	}
</style>
