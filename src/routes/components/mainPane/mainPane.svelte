<script lang="ts">
	import { onMount } from 'svelte';
	import '#lib/editor/blockInteraction.css';
	import { Editor } from '@tiptap/core';
	import type { Sheet } from '#lib';
	import type { CustomBlockLibrary } from '#lib/custom-blocks/library.svelte';
	import type { CustomBlockRepository } from '#lib/custom-blocks/repository';
	import { setBlockDragMode } from '#lib/editor/blockInteraction';
	import type { EditorMode } from '../leftSidebar.svelte';
	import SourcePanels from './sourcePanels.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import type { ThemeStylesheet } from '#lib/themes/styles';
	import ContextMenu from './contextMenu.svelte';

	let {
		mode,
		editor,
		fields = $bindable(),
		library,
		repository,
		blockCSS,
		activeStylesheet = $bindable('base'),
		message = $bindable(''),
		onSaveAsCustomBlock,
		onViewProperties
	}: {
		mode: EditorMode;
		editor: Editor;
		fields: Sheet;
		library: CustomBlockLibrary;
		repository: CustomBlockRepository;
		blockCSS: Record<string, string>;
		activeStylesheet: ThemeStylesheet;
		message: string;
		onSaveAsCustomBlock: (position: number) => void;
		onViewProperties: () => void;
	} = $props();

	let canvas: HTMLDivElement;
	let designTool = $state<'edit' | 'drag'>('edit');
	let contextMenu: ReturnType<typeof ContextMenu>;

	onMount(() => {
		editor.mount(canvas);

		return () => {
			editor.destroy();
		};
	});

	$effect(() => {
		setBlockDragMode(editor.view, mode === 'design' && designTool === 'drag');
		editor.setEditable(mode === 'design');
	});

	function selectContainer() {
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
				<Switch values={['edit', 'drag']} labels={['Edit', 'Drag']} bind:active={designTool} />
				<button onclick={selectContainer}>Select parent container</button>
			</div>
		{/if}
	</div>
	<div class="sheet-frame" class:playing={mode === 'play'}>
		<div
			class="sheet-content"
			role="group"
			aria-label="Sheet canvas"
			oncontextmenu={contextMenu.open}
		>
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
		bind:activeStylesheet
		onMessage={(next) => (message = next)}
	/>
</main>

<ContextMenu
	bind:this={contextMenu}
	{editor}
	editorMode={mode}
	{onViewProperties}
	{onSaveAsCustomBlock}
/>

<style>
	.sheet-content :global(.tiptap [data-rbb-context-hovered]) {
		outline: 2px dashed #b48348 !important;
		outline-offset: 2px;
	}
	.main-pane {
		grid-area: 1 / 2;
		display: flex;
		flex-direction: column;
		padding: 23px;
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior-y: contain;
		transition: padding 460ms ease;
	}
	.pane-title,
	.sheet-frame,
	.status {
		flex-shrink: 0;
	}
	.pane-title {
		padding-inline: var(--left-toggle-inset, 0px) var(--right-toggle-inset, 0px);
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-bottom: 15px;
		max-height: 180px;
		overflow: hidden;
		transition:
			padding 460ms ease,
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
	.canvas-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.sheet-frame {
		width: 100%;
		border: 1px solid #ded3c5;
		border-radius: 14px;
		box-shadow: 0 10px 30px #332c2410;
		transition: max-width 460ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.sheet-content {
		min-height: 310px;
	}
	.sheet-content :global(.tiptap) {
		outline: none;
		min-height: 310px;
	}
	/* Keep structural boundaries visible, without :hover styling ancestors.
     The pointer overlay alone marks the single active hover target. */
	.sheet-content :global(.tiptap section) {
		outline: 1px dotted #d9c9b1;
		outline-offset: 2px;
	}
	.playing .sheet-content {
		:global(.tiptap section, .tiptap [data-rbb-hovered]) {
			outline: none;
		}
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
			overflow: visible;
		}
	}
</style>
