<script lang="ts">
	import { onMount } from 'svelte';
	import type { Editor, JSONContent } from '@tiptap/core';
	import CodeEditor from '#lib/editor/CodeEditor.svelte';
	import type { CustomBlockLibrary } from '#lib/custom-blocks/library.svelte.js';
	import { collapseDocument, expandDocument } from '#lib/custom-blocks/model.js';
	import { DEFAULT_THEME, type CustomBlockRepository } from '#lib/custom-blocks/repository.js';
	import {
		allowedNodeTypes,
		defaultCSS,
		initialFields,
		sampleDocument,
		validateId,
		type Sheet
	} from '#lib';
	import type { EditorMode } from '../leftSidebar.svelte';

	let {
		mode,
		editor,
		fields = $bindable(),
		library,
		repository,
		blockCSS,
		onMessage
	}: {
		mode: EditorMode;
		editor: Editor | null;
		fields: Sheet;
		library: CustomBlockLibrary;
		repository: CustomBlockRepository;
		blockCSS: Record<string, string>;
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
	let css = $state(defaultCSS);
	let savedCSS = $state(defaultCSS);
	let styleElement = $state.raw<HTMLStyleElement | null>(null);

	onMount(() => {
		const element = document.createElement('style');
		element.dataset.reactiveBlockBuilder = 'sample';
		element.textContent = css;
		document.head.appendChild(element);
		styleElement = element;

		void (async () => {
			try {
				const stored = await repository.readBaseCSS();
				if (stored !== null) {
					css = stored;
					savedCSS = stored;
				} else await repository.writeBaseCSS(defaultCSS);
			} catch (error) {
				onMessage(
					`Storage initialization failed: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		})();

		return () => {
			element.remove();
			styleElement = null;
		};
	});

	$effect(() => {
		if (styleElement) styleElement.textContent = css + '\n' + Object.values(blockCSS).join('\n');
	});

	async function saveThemeCSS() {
		await repository.writeBaseCSS(css);
		savedCSS = css;
		onMessage('Theme CSS saved');
	}

	function discardThemeCSS() {
		css = savedCSS;
		onMessage('Theme CSS discarded');
	}

	function formatJSON() {
		try {
			jsonSource = JSON.stringify(JSON.parse(jsonSource), null, 2) + '\n';
			onMessage('JSON formatted');
		} catch (error) {
			onMessage(`Cannot format JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async function formatCSS() {
		try {
			// Lazy-load Prettier only when the format action is requested.
			const [prettier, postcss] = await Promise.all([
				import('prettier/standalone'),
				import('prettier/plugins/postcss')
			]);
			css = await prettier.format(css, {
				parser: 'css',
				plugins: [postcss],
				tabWidth: 2
			});
			onMessage('CSS formatted');
		} catch (error) {
			onMessage(`Cannot format CSS: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	function exportSheet() {
		if (!editor) return;
		const saved: SavedSheet = {
			version: 1,
			themeId: DEFAULT_THEME,
			document: collapseDocument(editor.getJSON(), library),
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
			const expanded = expandDocument(imported.document, library);
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
			editor.chain().setMeta('rbb:definition-reconcile', true).setContent(expanded).run();
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
				<button
					class="format-button"
					title="Format JSON"
					aria-label="Format JSON"
					onclick={formatJSON}>Format</button
				>
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
		<div class="source-heading">
			<strong>Theme CSS</strong>
			<div class="source-actions">
				<span>Live preview · draft</span>
				<button onclick={saveThemeCSS}>Save</button>
				<button onclick={discardThemeCSS}>Discard</button>
				<button class="format-button" title="Format CSS" aria-label="Format CSS" onclick={formatCSS}
					>Format</button
				>
			</div>
		</div>
		<CodeEditor language="css" label="Theme CSS" value={css} onChange={(next) => (css = next)} />
	</section>
</div>

<style>
	button {
		cursor: pointer;
	}
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
	.source-heading span {
		color: #8a806f;
	}
	.source-actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.source-actions button {
		border: 1px solid #d8c7b4;
		border-radius: 5px;
		background: #faf6ef;
		padding: 5px 9px;
		font-size: 0.7rem;
	}
	.source-actions .format-button {
		border-color: transparent;
		background: transparent;
		color: #80776d;
		font-size: 0.67rem;
		padding: 4px 6px;
	}
	.source-actions .format-button:hover {
		border-color: #d8c7b4;
		background: #f7f3ed;
		color: #564433;
	}
	.source-actions .format-button:focus-visible {
		outline: 2px solid #a47a4b;
		outline-offset: 2px;
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
