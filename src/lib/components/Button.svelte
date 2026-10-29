<script lang="ts" generics="Element extends HtmlTag = 'button'">
	import type { HtmlTag } from '#lib/types/shared.ts';
	import type { Snippet } from 'svelte';
	import type { SvelteHTMLElements } from 'svelte/elements';

	type NativeProps<Tag extends HtmlTag> = SvelteHTMLElements[Tag];

	type ButtonProps = {
		type?: Element;
		to?: HTMLElement;
		onclick?: (event: MouseEvent | KeyboardEvent) => void;
		children?: Snippet;
	} & Partial<NativeProps<Element>>;

	let {
		type = 'button' as Element,
		to = $bindable(),
		onclick,
		children,
		...restProps
	}: ButtonProps = $props();

	const isNonButton = $derived(type !== 'button');

	function handleKeyup(event: KeyboardEvent) {
		if (event.key === ' ') {
			onclick?.(event);
		}
	}
</script>

<svelte:element
	this={type}
	bind:this={to}
	{...restProps}
	{onclick}
	{...isNonButton ? { tabindex: 0, role: 'button', onkeyup: handleKeyup } : {}}
>
	{@render children?.()}
</svelte:element>
