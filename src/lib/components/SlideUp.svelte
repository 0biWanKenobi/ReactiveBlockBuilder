<script lang="ts">
	import type { Snippet } from 'svelte';

	type SlideUpProps = {
		collapsed: boolean;
		expandedHeight: number;
		children?: Snippet;
	};

	let { collapsed = $bindable(true), expandedHeight, children }: SlideUpProps = $props();
</script>

<div class="slide-up" class:collapsed style:height={'min(60dvh,' + expandedHeight + 'px)'}>
	<div class="header">
		<button aria-label="Close" title="Close" onclick={() => (collapsed = true)}>✖</button>
	</div>
	{@render children?.()}
</div>

<style>
	.header {
		display: flex;
		flex-shrink: 0;
		justify-content: right;
		padding: 5px;
	}

	.slide-up {
		display: flex;
		flex-direction: column;
		position: fixed;
		inset: auto 0 0;
		z-index: 40;
		width: 100%;
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
	.slide-up:is(.collapsed) {
		transform: translateY(100%);
		visibility: hidden;
		pointer-events: none;
		transition-delay: 0s, 360ms;
	}

	@media (prefers-reduced-motion: reduce) {
		.slide-up {
			transition-duration: 0ms;
		}
	}
</style>
