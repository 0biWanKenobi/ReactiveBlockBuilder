<script lang="ts">
	import type { JSONContent } from '@tiptap/core';
	import CodeEditor from '#lib/editor/CodeEditor.svelte';
	import ThemeCSS from './themeCSS.svelte';
	import type { ThemeStylesheet } from '#lib/themes/styles';
	import type { CustomBlockLibrary } from '#lib/custom-blocks/library.svelte';
	import { customNodeSync } from '#lib/editor/customNodes';
	import { prepareDocument } from '#lib/custom-blocks/model';
	import { DEFAULT_THEME } from '#lib/custom-blocks/repository';
	import { allowedNodeTypes, initialFields, sampleDocument, validateId, type Sheet } from '#lib';
	import type { EditorMode } from '../leftSidebar.svelte';
	import SlideUp from '#lib/components/SlideUp.svelte';
	import { getViewState } from '#lib/viewState.svelte.ts';
	import type { ThemeStyleStore } from '#lib/themes/store';
	import { editor, sheet } from '#lib/editor/editor.svelte';

	let {
		mode,
		library,
		themeStyles,
		activeStylesheet = $bindable('base'),
		onMessage
	}: {
		mode: EditorMode;
		library: CustomBlockLibrary;
		themeStyles: ThemeStyleStore;
		activeStylesheet: ThemeStylesheet;
		onMessage: (message: string) => void;
	} = $props();
	const viewState = getViewState();

	type SavedSheet = {
		version: 1;
		document: JSONContent;
		themeId: string;
	};

	let jsonSource = $state(
		JSON.stringify(
			{
				version: 1,
				themeId: DEFAULT_THEME,
				document: sampleDocument
			},
			null,
			2
		)
	);

	let formulaSource = $state(JSON.stringify(initialFields, null, 2));

	type EditorProps = typeof editorProps;
	const editorProps = $derived.by(() => {
		switch (viewState.json) {
			case null:
				return null;
			case 'Document':
				return {
					title: 'Sheet Definition',
					value: jsonSource,
					onchange: (v: string) => (jsonSource = v),
					apply: applyDocumentToPreview,
					read: readDocumentFromPreview
				};
			case 'Formulas':
				return {
					title: 'Formula Definitions',
					value: formulaSource,
					onchange: (v: string) => (formulaSource = v),
					apply: applyFormulasToPreview,
					read: readFormulasFromPreview
				};
		}
	});

	function formatJSON(editorProps: NonNullable<EditorProps>) {
		try {
			editorProps.onchange(JSON.stringify(JSON.parse(editorProps.value), null, 2) + '\n');
			onMessage('JSON formatted');
		} catch (error) {
			onMessage(`Cannot format JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	function readDocumentFromPreview() {
		const saved: SavedSheet = {
			version: 1,
			themeId: DEFAULT_THEME,
			document: editor.getJSON()
		};
		jsonSource = JSON.stringify(saved, null, 2);
		onMessage('Current sheet serialized below');
	}

	function readFormulasFromPreview() {
		formulaSource = JSON.stringify(structuredClone($state.snapshot(sheet)), null, 2);
		onMessage('Current formulas serialized below');
	}

	function validateNode(node: JSONContent): void {
		const type = node.type;
		if (!type || !['doc', 'text', ...allowedNodeTypes].includes(type)) {
			throw new Error(`Unsupported node: ${type ?? '(missing)'}`);
		}
		if (type === 'text' && typeof node.text !== 'string') {
			throw new Error('Text node is missing text');
		}
		if (node.attrs?.customNode !== undefined && typeof node.attrs.customNode !== 'boolean') {
			throw new Error('customNode must be a boolean');
		}
		if (node.attrs?.customNode && type !== 'container') {
			throw new Error('Custom nodes require a container root');
		}
		if (node.content !== undefined) {
			if (!Array.isArray(node.content)) throw new Error('Invalid node children');
			for (const child of node.content) validateNode(child);
		}
	}

	/**
	 * Applies the block definitions to the sheet preview
	 */
	function applyDocumentToPreview() {
		try {
			const imported: SavedSheet = JSON.parse(jsonSource);
			if (
				imported.version !== 1 ||
				imported.document?.type !== 'doc' ||
				imported.themeId !== DEFAULT_THEME
			) {
				throw new Error('Expected version 1 sheet with document, fields and default themeId');
			}
			validateNode(imported.document);
			const document = prepareDocument(imported.document, library);
			editor
				.chain()
				.command(({ tr }) => {
					tr.setMeta(customNodeSync, true);
					return true;
				})
				.setContent(document)
				.run();
			onMessage('Sheet loaded');
		} catch (error) {
			onMessage(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Applies the formula definitions to the sheet preview
	 */
	function applyFormulasToPreview() {
		try {
			const imported: Sheet = JSON.parse(formulaSource);
			if (typeof imported !== 'object' || Array.isArray(imported)) {
				throw new Error('Expected version 1 sheet with document, fields and default themeId');
			}

			// Fully validate before mutating the existing sheet or its reactive fields.
			for (const [key, value] of Object.entries(imported)) {
				if (validateId(key) || !value || typeof value.formula !== 'string') {
					throw new Error(`Invalid formula field ${key}`);
				}
			}
			// Preserve the reactive proxy: existing formula node views reference it.
			for (const key of Object.keys(sheet)) delete sheet[key];
			for (const [key, value] of Object.entries(imported)) {
				sheet[key] = { id: key, formula: value.formula };
			}
			onMessage('Formulas loaded');
		} catch (error) {
			onMessage(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const panelsCollaped = $derived(
		viewState.tab === 'sheet' ||
			mode === 'play' ||
			(viewState.json === null && viewState.tab === 'JSON')
	);
</script>

<SlideUp
	bind:collapsed={
		() => panelsCollaped,
		(v) => {
			if (v) viewState.tab = 'sheet';
		}
	}
	expandedHeight={500}
>
	<section class="source-panel">
		{#if viewState.tab === 'JSON' && editorProps}
			<div class="source-heading">
				<strong>{editorProps.title}</strong>
				<div class="source-actions">
					<button id="apply-sheet-json" onclick={editorProps.apply}>Apply to Preview</button>
					<button id="sync-sheet-json" onclick={editorProps.read}>Sync from Preview</button>
					<button
						title="Format Definition"
						aria-label="Format Definition"
						onclick={() => formatJSON(editorProps)}
					>
						🪄
					</button>
				</div>
			</div>
			<CodeEditor
				language="json"
				label="Sheet Definition"
				value={editorProps.value}
				onChange={editorProps.onchange}
			/>
		{:else if viewState.tab == 'CSS'}
			<ThemeCSS {themeStyles} bind:activeStylesheet />
		{/if}
	</section>
</SlideUp>

<style>
	.source-panel {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		min-width: 0;
		background: #fff;
		border: 1px solid #e4ded5;
		overflow: hidden;
	}
	.source-heading {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: space-between;
		padding: 11px 13px;
		border-bottom: 1px solid #eee9e2;
		font-size: 0.76rem;
	}
	.source-actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}
</style>
