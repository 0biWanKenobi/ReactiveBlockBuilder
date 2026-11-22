<script lang="ts">
	import { tick } from 'svelte';
	import { blockBoundary, pointerBlock, setContextBlockHover } from '#lib/editor/blockInteraction';
	import type { Editor } from '@tiptap/core';
	import type { EditorMode } from '../leftSidebar.svelte';
	import PopoverMenu from '#lib/components/popover/PopoverMenu.svelte';
	import PopoverMenuItem from '#lib/components/popover/PopoverMenuItem.svelte';

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
<PopoverMenu
	bind:to={contextPopover}
	ariaLabel="Block actions"
	positionAnchor="--block-context"
	onbeforetoggle={(event) => event.newState === 'closed' && clearSaveTarget()}
>
	<PopoverMenuItem
		label="View properties"
		autofocus
		onclick={(event) => {
			// The opening click must not immediately dismiss the properties pane.
			event.stopPropagation();
			closeMenu();
			onViewProperties();
		}}
	/>
	{#if contextContainer !== null}
		{@const container = contextContainer}
		<hr />
		<PopoverMenuItem
			label="Save as custom block"
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
			}}
		/>
	{/if}
</PopoverMenu>

<style>
	.context-anchor {
		position: fixed;
		anchor-name: --block-context;
		width: 0;
		height: 0;
		pointer-events: none;
	}
</style>
