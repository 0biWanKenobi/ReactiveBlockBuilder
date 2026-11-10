<script lang="ts">
	import { onMount } from 'svelte';
	import '../editor/blockInteraction.css';
	import { Editor, type JSONContent } from '@tiptap/core';
	import { selectedBlock } from '../editor/selection';
	import { createSheetExtensions } from '../editor/nodes';
	import { startPaletteDrag, endPaletteDrag } from '../editor/blockDragPreview';
	import { customNodeSync } from '../editor/customNodes';
	import { setBlockDragMode } from '../editor/blockInteraction';
	import BlockPalette from '../editor/BlockPalette.svelte';
	import CodeEditor from '../editor/CodeEditor.svelte';
	import { prepareDocument, ensureNodeIds, resetLeafDefaults, validateDefinition } from './model';
	import type { CustomBlockDefinition, BlockLibrary, PopulatedNode, TypedNode } from './types';
	import type { Sheet } from '../formula/engine';
	import Inspector, { type SelectedBlock } from './modal-editor/Inspector.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import type { DialogMode } from './modal-editor/ConfirmDialog.svelte';
	import ConfirmDialog from './modal-editor/ConfirmDialog.svelte';

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
	// true when the user has edited the JSON directly, so we don't overwrite their changes with the editor's state.
	let jsonDraftEdited = $state(false);
	// svelte-ignore state_referenced_locally
	let structure = $state(
		JSON.stringify(prepareDocument($state.snapshot(initial.structure), library), null, 2)
	);
	let tab = $state<'structure' | 'css'>('css');
	let tool = $state<'edit' | 'drag'>('edit');
	let selected = $state<SelectedBlock | null>(null);
	let error = $state('');
	let confirmationMode = $state<DialogMode | null>(null);
	const confirmation = $derived({
		open: confirmationMode !== null,
		mode: confirmationMode as DialogMode,
		action: (mode: DialogMode) => {
			if (mode === 'replaceJSON') syncStructure();
			else if (mode === 'replacePreview') applyJSON();
			else if (mode === 'discardChanges') onClose();
		}
	});
	let canvas = $state<HTMLDivElement>();
	// Editor intentionally captures props once per modal instance.
	// svelte-ignore state_referenced_locally
	const editor = new Editor({
		element: null,
		extensions: createSheetExtensions(fields),
		content: {
			type: 'doc',
			content: [prepareDocument($state.snapshot(initial.structure), library)]
		},
		editorProps: { attributes: { class: 'sheet-document' } },
		onSelectionUpdate: ({ editor }) => synchronizeSelection(editor),
		onTransaction: ({ editor }) => synchronizeSelection(editor),
		onUpdate() {
			// jsonDraftEdited is set to true when the user edits the JSON directly, so we only sync structure if they haven't done that.
			if (!jsonDraftEdited && tab === 'structure') syncStructure();
		}
	});

	let previewStyle: HTMLStyleElement | null = null;
	let initialStructure = '';
	let synchronizedDocument: Editor['state']['doc'] | undefined;

	function synchronizeSelection(instance: Editor) {
		selected = selectedBlock(instance);
	}

	function currentStructure(): PopulatedNode<'container'> {
		const doc = editor.getJSON();
		const root = doc.content?.[0];
		if (!root || root.type !== 'container' || !root.content?.length) {
			throw new Error('Custom blocks require a non-empty root container');
		}
		return ensureNodeIds(root as PopulatedNode<'container'>);
	}

	function syncStructure() {
		// Serialize each document only once, unless replacing an unapplied JSON draft.
		if (editor.state.doc === synchronizedDocument && !jsonDraftEdited) return;
		structure = JSON.stringify(currentStructure(), null, 2);
		synchronizedDocument = editor.state.doc;
		jsonDraftEdited = false;
	}

	function fromPreview() {
		if (jsonDraftEdited) {
			confirmationMode = 'replaceJSON';
		} else syncStructure();
	}

	function requestApplyJSON() {
		if (jsonDraftEdited && synchronizedDocument && !editor.state.doc.eq(synchronizedDocument)) {
			confirmationMode = 'replacePreview';
		} else applyJSON();
	}

	onMount(() => {
		previewStyle = document.createElement('style');
		previewStyle.dataset.customBlockDraft = initial.typeId;
		document.head.appendChild(previewStyle);
		previewStyle.textContent = `@scope (.rbb-definition-preview) {\n${css}\n}`;
		if (canvas) editor.mount(canvas);
		initialStructure = JSON.stringify(currentStructure());
		return () => {
			editor.destroy();
			previewStyle?.remove();
			previewStyle = null;
		};
	});

	$effect(() => {
		// on tab switch, if the user hasn't edited the JSON directly, we want to sync the structure from the editor to the JSON view.
		if (tab == 'structure' && !jsonDraftEdited) {
			syncStructure();
		}
	});

	$effect(() => {
		setBlockDragMode(editor.view, tool === 'drag');
	});

	$effect(() => {
		if (previewStyle) previewStyle.textContent = `@scope (.rbb-definition-preview) {\n${css}\n}`;
	});

	function dragStart(event: DragEvent, block: TypedNode) {
		startPaletteDrag(editor.view, event, ensureNodeIds(prepareDocument(block, library)));
	}

	function applyJSON() {
		try {
			const parsed = ensureNodeIds(JSON.parse(structure) as JSONContent);
			if (parsed.type !== 'container' || !parsed.content?.length)
				throw new Error('Expected a non-empty container');
			validateDefinition(
				{
					...$state.snapshot(initial),
					structure: parsed as PopulatedNode<'container'>
				},
				library
			);
			editor
				?.chain()
				.command(({ tr }) => {
					tr.setMeta(customNodeSync, true);
					return true;
				})
				.setContent(prepareDocument({ type: 'doc', content: [parsed] }, library))
				.run();
			syncStructure();
			error = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function resetValues() {
		try {
			const reset = resetLeafDefaults(currentStructure());
			editor?.commands.setContent({ type: 'doc', content: [reset] });
			syncStructure();
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
		} satisfies CustomBlockDefinition;
	}

	function dirty(): boolean {
		return (
			name !== initial.name ||
			rootClass !== initial.rootClass ||
			css !== starterCSS ||
			jsonDraftEdited ||
			JSON.stringify(currentStructure()) !== initialStructure
		);
	}

	function close() {
		if (!dirty()) onClose();
		else confirmationMode = 'discardChanges';
	}

	function openNested() {
		if (!selected || !selected.attrs.customNode || !onNavigate) return;
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
					onDragEnd={() => endPaletteDrag(editor.view)}
				/>
				{#if selected && editor}
					<Inspector block={selected} {editor} {openNested} />
				{/if}
			</aside>

			<div class="editModeSwitch">
				<Switch values={['edit', 'drag']} labels={['Edit', 'Drag']} bind:active={tool} />
			</div>
			<section class="preview-pane">
				<div class="section-title">Live preview</div>
				<div class="preview sheet-content rbb-definition-preview" bind:this={canvas}></div>
			</section>

			<div class="codeViewSwitch">
				<Switch values={['css', 'structure']} labels={['CSS', 'Structure']} bind:active={tab} />
			</div>

			<div class="code-pane">
				{#if tab === 'structure'}
					<div class="json-actions">
						<strong>Definition JSON</strong>
						<button class="danger-button" onclick={resetValues}>Reset values to defaults</button>
						<button onclick={fromPreview}>From preview</button>
						<button onclick={requestApplyJSON}>Apply JSON</button>
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
			<button onclick={close}>Cancel</button>
			<button class="primary" onclick={save}>Save definition</button>
		</footer>
	</div>
</div>

<ConfirmDialog
	bind:open={() => confirmation.open, (v) => (confirmationMode = v ? confirmation.mode : null)}
	mode={confirmation.mode}
	action={confirmation.action}
/>

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
			min-height: 300px;
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
