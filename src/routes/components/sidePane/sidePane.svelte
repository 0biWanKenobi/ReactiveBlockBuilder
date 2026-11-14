<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EditorMode } from '../leftSidebar.svelte';
	import { clickOutside } from '#lib/directives/clickOutside';
	import './style.css';

	let {
		id,
		label,
		side,
		mode,
		collapsed = $bindable(false),
		outsideDismissed = $bindable(false),
		children
	}: {
		id: string;
		label: string;
		side: 'left' | 'right';
		mode: EditorMode;
		collapsed?: boolean;
		outsideDismissed?: boolean;
		children: Snippet;
	} = $props();
</script>

<div
	class="side-pane"
	use:clickOutside={() => {
		if (side === 'right') outsideDismissed = true;
	}}
	class:right={side === 'right'}
	class:collapsed
	class:outside-dismissed={outsideDismissed}
	class:playing={mode === 'play'}
	inert={mode === 'play'}
>
	<div class="pane-wrapper">
		<div class="pane-toolbar">
			<svg class="pane-tab-shape" viewBox="0 0 88 56" fill="none" aria-hidden="true">
				<!-- Offset the button's rounded corner to the stroke centerline:
					 radius = 17px, center = (49.5, 38.5). The 45-degree midpoint
					 lies on the button's corner diagonal, x + y = 88. -->
				<path d="M0 .5H87.5V55.5H49.5A17 17 0 0 1 32.5 38.5V21.5C32.5 .5 16.25 .5 0 .5Z" />
			</svg>
			<button
				type="button"
				class="pane-toggle"
				aria-label={`${collapsed ? 'Show' : 'Hide'} ${label}`}
				title={`${collapsed ? 'Show' : 'Hide'} ${label}`}
				aria-expanded={!collapsed}
				aria-controls={id}
				onclick={() => {
					collapsed = !collapsed;
					outsideDismissed = false;
				}}
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
</div>

<style>
	.pane-wrapper {
		position: sticky;
		top: 0;
		z-index: 5;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: 44px minmax(0, 1fr);
		height: 100%;
		/* The collapsed tab must extend beyond the pane's zero-width column. */
		overflow: visible;
		transition:
			height 460ms ease,
			grid-template-rows 460ms ease;
	}

	.side-pane {
		--pane-tab-width: 88px;
		--pane-tab-height: 56px;
		--pane-hide-delay: 460ms;
		/* Average of the previous 8px side inset and 15px bottom inset. */
		--pane-toggle-inset: 11.5px;
		min-width: 0;
		min-height: 0;
		/* The collapsed tab extends into the canvas without reserving a column. */
		overflow: visible;
		background: #fbfaf8;
		border-right: 1px solid #dedad4;
		transition:
			opacity 240ms ease,
			border-color 460ms ease,
			visibility 0s linear;
	}
	.right {
		border-right: 0;
		border-left: 1px solid #dedad4;
	}
	.pane-toolbar {
		position: relative;
		z-index: 5;
		display: flex;
		align-items: center;
		align-self: start;
		height: 44px;
		padding: 5px;
		background: #fbfaf8;
	}
	.pane-tab-shape {
		display: none;
		position: absolute;
		inset: 0;
		width: var(--pane-tab-width);
		height: var(--pane-tab-height);
		overflow: visible;
		pointer-events: none;
		filter: drop-shadow(0 2px 3px #312d2a08);
	}
	.pane-tab-shape path {
		fill: #fbfaf8;
		stroke: #dedad4;
		stroke-width: 1;
		stroke-linejoin: round;
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
	}
	.pane-content {
		min-width: 0;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior-y: contain;
		opacity: 1;
		/* Fade throughout expansion, after enough width is available to see it. */
		transition: opacity 460ms ease-in;
	}
	.collapsed {
		border-width: 0;
		background: transparent;
	}
	.collapsed .pane-wrapper,
	.playing .pane-wrapper {
		height: 0;
		grid-template-rows: 0px 0fr;
	}
	.collapsed .pane-toolbar {
		width: var(--pane-tab-width);
		height: var(--pane-tab-height);
		padding: 0;
		background: transparent;
		pointer-events: none;
	}
	.right.collapsed .pane-toolbar {
		justify-self: end;
	}
	.collapsed .pane-tab-shape {
		display: block;
	}
	.collapsed:not(.right) .pane-tab-shape {
		transform: scaleX(-1);
	}
	.collapsed .pane-toggle {
		position: absolute;
		top: var(--pane-toggle-inset);
		right: var(--pane-toggle-inset);
		pointer-events: auto;
	}
	.collapsed:not(.right) .pane-toggle {
		left: var(--pane-toggle-inset);
		right: auto;
	}
	.collapsed .pane-content,
	.playing .pane-content {
		transition: opacity 240ms ease-out;
		opacity: 0;
		pointer-events: none;
	}
	.playing {
		transition-delay: 0s, 0s, 0s, var(--pane-hide-delay);
		opacity: 0;
		visibility: hidden;
		border-color: transparent;
		pointer-events: none;
	}
	@media (max-width: 1000px) {
		.right {
			position: fixed;
			inset: auto 0 0;
			z-index: 40;
			width: 100%;
			height: min(60dvh, 520px);
			max-height: none;
			overflow: hidden;
			border-radius: 14px 14px 0 0;
			background: #fbfaf8;
			border-left: 0;
			border-top: 1px solid #dedad4;
			box-shadow: 0 -8px 32px #332c2426;
			transform: translateY(0);
			opacity: 1;
			visibility: visible;
			transition:
				transform 360ms cubic-bezier(0.2, 0.7, 0.2, 1),
				visibility 0s;
		}
		.right:is(.collapsed, .outside-dismissed, .playing) {
			transform: translateY(100%);
			visibility: hidden;
			pointer-events: none;
			transition-delay: 0s, 360ms;
		}
		.right .pane-wrapper {
			position: relative;
			height: 100%;
			grid-template-rows: 44px minmax(0, 1fr);
			transition: none;
		}
		.right .pane-toolbar {
			justify-self: stretch;
			width: auto;
			height: 44px;
			padding: 5px;
			background: #fbfaf8;
			pointer-events: auto;
		}
		.right .pane-tab-shape {
			display: none;
		}
		.right .pane-toggle {
			position: static;
		}
		.right .pane-content {
			opacity: 1;
			transition: none;
		}
		.playing:not(.right) {
			max-height: 0;
			border-width: 0;
		}
		.collapsed {
			border-width: 0;
		}
	}
	@media (max-width: 620px) {
		.pane-wrapper {
			height: 100dvh;
		}
		.side-pane {
			width: 100%;
			flex-shrink: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.side-pane {
			--pane-hide-delay: 0ms;
		}
		.side-pane,
		.pane-wrapper,
		.side-pane .pane-content {
			transition-duration: 0ms;
			transition-delay: 0ms;
		}
	}
</style>
