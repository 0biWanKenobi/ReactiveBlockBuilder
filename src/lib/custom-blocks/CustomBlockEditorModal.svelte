<script lang="ts">
	import { onMount } from 'svelte';
	import '../editor/blockInteraction.css';
	import { Editor, type JSONContent } from '@tiptap/core';
	import { selectedBlock } from '../editor/selection';
	import { createSheetExtensions } from '../editor/nodes';
	import { startPaletteDrag, endPaletteDrag } from '../editor/blockDragPreview';
	import { setBlockDragMode } from '../editor/blockInteraction';
	import BlockPalette from '../editor/BlockPalette.svelte';
	import CodeEditor from '../editor/CodeEditor.svelte';
	import { collapseDocument, ensureNodeIds, expandDocument, resetLeafDefaults } from './model';
	import type { CustomBlockDefinition, BlockLibrary } from './types';
	import type { Sheet } from '../formula/engine';
	import Button from '#lib/components/Button.svelte';
	import Inspector, { type NestedValue, type SelectedBlock } from './modal-editor/Inspector.svelte';
	import Switch from '#lib/components/Switch.svelte';

	let {
		initial,
		initialCSS,
		library,
		fields,
		onSave,
		onClose,
		onNavigate,
		breadcrumbs = []
	}: {
		initial: CustomBlockDefinition;
		initialCSS: string;
		library: BlockLibrary;
		fields: Sheet;
		onSave: (definition: CustomBlockDefinition, css: string) => void;
		onClose: () => void;
		onNavigate?: (typeId: string, current: CustomBlockDefinition, css: string) => void;
		breadcrumbs?: string[];
	} = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(initial.name);
	// svelte-ignore state_referenced_locally
	let rootClass = $state(initial.rootClass);
	const starterCSS = $derived(
		initialCSS ||
			`/*
  * Fill this with your styles as needed, or leave it empty.
  *
  * .custom-class {
    *
    * }
    */`
	);
	// svelte-ignore state_referenced_locally
	let css = $state(starterCSS);
	let jsonDraftEdited = $state(false);
	// svelte-ignore state_referenced_locally
	let structure = $state(JSON.stringify(initial.structure, null, 2));
	let tab = $state<'structure' | 'css'>('structure');
	let tool = $state<'edit' | 'drag'>('edit');
	let selected = $state<SelectedBlock | null>(null);
	let nestedValues = $state<NestedValue[]>([]);
	let error = $state('');
	let canvas = $state<HTMLDivElement>();
	let editor = $state<Editor>();
	let previewStyle: HTMLStyleElement | null = null;

	function synchronizeSelection(instance: Editor) {
		const found = selectedBlock(instance);
		selected = found;
		nestedValues = [];
		const node = found ? { pos: found.pos, node: instance.state.doc.nodeAt(found.pos) } : null;
		if (node?.node?.type.name === 'customBlock') {
			node.node.descendants((child, offset) => {
				if (!['textBlock', 'formula', 'image'].includes(child.type.name)) return true;
				const type = child.type.name;
				nestedValues.push({
					pos: node.pos + 1 + offset,
					type,
					label: String(child.attrs.class ?? type) || type,
					value:
						type === 'textBlock'
							? child.textContent
							: String(child.attrs[type === 'formula' ? 'field' : 'src'] ?? ''),
					alt: type === 'image' ? String(child.attrs.alt ?? '') : undefined
				});
				return false;
			});
		}
	}

	function currentStructure(): JSONContent {
		if (!editor) throw new Error('Preview is not initialized');
		const doc = collapseDocument(editor.getJSON(), library);
		const root = doc.content?.[0];
		if (!root || root.type !== 'container' || !root.content?.length) {
			throw new Error('Custom blocks require a non-empty root container');
		}
		return ensureNodeIds(root);
	}

	function syncStructure() {
		if (!editor) return;
		structure = JSON.stringify(currentStructure(), null, 2);
		jsonDraftEdited = false;
	}

	onMount(() => {
		previewStyle = document.createElement('style');
		previewStyle.dataset.customBlockDraft = initial.typeId;
		document.head.appendChild(previewStyle);
		previewStyle.textContent = `@scope (.rbb-definition-preview) {\n${css}\n}`;
		editor = new Editor({
			element: canvas,
			extensions: createSheetExtensions(fields),
			content: expandDocument({ type: 'doc', content: [initial.structure] }, library),
			onSelectionUpdate: ({ editor }) => synchronizeSelection(editor),
			onTransaction: ({ editor }) => synchronizeSelection(editor),
			onUpdate: () => {
				if (!jsonDraftEdited) syncStructure();
			}
		});
		return () => {
			editor?.destroy();
			editor = undefined;
			previewStyle?.remove();
			previewStyle = null;
		};
	});

	$effect(() => {
		if (editor) setBlockDragMode(editor.view, tool === 'drag');
	});

	$effect(() => {
		if (previewStyle) previewStyle.textContent = `@scope (.rbb-definition-preview) {\n${css}\n}`;
	});

	function dragStart(event: DragEvent, block: JSONContent) {
		if (!editor) {
			event.preventDefault();
			return;
		}
		const expanded = expandDocument({ type: 'doc', content: [block] }, library).content?.[0];
		if (expanded) startPaletteDrag(editor.view, event, ensureNodeIds(expanded));
	}

	/**
	 * In the definition editor, clicking a nested custom block selects the
	 * component instance rather than one of its implementation nodes.
	 * Parent-specific values are then edited in the inspector.
	 */
	function selectNestedFromPreview(event: MouseEvent | KeyboardEvent) {
		if (!editor || !(event.target instanceof Element)) return;
		const nested = event.target.closest('section[data-custom-block-type]');
		if (!nested || !canvas?.contains(nested)) return;
		const parent = nested.parentNode;
		if (!parent) return;
		const index = Array.prototype.indexOf.call(parent.childNodes, nested);
		if (index < 0) return;
		try {
			const pos = editor.view.posAtDOM(parent, index);
			if (editor.state.doc.nodeAt(pos)?.type.name === 'customBlock') {
				editor.commands.setNodeSelection(pos);
			}
		} catch {
			// Click targets are allowed to disappear during ProseMirror updates.
		}
	}

	function applyJSON() {
		try {
			const parsed = ensureNodeIds(JSON.parse(structure) as JSONContent);
			if (parsed.type !== 'container' || !parsed.content?.length)
				throw new Error('Expected a non-empty container');
			editor?.commands.setContent(expandDocument({ type: 'doc', content: [parsed] }, library));
			syncStructure();
			error = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function resetValues() {
		try {
			const reset = resetLeafDefaults(currentStructure());
			editor?.commands.setContent(expandDocument({ type: 'doc', content: [reset] }, library));
			structure = JSON.stringify(reset, null, 2);
			error = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function currentDraft(): CustomBlockDefinition {
		if (jsonDraftEdited)
			throw new Error('Unapplied JSON changes. Click Apply JSON before continuing.');
		return {
			typeId: initial.typeId,
			name: name.trim() || initial.name,
			rootClass: rootClass.trim(),
			structure: currentStructure()
		};
	}

	function dirty(): boolean {
		return (
			name !== initial.name ||
			rootClass !== initial.rootClass ||
			css !== starterCSS ||
			jsonDraftEdited ||
			JSON.stringify(currentStructure()) !== JSON.stringify(initial.structure)
		);
	}

	function close() {
		if (!dirty() || window.confirm('Discard unsaved changes to this definition?')) onClose();
	}

	function openNested() {
		if (!selected || selected.type !== 'customBlock' || !onNavigate) return;
		try {
			onNavigate(String(selected.attrs.typeId ?? ''), currentDraft(), css);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function save() {
		try {
			const next = currentDraft();
			onSave(next, css);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}
</script>

<div class="overlay" role="presentation">
	<div class="modal" role="dialog" aria-modal="true" aria-label="Custom block definition editor">
		<header>
			<div>
				<strong>Custom block definition</strong>
				<span>{[...breadcrumbs, name].join(' / ')}</span>
			</div>
			<div class="nav-actions">
				{#if breadcrumbs.length}
					<button onclick={close} aria-label="Back to parent definition">← Back</button>
				{/if}
				<button onclick={close} aria-label="Close editor">✕</button>
			</div>
		</header>
		<div class="properties">
			<label>Name <input aria-label="Custom block name" bind:value={name} /></label>
			<label
				>Root CSS class <input
					aria-label="Root CSS class"
					bind:value={rootClass}
					placeholder="Optional class"
				/></label
			>
		</div>

		<div class="contents">
			<aside class="palette-pane">
				<div class="section-title">Blocks</div>
				<BlockPalette
					customBlocks={library.list().filter((item) => item.typeId !== initial.typeId)}
					draggable={true}
					onDragStart={dragStart}
					onDragEnd={() => editor && endPaletteDrag(editor.view)}
				/>
				{#if selected && editor}
					<Inspector block={selected} {editor} {nestedValues} {openNested} {syncStructure} />
				{/if}
			</aside>

			<div class="editModeSwitch">
				<Switch values={['edit', 'drag']} labels={['Edit', 'Drag']} bind:active={tool} />
			</div>
			<section class="preview-pane">
				<div class="section-title">Live preview</div>
				<Button
					type="div"
					class="preview sheet-content rbb-definition-preview"
					bind:to={canvas}
					onclick={selectNestedFromPreview}
				></Button>
			</section>

			<div class="codeViewSwitch">
				<Switch values={['structure', 'css']} labels={['Structure', 'CSS']} bind:active={tab} />
			</div>

			<div class="code-pane">
				{#if tab === 'structure'}
					<div class="json-actions">
						<strong>Definition JSON</strong>
						<button class="danger-button" onclick={resetValues}>Reset values to defaults</button>
						<button onclick={syncStructure}>From preview</button>
						<button onclick={applyJSON}>Apply JSON</button>
					</div>
					<CodeEditor
						language="json"
						label="Custom block structure JSON"
						value={structure}
						onChange={(v) => {
							structure = v;
							jsonDraftEdited = true;
						}}
					/>
				{:else}
					<div class="json-actions"><strong>Custom block CSS</strong></div>
					<CodeEditor
						language="css"
						label="Custom block CSS"
						value={css}
						onChange={(v) => (css = v)}
					/>
				{/if}
			</div>
		</div>

		{#if error}<div role="alert" class="error">{error}</div>{/if}
		<footer>
			<button onclick={close}>Cancel</button><button class="primary" onclick={save}
				>Save definition</button
			>
		</footer>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		background: #1d2029b8;
		padding: 20px;
	}
	.modal {
		display: flex;
		flex-direction: column;
		width: min(1400px, 98vw);
		height: min(860px, 94vh);
		background: #fbfaf8;
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 24px 85px #0007;
		color: #312d2a;
	}

	.contents {
		display: grid;
		grid-template-columns: 215px minmax(0, 1fr) minmax(300px, 0.9fr);
		grid-template-rows: min-content 1fr;
		flex: 1;
		min-height: 0;
		row-gap: 8px;
		padding-top: 8px;
	}

	.palette-pane {
		grid-row: 2;
		grid-column: 1;
		padding: 12px;
		border-right: 1px solid #dedad4;
		overflow: auto;
	}

	.contents :global(.editModeSwitch) {
		grid-row: 1;
		grid-column: 2;
		display: flex;
		justify-content: left;
	}

	.preview-pane {
		grid-row: 2;
		grid-column: 2;
		padding: 18px;
		min-width: 0;
		overflow: auto;
		background: #f3efe8;
		:global(.preview) {
			background: #fdfaf4;
			min-height: 300px;
			padding: 16px;
			border-radius: 10px;
			:global(.tiptap) {
				outline: none;
				min-height: 260px;
			}
		}
	}

	.contents :global(.codeViewSwitch) {
		grid-row: 1;
		grid-column: 3;
		display: flex;
		justify-content: left;
	}

	.code-pane {
		grid-row: 2;
		grid-column: 3;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: white;
	}

	.json-actions {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 8px;
		border-bottom: 1px solid #dedad4;

		& strong {
			margin-right: auto;
			font-size: 0.75rem;
		}
	}

	header,
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 15px 22px;
		border-bottom: 1px solid #dedad4;
	}
	header {
		div {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}
		span {
			color: #8c8177;
			font: 0.73rem monospace;
		}
	}
	.nav-actions {
		display: flex;
		gap: 8px;
	}

	footer {
		justify-content: flex-end;
		gap: 10px;
		border-top: 1px solid #dedad4;
		border-bottom: 0;
	}
	.properties {
		display: flex;
		gap: 15px;
		padding: 12px 22px;
		border-bottom: 1px solid #dedad4;
	}
	label {
		display: grid;
		gap: 5px;
		font-size: 0.73rem;
		font-weight: 700;
	}
	input {
		padding: 7px;
		min-width: 150px;
	}

	.section-title {
		font-size: 0.75rem;
		font-weight: 800;
		margin-bottom: 12px;
	}

	.error {
		color: #a32a25;
		padding: 8px 22px;
	}
	@media (max-width: 900px) {
		.contents {
			grid-template-columns: 180px minmax(0, 1fr);
			grid-template-rows: min-content minmax(0, 1fr) 220px;
			row-gap: 0;
		}
		.contents :global(.editModeSwitch),
		.contents :global(.codeViewSwitch) {
			margin-bottom: 8px;
		}
		.contents :global(.codeViewSwitch) {
			grid-column: 1;
			justify-content: center;
		}
		.code-pane {
			grid-row: 3;
			grid-column: 1/-1;
			min-height: 220px;
		}
	}
</style>
