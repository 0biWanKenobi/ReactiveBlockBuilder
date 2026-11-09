<script lang="ts">
	import type { Editor, JSONContent } from '@tiptap/core';
	import CodeEditor from '#lib/editor/CodeEditor.svelte';
	import ThemeCSS from './themeCSS.svelte';
	import type { ThemeStylesheet } from '#lib/themes/styles';
	import type { CustomBlockLibrary } from '#lib/custom-blocks/library.svelte';
	import { customNodeSync } from '#lib/editor/customNodes';
	import { prepareDocument } from '#lib/custom-blocks/model';
	import { DEFAULT_THEME, type CustomBlockRepository } from '#lib/custom-blocks/repository';
	import { allowedNodeTypes, initialFields, sampleDocument, validateId, type Sheet } from '#lib';
	import type { EditorMode } from '../leftSidebar.svelte';

	let {
		mode,
		editor,
		fields = $bindable(),
		library,
		repository,
		blockCSS,
		activeStylesheet = $bindable('base'),
		onMessage
	}: {
		mode: EditorMode;
		editor: Editor | null;
		fields: Sheet;
		library: CustomBlockLibrary;
		repository: CustomBlockRepository;
		blockCSS: Record<string, string>;
		activeStylesheet: ThemeStylesheet;
		onMessage: (message: string) => void;
	} = $props();

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
		if (!editor) return;
		const saved: SavedSheet = {
			version: 1,
			themeId: DEFAULT_THEME,
			document: editor.getJSON(),
			fields: structuredClone($state.snapshot(fields))
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
		if (!editor) return;
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
			for (const key of Object.keys(fields)) delete fields[key];
			for (const [key, value] of Object.entries(imported.fields)) {
				fields[key] = { id: key, formula: value.formula };
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

<div class="source-panels" class:playing={mode === 'play'} inert={mode === 'play'}>
	<section class="source-panel">
		<div class="source-heading">
			<strong>Sheet JSON</strong>
			<div class="source-actions">
				<button id="apply-sheet-json" onclick={importSheet}>Apply JSON ➡️ Preview</button>
				<button id="sync-sheet-json" onclick={exportSheet}>Sync Preview ➡️ JSON</button>
				<button title="Format JSON" aria-label="Format JSON" onclick={formatJSON}>Format</button>
			</div>
		</div>
		<CodeEditor
			language="json"
			label="Sheet JSON"
			value={jsonSource}
			onChange={(next) => (jsonSource = next)}
		/>
	</section>
	<section class="source-panel">
		<ThemeCSS {repository} {blockCSS} bind:activeStylesheet {onMessage} />
	</section>
</div>

<style>
	.source-panels {
		display: grid;
		flex: 1 1 320px;
		min-height: 0;
		grid-template-columns: 1fr 1fr;
		gap: 15px;
		margin-top: 25px;
		overflow: hidden;
		transition:
			flex-grow 460ms ease,
			flex-basis 460ms ease,
			opacity 200ms ease,
			margin-top 460ms ease,
			visibility 0s linear 460ms;
	}
	.source-panel {
		display: flex;
		flex-direction: column;
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

	.source-panels.playing {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		flex-grow: 0;
		flex-basis: 0px;
		margin-top: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.source-panels {
			transition-duration: 0ms;
		}
	}

	@media (max-width: 1000px) {
		.source-panels {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 620px) {
		.source-panels {
			min-height: 100dvh;
		}
		.source-panels.playing {
			min-height: 0;
		}
	}
</style>
