<script lang="ts">
	import { onMount } from 'svelte';
	import '#lib/editor/blockInteraction.css';
	import { Editor } from '@tiptap/core';
	import { createSheetExtensions, sampleDocument, type Sheet } from '#lib';
	import type { CustomBlockLibrary } from '#lib/custom-blocks/library.svelte.js';
	import type { CustomBlockRepository } from '#lib/custom-blocks/repository.js';
	import { clickOutside } from '#lib/directives/clickOutside.js';
	import { blockBoundary, setBlockDragMode } from '#lib/editor/blockInteraction.js';
	import type { EditorMode } from '../leftSidebar.svelte';
	import SourcePanels from './sourcePanels.svelte';

	let {
		mode,
		editor = $bindable(null),
		fields = $bindable(),
		library,
		repository,
		blockCSS,
		message = $bindable(''),
		onSaveAsCustomBlock
	}: {
		mode: EditorMode;
		editor: Editor | null;
		fields: Sheet;
		library: CustomBlockLibrary;
		repository: CustomBlockRepository;
		blockCSS: Record<string, string>;
		message: string;
		onSaveAsCustomBlock: (position: number) => void;
	} = $props();

	let canvas: HTMLDivElement;
	let designTool = $state<'edit' | 'drag'>('edit');
	let contextPosition = $state<number | null>(null);
	let contextCoords = $state({ x: 0, y: 0 });

	onMount(() => {
		const instance = new Editor({
			element: canvas,
			extensions: createSheetExtensions(fields, { protectCustomBlocks: true }),
			content: sampleDocument,
			editable: true,
			autofocus: false,
			editorProps: {
				attributes: { 'aria-label': 'Character sheet block editor' }
			}
		});
		editor = instance;

		return () => {
			instance.destroy();
			editor = null;
		};
	});

	function contextMenu(event: MouseEvent) {
		if (!editor || mode !== 'design') return;
		const target =
			event.target instanceof Element
				? event.target.closest('section[data-sheet-container]')
				: null;
		if (!target) {
			contextPosition = null;
			return;
		}
		const boundary = blockBoundary(editor.view, target);
		const node = boundary && editor.state.doc.nodeAt(boundary.from);
		if (!boundary || !node?.childCount) return;
		event.preventDefault();
		contextPosition = boundary.from;
		contextCoords = { x: event.clientX, y: event.clientY };
	}

	$effect(() => {
		if (!editor) return;
		setBlockDragMode(editor.view, mode === 'design' && designTool === 'drag');
		editor.setEditable(mode === 'design');
	});

	function selectContainer() {
		if (!editor) return;
		const from = editor.state.selection.$from;
		for (let depth = from.depth; depth > 0; depth--) {
			if (from.node(depth).type.name === 'container') {
				editor.commands.setNodeSelection(from.before(depth));
				return;
			}
		}
		message = 'No parent container at the current cursor';
	}
</script>

<main class="main-pane" class:playing={mode === 'play'}>
	<div class="pane-title" inert={mode === 'play'}>
		<div>
			<strong>Sheet canvas</strong>
			<span
				>{mode === 'play'
					? 'Read-only layout · live formulas and rolls'
					: designTool === 'drag'
						? 'Drag blocks or their handles to move them · text editing is disabled'
						: 'Edit content directly · block dragging disabled'}</span
			>
		</div>
		{#if mode === 'design'}
			<div class="canvas-actions">
				<div class="design-tools" role="group" aria-label="Design tool">
					<button
						class:active={designTool === 'edit'}
						aria-pressed={designTool === 'edit'}
						onclick={() => (designTool = 'edit')}>Edit</button
					>
					<button
						class:active={designTool === 'drag'}
						aria-pressed={designTool === 'drag'}
						onclick={() => (designTool = 'drag')}>Drag</button
					>
				</div>
				<button class="subtle-button" onclick={selectContainer}>Select parent container</button>
			</div>
		{/if}
	</div>
	<div class="sheet-frame" class:playing={mode === 'play'}>
		<div class="sheet-content" role="group" aria-label="Sheet canvas" oncontextmenu={contextMenu}>
			<div bind:this={canvas}></div>
		</div>
	</div>
	{#if message}<div class="status" role="status" inert={mode === 'play'}>{message}</div>{/if}

	<SourcePanels
		{mode}
		{editor}
		bind:fields
		{library}
		{repository}
		{blockCSS}
		onMessage={(next) => (message = next)}
	/>
</main>

{#if contextPosition !== null}
	{@const position = contextPosition}
	<div
		class="context-action"
		use:clickOutside={() => {
			contextPosition = null;
		}}
		style:left={`${contextCoords.x}px`}
		style:top={`${contextCoords.y}px`}
	>
		<button
			onclick={() => {
				onSaveAsCustomBlock(position);
				contextPosition = null;
			}}>Save as custom block</button
		>
	</div>
{/if}

<style>
	button {
		cursor: pointer;
	}
	.context-action {
		position: fixed;
		z-index: 50;
		display: flex;
		gap: 6px;
		padding: 10px;
		background: #fff7e9;
		border: 1px solid #c7ab83;
		border-radius: 8px;
		margin: 8px;
	}
	.context-action button {
		border: 1px solid #d4c7b7;
		border-radius: 6px;
		padding: 7px;
		background: white;
		cursor: pointer;
	}
	.main-pane {
		display: flex;
		flex-direction: column;
		padding: 23px;
		min-width: 0;
		transition: padding 460ms ease;
	}
	.pane-title,
	.sheet-frame,
	.status {
		flex-shrink: 0;
	}
	.pane-title {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-bottom: 15px;
		max-height: 180px;
		overflow: hidden;
		transition:
			opacity 200ms ease,
			max-height 460ms ease,
			margin-bottom 460ms ease,
			visibility 0s linear 460ms;
	}
	.pane-title strong {
		display: block;
		font-size: 0.89rem;
	}
	.pane-title span {
		display: block;
		color: #8e867d;
		font-size: 0.76rem;
		margin-top: 4px;
	}
	.subtle-button {
		border: 1px solid #d4c7b7;
		color: #766149;
		background: #faf7f3;
		border-radius: 8px;
		padding: 9px;
		font-size: 0.72rem;
	}
	.canvas-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.design-tools {
		display: flex;
		gap: 3px;
		padding: 3px;
		border: 1px solid #d4c7b7;
		border-radius: 8px;
		background: #faf7f3;
	}
	.design-tools button {
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: #766149;
		padding: 6px 10px;
		font-size: 0.72rem;
	}
	.design-tools button.active {
		background: #e8d5b7;
		color: #4d3923;
		font-weight: 700;
	}
	.sheet-frame {
		width: 100%;
		background: #fdfaf4;
		border: 1px solid #ded3c5;
		border-radius: 14px;
		box-shadow: 0 10px 30px #332c2410;
		transition: max-width 460ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.sheet-content {
		min-height: 310px;
	}
	/* Keep the canvas gutters inside the editor so they receive drag events. */
	.sheet-content :global(.tiptap) {
		outline: none;
		padding: 28px;
		min-height: 310px;
	}
	.sheet-content :global(.tiptap > *) {
		margin-top: 0;
	}
	.sheet-content :global(.tiptap p) {
		margin: 0;
	}
	/* Keep structural boundaries visible, without :hover styling ancestors.
     The pointer overlay alone marks the single active hover target. */
	.sheet-content :global(.tiptap section) {
		outline: 1px dotted #d9c9b1;
		outline-offset: 2px;
	}
	.playing .sheet-content :global(.tiptap section) {
		outline: none;
	}
	.playing .sheet-content :global(.tiptap [data-rbb-hovered]) {
		outline: none;
	}
	.status {
		font-size: 0.73rem;
		color: #816544;
		margin: 12px 0;
		min-height: 18px;
		max-height: 80px;
		transition:
			max-height 460ms ease,
			min-height 460ms ease,
			margin 460ms ease,
			opacity 200ms ease,
			visibility 0s linear 460ms;
	}

	.main-pane.playing {
		padding: clamp(20px, 4vw, 56px);
	}
	.playing .pane-title,
	.playing .status {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
	.playing .pane-title {
		max-height: 0;
		margin-bottom: 0;
	}
	.playing .status {
		max-height: 0;
		min-height: 0;
		margin: 0;
		overflow: hidden;
	}
	.playing .sheet-frame {
		max-width: 1050px;
		margin-inline: auto;
	}
	.playing .sheet-content :global([data-rbb-selected]),
	.playing .sheet-content :global(.ProseMirror-selectednode) {
		outline: none !important;
	}

	@media (prefers-reduced-motion: reduce) {
		.main-pane,
		.pane-title,
		.sheet-frame {
			transition-duration: 0ms;
		}
	}

	@media (max-width: 620px) {
		.main-pane {
			width: 100%;
		}
		.sheet-content :global(.tiptap) {
			padding: 15px;
		}
	}
</style>
