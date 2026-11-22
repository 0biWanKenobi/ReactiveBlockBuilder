<script lang="ts">
	import type { NativeProps } from '#lib/types/shared.ts';
	import type { Snippet } from 'svelte';

	type DivProps = Partial<NativeProps<'div'>>;

	type PopoverMenuProps = {
		to: HTMLElement;
		ariaLabel: string;
		positionAnchor: string;
		children: Snippet;
	} & Omit<DivProps, 'class' | 'popover' | 'role' | 'aria-label'>;

	let {
		to = $bindable(),
		positionAnchor,
		ariaLabel,
		children,
		...restProps
	}: PopoverMenuProps = $props();
</script>

<div
	bind:this={to}
	class="popover"
	popover="auto"
	role="menu"
	aria-label={ariaLabel}
	style:position-anchor={positionAnchor}
	{...restProps}
>
	{@render children()}
</div>

<style>
	.popover {
		position: fixed;
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

	.popover :global(hr) {
		margin: 4px;
		border: 0;
		border-top: 1px solid #e8e2db;
	}
</style>
