<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EditorMode } from './leftSidebar.svelte';

	let {
		id,
		label,
		side,
		mode,
		collapsed = $bindable(false),
		children
	}: {
		id: string;
		label: string;
		side: 'left' | 'right';
		mode: EditorMode;
		collapsed?: boolean;
		children: Snippet;
	} = $props();
</script>

<div
	class="side-pane"
	class:right={side === 'right'}
	class:collapsed
	class:playing={mode === 'play'}
	inert={mode === 'play'}
>
	<div class="pane-toolbar">
		<button
			type="button"
			class="pane-toggle"
			aria-label={`${collapsed ? 'Show' : 'Hide'} ${label}`}
			title={`${collapsed ? 'Show' : 'Hide'} ${label}`}
			aria-expanded={!collapsed}
			aria-controls={id}
			onclick={() => (collapsed = !collapsed)}
		>
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				aria-hidden="true"
			>
				<path d="M4 6h16M4 12h16M4 18h16" />
			</svg>
		</button>
	</div>
	<div {id} class="pane-content" inert={collapsed || mode === 'play'}>
		{@render children()}
	</div>
</div>

<style>
	.side-pane {
		display: grid;
		grid-template-rows: 44px 1fr;
		min-width: 0;
		min-height: 0;
		overflow: clip;
		background: #fbfaf8;
		border-right: 1px solid #dedad4;
		transition:
			grid-template-rows 460ms ease,
			opacity 240ms ease,
			border-color 460ms ease,
			visibility 0s linear 460ms;
	}
	.right {
		border-right: 0;
		border-left: 1px solid #dedad4;
	}
	.pane-toolbar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		align-self: start;
		height: 44px;
		padding: 5px;
		background: #fbfaf8;
	}
	.right .pane-toolbar {
		justify-content: flex-end;
	}
	.pane-toggle {
		display: grid;
		place-items: center;
		width: 33px;
		height: 33px;
		flex-shrink: 0;
		padding: 0;
		border: 1px solid #d8c7b4;
		border-radius: 6px;
		background: #faf6ef;
		color: #5b401e;
		cursor: pointer;
	}
	.pane-toggle:hover {
		background: #f6e7cf;
	}
	.pane-toggle:focus-visible {
		outline: 2px solid #987451;
		outline-offset: 1px;
	}
	.pane-content {
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		transition:
			opacity 240ms ease,
			visibility 0s linear 460ms;
	}
	.collapsed {
		grid-template-rows: 44px 0fr;
	}
	.collapsed .pane-content,
	.playing .pane-content {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
	.playing {
		grid-template-rows: 0px 0fr;
		opacity: 0;
		visibility: hidden;
		border-color: transparent;
		pointer-events: none;
	}
	@media (max-width: 1000px) {
		.right {
			grid-column: 1 / -1;
			border-left: 0;
			border-top: 1px solid #dedad4;
		}
		.playing {
			max-height: 0;
			border-width: 0;
		}
	}
	@media (max-width: 620px) {
		.side-pane {
			width: 100%;
			flex-shrink: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.side-pane,
		.pane-content {
			transition-duration: 0ms;
		}
	}
</style>
