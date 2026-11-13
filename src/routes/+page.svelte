<script lang="ts">
	import { onMount } from 'svelte';
	import '../styles/shared.css';
	import CustomBlockEditorModal from '../lib/custom-blocks/CustomBlockEditorModal.svelte';
	import { CustomBlockLibrary } from '../lib/custom-blocks/library.svelte';
	import { CustomBlockRepository } from '../lib/custom-blocks/repository';
	import { LocalStorageAdapter } from '../lib/storage/StorageAdapter';
	import {
		createDefinition,
		makeInstance,
		ensureNodeIds,
		prepareDocument,
		validateDefinition
	} from '../lib/custom-blocks/model';
	import type { CustomBlockDefinition, PopulatedNode } from '../lib/custom-blocks/types';
	import { synchronizeCustomNodes } from '../lib/editor/customNodes';
	import type { Editor, JSONContent } from '@tiptap/core';
	import type { Transaction } from '@tiptap/pm/state';
	import { initialFields } from '../lib/index';
	import type { Sheet } from '../lib/index';
	import LeftSidebar from './components/leftSidebar.svelte';
	import MainPane from './components/mainPane/mainPane.svelte';
	import Inspector from './components/inspector.svelte';
	import SidePane from './components/sidePane/sidePane.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import type { ThemeStylesheet } from '#lib/themes/styles';

	let editor = $state<Editor | null>(null);
	let mode = $state<'design' | 'play'>('design');
	let leftCollapsed = $state(false);
	let rightCollapsed = $state(false);
	let fields = $state<Sheet>(structuredClone(initialFields));
	const library = new CustomBlockLibrary();
	const repository = new CustomBlockRepository(new LocalStorageAdapter());
	let blockCSS = $state<Record<string, string>>({});
	let editedBlock = $state<CustomBlockDefinition | null>(null);
	let editedCSS = $state<string | null>(null);
	let definitionTrail = $state<{ definition: CustomBlockDefinition; css: string }[]>([]);
	let pendingConversion = $state<number | null>(null);
	let pendingOriginal = $state<JSONContent | null>(null);
	let saveBehavior = $state<'ask' | 'replace' | 'keep'>('ask');
	let conversionPrompt = $state<{ pos: number; typeId: string } | null>(null);
	let rememberChoice = $state(false);
	let message = $state('');
	let activeStylesheet = $state<ThemeStylesheet>('base');

	$effect(() => {
		if (!editor) return;
		const current = editor;
		const mapConversion = ({ transaction }: { transaction: Transaction }) => {
			if (pendingConversion !== null && transaction.docChanged) {
				pendingConversion = transaction.mapping.map(pendingConversion);
			}
		};
		current.on('transaction', mapConversion);
		return () => {
			current.off('transaction', mapConversion);
		};
	});

	onMount(() => {
		void (async () => {
			try {
				library.replace(await repository.list());
				await reloadBlockStyles();
			} catch (error) {
				message = `Storage initialization failed: ${error instanceof Error ? error.message : String(error)}`;
			}
		})();
	});

	async function reloadBlockStyles() {
		const styles: Record<string, string> = {};

		const promises = library
			.list()
			.map((def) =>
				repository.readBlockCSS(def.typeId).then((style) => (styles[def.typeId] = style))
			);
		await Promise.all(promises);
		blockCSS = styles;
	}

	function startNewDefinition(pos: number) {
		if (!editor) return;
		const node = editor.state.doc.nodeAt(pos);
		if (!node || node.type.name !== 'container' || !node.childCount) return;
		const structure = ensureNodeIds(node.toJSON() as PopulatedNode<'container'>);
		const name =
			String(structure.attrs?.class ?? '')
				.trim()
				.split(/\s+/)[0] || 'Custom block';
		try {
			definitionTrail = [];
			editedCSS = null;
			editedBlock = createDefinition(name, structure, library);
			pendingOriginal = structure;
			pendingConversion = pos;
		} catch (error) {
			message = `Custom block creation failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	function conversionChoice(replace: boolean) {
		if (!conversionPrompt) return;
		if (rememberChoice) saveBehavior = replace ? 'replace' : 'keep';
		if (replace) replaceOriginal(conversionPrompt.pos, conversionPrompt.typeId);
		conversionPrompt = null;
		pendingOriginal = null;
		rememberChoice = false;
	}

	function replaceOriginal(pos: number, typeId: string) {
		if (!editor) return;
		const definition = library.clone(typeId)!;
		const original = editor.state.doc.nodeAt(pos)!;
		const instance = makeInstance(definition);
		const source = $state.snapshot(pendingOriginal!);
		const replacement = editor.state.schema.nodeFromJSON(
			prepareDocument({ ...source, attrs: { ...instance.attrs } }, library)
		);
		editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + original.nodeSize, replacement));
	}

	async function openNestedDefinition(
		typeId: string,
		current: CustomBlockDefinition,
		draftCSS: string
	) {
		const target = library.get(typeId);
		if (!target) {
			message = `Missing custom block definition: ${typeId}`;
			return;
		}
		definitionTrail = [...definitionTrail, { definition: current, css: draftCSS }];
		editedBlock = target;
		editedCSS = null;
	}

	function closeDefinition() {
		const previous = definitionTrail.at(-1);
		if (previous) {
			definitionTrail = definitionTrail.slice(0, -1);
			editedBlock = previous.definition;
			editedCSS = previous.css;
		} else {
			editedBlock = null;
			editedCSS = null;
			pendingConversion = null;
			pendingOriginal = null;
		}
	}

	async function saveDefinition(definition: CustomBlockDefinition, blockStyle: string) {
		try {
			validateDefinition(definition, library);
			await repository.save(definition);
			await repository.writeBlockCSS(definition.typeId, blockStyle);
			library.upsert(definition);
			// Nested instances in saved definitions follow the same structural rules as sheets.
			for (const entry of library.list()) {
				const current = library.clone(entry.typeId)!;
				const structure = prepareDocument(current.structure, library);
				if (JSON.stringify(structure) === JSON.stringify(current.structure)) continue;
				const synchronized = { ...current, structure };
				await repository.save(synchronized);
				library.upsert(synchronized);
			}
			if (editor) synchronizeCustomNodes(editor, library);
			await reloadBlockStyles();
			if (definitionTrail.length) {
				const previous = definitionTrail.at(-1)!;
				definitionTrail = definitionTrail.slice(0, -1);
				editedBlock = previous.definition;
				editedCSS = previous.css;
			} else {
				editedBlock = null;
				editedCSS = null;
			}
			if (pendingConversion !== null && !definitionTrail.length && !editedBlock) {
				if (saveBehavior === 'ask') {
					conversionPrompt = { pos: pendingConversion, typeId: definition.typeId };
				} else if (saveBehavior === 'replace') {
					replaceOriginal(pendingConversion, definition.typeId);
				}
				pendingConversion = null;
			}
			message = `Saved custom block: ${definition.name}`;
		} catch (error) {
			message = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
</script>

<svelte:head>
	<title>Reactive Block Builder — prototype</title>
	<meta name="description" content="Svelte 5 and Tiptap character sheet WYSIWYG prototype" />
</svelte:head>

<div class="workspace" class:playing={mode === 'play'}>
	<header class="topbar">
		<div>
			<div class="eyebrow">SVELTE 5 × TIPTAP · PROTOTYPE</div>
			<h1>Reactive Block Builder</h1>
			<p>Build a nested character sheet with your own CSS and reactive formulas.</p>
		</div>
		<Switch
			values={['design', 'play']}
			labels={['✎ Design', '▶ Play']}
			bind:active={mode}
			aria-label="Editor mode"
		/>
	</header>

	<div
		class="editor-layout"
		class:left-collapsed={leftCollapsed}
		class:right-collapsed={rightCollapsed}
	>
		<SidePane
			id="block-palette-pane"
			label="block palette"
			side="left"
			{mode}
			bind:collapsed={leftCollapsed}
		>
			<LeftSidebar
				{mode}
				bind:saveBehavior
				{library}
				{editor}
				{repository}
				sheet={fields}
				onDragPaletteBlock={({ success, message: msg }) => {
					if (!success) message = msg;
				}}
				onBlockEdit={(block) => {
					editedCSS = null;
					definitionTrail = [];
					editedBlock = block;
					pendingConversion = null;
				}}
				onBlockDelete={async ({ success, message: msg }) => {
					if (!success) message = msg;
					else await reloadBlockStyles();
				}}
			/>
		</SidePane>

		<MainPane
			{mode}
			bind:editor
			bind:fields
			{library}
			{repository}
			{blockCSS}
			bind:activeStylesheet
			bind:message
			onSaveAsCustomBlock={startNewDefinition}
		/>

		<SidePane
			id="inspector-pane"
			label="inspector"
			side="right"
			{mode}
			bind:collapsed={rightCollapsed}
		>
			<Inspector
				{mode}
				{editor}
				sheet={fields}
				onEditThemeCSS={(type) => (activeStylesheet = type)}
			/>
		</SidePane>
	</div>
</div>

{#if editedBlock}
	{#key editedBlock.typeId}
		<CustomBlockEditorModal
			initial={editedBlock}
			initialCSS={editedCSS ?? blockCSS[editedBlock.typeId] ?? ''}
			{library}
			{fields}
			onSave={saveDefinition}
			onNavigate={openNestedDefinition}
			onClose={closeDefinition}
			breadcrumbs={definitionTrail.map((frame) => frame.definition.name)}
		/>
	{/key}
{/if}
{#if conversionPrompt}
	<div class="confirmation-backdrop">
		<div class="confirmation" role="dialog" aria-modal="true" aria-label="Saved custom block">
			<h2>Custom block saved</h2>
			<p>Replace the original container with an instance of the new custom block?</p>
			<label
				><input type="checkbox" bind:checked={rememberChoice} /> Remember for this session</label
			>
			<div class="confirmation-actions">
				<button onclick={() => conversionChoice(false)}>Keep original</button>
				<button class="primary" onclick={() => conversionChoice(true)}>Replace original</button>
			</div>
		</div>
	</div>
{/if}

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		background: #f2f1ee;
		color: #312d2a;
		font-family:
			Inter,
			system-ui,
			-apple-system,
			sans-serif;
	}
	:global(input),
	:global(textarea) {
		font: inherit;
	}
	.workspace {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	.topbar {
		display: flex;
		justify-content: space-between;
		gap: 20px;
		align-items: center;
		padding: 24px 30px;
		background: #23282c;
		color: #faf8f5;
	}
	.eyebrow {
		color: #c9a274;
		font-size: 0.67rem;
		font-weight: 800;
		letter-spacing: 0.15em;
	}
	h1 {
		margin: 5px 0 3px;
		font-size: 1.7rem;
	}
	.topbar p {
		margin: 0;
		font-size: 0.87rem;
		color: #bdbfc0;
	}
	.editor-layout {
		--left-pane-width: 240px;
		--right-pane-width: 230px;
		display: grid;
		flex: 1;
		grid-template-columns: var(--left-pane-width) minmax(0, 1fr) var(--right-pane-width);
		align-items: stretch;
		min-height: 0;
		transition: grid-template-columns 460ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.confirmation-backdrop {
		position: fixed;
		inset: 0;
		z-index: 120;
		background: #0008;
		display: grid;
		place-items: center;
	}
	.confirmation {
		background: #fffaf3;
		padding: 24px;
		border-radius: 12px;
		width: min(420px, 90vw);
		box-shadow: 0 20px 50px #0004;
	}
	.confirmation h2 {
		font-size: 1.1rem;
	}
	.confirmation label {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 0.85rem;
	}
	.confirmation label input {
		width: auto;
		min-width: 0;
	}
	.confirmation-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 20px;
	}

	/* Keep the live editor and CodeMirror mounted while the workspace recedes. */
	.editor-layout.left-collapsed {
		--left-pane-width: 0px;
		--left-toggle-inset: 48px;
	}
	.editor-layout.right-collapsed {
		--right-pane-width: 0px;
		--right-toggle-inset: 48px;
	}
	.playing .editor-layout {
		--left-pane-width: 0px;
		--right-pane-width: 0px;
	}

	@media (prefers-reduced-motion: reduce) {
		.editor-layout {
			transition-duration: 0ms;
		}
	}

	@media (max-width: 1000px) {
		.editor-layout {
			--left-pane-width: 190px;
			grid-template-columns: var(--left-pane-width) minmax(0, 1fr);
		}
	}
	@media (max-width: 620px) {
		.topbar {
			flex-direction: column;
			align-items: flex-start;
		}
		.editor-layout {
			display: flex;
			flex-direction: column;
		}
	}
</style>
