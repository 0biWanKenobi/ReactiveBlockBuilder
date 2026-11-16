<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { EditorView, basicSetup } from 'codemirror';
	import { json } from '@codemirror/lang-json';
	import { css } from '@codemirror/lang-css';

	let {
		value,
		language,
		label,
		onChange
	}: {
		value: string;
		language: 'json' | 'css';
		label: string;
		onChange: (next: string) => void;
	} = $props();

	let target: HTMLDivElement;
	// svelte-ignore state_referenced_locally
	let currentText = value;
	const view = new EditorView({
		doc: currentText,
		extensions: [
			basicSetup,
			// svelte-ignore state_referenced_locally
			language === 'css' ? css() : json(),
			EditorView.lineWrapping,
			EditorView.theme({
				'&': {
					fontSize: '12px',
					backgroundColor: '#ffffff'
				},
				'.cm-scroller': { overflow: 'auto' },
				'.cm-content': {
					padding: '10px 4px',
					fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
					lineHeight: '1.55'
				},
				'.cm-gutters': {
					backgroundColor: '#fbfaf8',
					borderRight: '1px solid #eee9e2',
					color: '#ac9e90'
				},
				'&.cm-focused': { outline: 'none' }
			}),
			EditorView.updateListener.of((update) => {
				if (update.docChanged && !synchronizing) {
					currentText = update.state.doc.toString();
					onChange(currentText);
				}
			})
		]
	});
	let synchronizing = false;

	onDestroy(() => {
		view.destroy();
	});

	onMount(() => {
		view.contentDOM.setAttribute('aria-label', label);
		target.appendChild(view.dom);
	});

	// Keep programmatic imports, exports and formatting in sync without
	// replacing the editor contents on each keystroke.
	$effect(() => {
		if (currentText !== value) {
			synchronizing = true;
			try {
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: value }
				});
				currentText = value;
			} finally {
				synchronizing = false;
			}
		}
	});
</script>

<div class="code-editor" bind:this={target}></div>

<style>
	/* Let the panel size the editor instead of the document's line count. */
	.code-editor {
		display: flex;
		contain: size;

		&,
		:global(.cm-editor) {
			flex: 1;
			min-width: 0;
			min-height: 0;
		}

		:global(.cm-editor) {
			max-width: 100%;
		}
	}
</style>
