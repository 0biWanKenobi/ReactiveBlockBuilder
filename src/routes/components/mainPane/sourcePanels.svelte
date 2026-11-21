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
	import { getSelectedTab } from '#lib/selectedTab.svelte';
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
	const selectedTab = getSelectedTab();

	type SavedSheet = {
		version: 1;
		document: JSONContent;
		themeId: string;
		fields: Sheet;
	};

	let jsonSource = $state(
		JSON.stringify(
			{
				version: 1,
				themeId: DEFAULT_THEME,
				document: sampleDocument,
				fields: initialFields
			},
			null,
			2
		)
	);
	function formatJSON() {
		try {
			jsonSource = JSON.stringify(JSON.parse(jsonSource), null, 2) + '\n';
			onMessage('JSON formatted');
		} catch (error) {
			onMessage(`Cannot format JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	function exportSheet() {
		const saved: SavedSheet = {
			version: 1,
			themeId: DEFAULT_THEME,
			document: editor.getJSON(),
			fields: structuredClone($state.snapshot(sheet))
		};
		jsonSource = JSON.stringify(saved, null, 2);
		onMessage('Current sheet serialized below');
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

	function importSheet() {
		try {
			const imported: SavedSheet = JSON.parse(jsonSource);
			if (
				imported.version !== 1 ||
				imported.document?.type !== 'doc' ||
				imported.themeId !== DEFAULT_THEME ||
				!imported.fields ||
				typeof imported.fields !== 'object' ||
				Array.isArray(imported.fields)
			) {
				throw new Error('Expected version 1 sheet with document, fields and default themeId');
			}
			validateNode(imported.document);
			const document = prepareDocument(imported.document, library);
			// Fully validate before mutating the existing sheet or its reactive fields.
			for (const [key, value] of Object.entries(imported.fields)) {
				if (validateId(key) || !value || typeof value.formula !== 'string') {
					throw new Error(`Invalid formula field ${key}`);
				}
			}
			// Preserve the reactive proxy: existing formula node views reference it.
			for (const key of Object.keys(sheet)) delete sheet[key];
			for (const [key, value] of Object.entries(imported.fields)) {
				sheet[key] = { id: key, formula: value.formula };
			}
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
</script>

<SlideUp
	bind:collapsed={
		() => selectedTab.value === 'sheet' || mode === 'play',
		(v) => {
			if (v) selectedTab.value = 'sheet';
		}
	}
	expandedHeight={500}
>
	<section class="source-panel">
		{#if selectedTab.value === 'JSON'}
			<div class="source-heading">
				<strong>Sheet Definition</strong>
				<div class="source-actions">
					<button id="apply-sheet-json" onclick={importSheet}>Apply to Preview</button>
					<button id="sync-sheet-json" onclick={exportSheet}>Sync from Preview</button>
					<button title="Format Definition" aria-label="Format Definition" onclick={formatJSON}
						>🪄</button
					>
				</div>
			</div>
			<CodeEditor
				language="json"
				label="Sheet Definition"
				value={jsonSource}
				onChange={(next) => (jsonSource = next)}
			/>
		{:else}
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
		border-radius: 10px;
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
