<script lang="ts">
	import { updateBlockAttribute } from '#lib/editor/selection.ts';
	import type { Editor } from '@tiptap/core';

	export type SelectedBlock = {
		pos: number;
		type: string;
		attrs: Record<string, unknown>;
	};

	export type NestedValue = {
		pos: number;
		type: string;
		label: string;
		value: string;
		alt?: string;
	};

	let {
		block,
		nestedValues,
		editor,
		openNested,
		syncStructure
	}: {
		block: SelectedBlock;
		nestedValues: NestedValue[];
		editor: Editor;
		openNested: () => void;
		syncStructure: () => void;
	} = $props();

	function updateNestedValue(
		leaf: NestedValue,
		value: string,
		property: 'value' | 'alt' = 'value'
	) {
		if (!editor) return false;
		const node = editor.state.doc.nodeAt(leaf.pos);
		if (!node || node.type.name !== leaf.type) return false;
		const transaction = editor.state.tr;
		if (leaf.type === 'textBlock') {
			const content = value ? editor.state.schema.text(value) : undefined;
			transaction.replaceWith(
				leaf.pos,
				leaf.pos + node.nodeSize,
				node.type.create(node.attrs, content)
			);
		} else {
			const key = property === 'alt' ? 'alt' : leaf.type === 'formula' ? 'field' : 'src';
			transaction.setNodeMarkup(leaf.pos, undefined, { ...node.attrs, [key]: value });
		}
		editor.view.dispatch(transaction);
		syncStructure();
		return true;
	}

	function updateAttr(attribute: string, value: string) {
		const node = editor.state.doc.nodeAt(block.pos);
		if (!node) return false;
		updateBlockAttribute(editor, block.pos, attribute, value);
		syncStructure();
	}
</script>

<div class="section-title" style="margin-top: 10px;">Selected: {block.type}</div>
{#if block.type === 'customBlock'}
	<p class="hint">Nested block: {String(block.attrs.typeId ?? '')}</p>
	<p class="hint">Values here override defaults only within this parent definition.</p>
	{#each nestedValues as leaf (leaf.pos)}
		<label
			>{leaf.label} ({leaf.type})
			<input
				aria-label={`Nested ${leaf.label} value`}
				value={leaf.value}
				oninput={(event) => updateNestedValue(leaf, event.currentTarget.value)}
			/>
		</label>
		{#if leaf.type === 'image'}
			<label
				>Image description
				<input
					aria-label={`Nested ${leaf.label} alt`}
					value={leaf.alt ?? ''}
					oninput={(event) => updateNestedValue(leaf, event.currentTarget.value, 'alt')}
				/>
			</label>
		{/if}
	{/each}
	<button onclick={openNested}>Edit definition</button>
{:else if block.type === 'formula'}
	<label
		>Field <input
			value={String(block.attrs.field ?? '')}
			oninput={(e) => updateAttr('field', e.currentTarget.value)}
		/></label
	>
{:else if block.type === 'image'}
	<label
		>Source <input
			value={String(block.attrs.src ?? '')}
			oninput={(e) => updateAttr('src', e.currentTarget.value)}
		/></label
	>
{/if}
{#if block.type !== 'customBlock'}
	<label
		>Classes <input
			value={String(block.attrs.class ?? '')}
			oninput={(e) => updateAttr('class', e.currentTarget.value)}
		/></label
	>
{/if}
<button
	class="danger-button"
	style="margin-top: 12px"
	onclick={() => {
		if (block && editor) {
			const n = editor.state.doc.nodeAt(block.pos);
			if (n)
				editor.commands.deleteRange({
					from: block.pos,
					to: block.pos + n.nodeSize
				});
			syncStructure();
		}
	}}>Delete selected</button
>

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
