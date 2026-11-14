<script lang="ts">
	import { tick } from 'svelte';
	import { blockBoundary, pointerBlock, setContextBlockHover } from '#lib/editor/blockInteraction';
	import type { Editor } from '@tiptap/core';
	import type { EditorMode } from '../leftSidebar.svelte';

	type ContextMenuProps = {
		editor: Editor;
		editorMode: EditorMode;
		onViewProperties: () => void;
		onSaveAsCustomBlock: (blockId: number) => void;
	};

	let { editor, editorMode, onViewProperties, onSaveAsCustomBlock }: ContextMenuProps = $props();

	function clearSaveTarget() {
		setContextBlockHover(editor.view, null);
	}

	function markSaveTarget() {
		setContextBlockHover(editor.view, contextContainer);
	}

	function closeMenu() {
		contextPopover?.hidePopover();
	}

	let contextPopover: HTMLDivElement;
	let contextContainer = $state<number | null>(null);
	let contextCoords = $state({ x: 0, y: 0 });

	export function open(event: MouseEvent) {
		if (editorMode !== 'design') return;
		clearSaveTarget();
		const target = pointerBlock(editor.view, event.target);
		const boundary = target && blockBoundary(editor.view, target);
		if (!target || !boundary) {
			closeMenu();
			return;
		}
		event.preventDefault();
		const container = target.closest('section[data-sheet-container]');
		const containerBoundary =
			container && !container.closest('[data-custom-block-type]')
				? blockBoundary(editor.view, container)
				: null;
		contextContainer =
			containerBoundary && editor.state.doc.nodeAt(containerBoundary.from)?.childCount
				? containerBoundary.from
				: null;
		editor.commands.setNodeSelection(boundary.from);
		editor.view.focus();
		contextCoords = { x: event.clientX, y: event.clientY };

		const show = async () => {
			await tick();
			if (editorMode === 'design') contextPopover.showPopover({ source: target });
		};
		// Register before yielding so the opening right-click cannot dismiss the menu.
		if (event.buttons & 2) window.addEventListener('pointerup', show, { once: true });
		else void show();
	}

	$effect(() => {
		if (editorMode === 'play') closeMenu();
	});
</script>

<span
	class="context-anchor"
	style:left={`${contextCoords.x}px`}
	style:top={`${contextCoords.y}px`}
	aria-hidden="true"
></span>
<div
	bind:this={contextPopover}
	class="context-action"
	popover="auto"
	role="menu"
	aria-label="Block actions"
	onbeforetoggle={(event) => event.newState === 'closed' && clearSaveTarget()}
>
	<!-- svelte-ignore a11y_autofocus (Focus the first action when the popover opens.) -->
	<button
		type="button"
		role="menuitem"
		autofocus
		onclick={(event) => {
			// The opening click must not immediately dismiss the properties pane.
			event.stopPropagation();
			closeMenu();
			onViewProperties();
		}}>View properties</button
	>
	{#if contextContainer !== null}
		{@const container = contextContainer}
		<hr />
		<button
			type="button"
			role="menuitem"
			class="save-custom-block"
			onpointerenter={markSaveTarget}
			onfocus={markSaveTarget}
			onpointerleave={(event) => {
				if (!event.currentTarget.matches(':focus-visible')) clearSaveTarget();
			}}
			onblur={(event) => {
				if (!event.currentTarget.matches(':hover')) clearSaveTarget();
			}}
			onclick={() => {
				closeMenu();
				onSaveAsCustomBlock(container);
			}}>Save as custom block</button
		>
	{/if}
</div>

<style>
	.context-anchor {
		position: fixed;
		anchor-name: --block-context;
		width: 0;
		height: 0;
		pointer-events: none;
	}
	.context-action {
		position: fixed;
		position-anchor: --block-context;
		position-area: block-end span-inline-end;
		position-try-fallbacks:
			flip-block,
			flip-inline,
			flip-block flip-inline;
		inset: auto;
		margin: 4px;
		width: 210px;
		max-width: calc(100dvw - 16px);
		padding: 4px;
		background: #fffdf8;
		border: 1px solid #d8c9b6;
		border-radius: 8px;
		box-shadow: 0 8px 24px #332c2426;
		color: #4c4034;
	}
	.context-action button {
		display: block;
		width: 100%;
		padding: 9px 10px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		text-align: left;
		white-space: nowrap;
	}
	.context-action button:hover,
	.context-action button:focus-visible {
		background: #eee1cc;
		outline: none;
	}
	.context-action hr {
		margin: 4px;
		border: 0;
		border-top: 1px solid #e8e2db;
	}
</style>
