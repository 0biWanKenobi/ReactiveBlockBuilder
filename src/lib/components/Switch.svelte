<script lang="ts" generics="T, const V extends T[]">
	import type { SvelteHTMLElements } from 'svelte/elements';

	type ExtraProps = SvelteHTMLElements['div'];
	type SwitchProps = {
		values: V;
		labels: { [K in keyof V]: string };
		active: T;
	} & Partial<ExtraProps>;

	let {
		values,
		labels,
		active = $bindable(),
		class: customClass,
		...restProps
	}: SwitchProps = $props();

	const classValue = $derived(customClass ? `switch ${customClass}` : 'switch');
</script>

<div class={classValue} {...restProps} role="group">
	{#each values as value, i (i)}
		<button
			class:active={active === value}
			aria-pressed={active === value}
			onclick={() => (active = value)}>{labels[i]}</button
		>
	{/each}
</div>

<style>
	.switch {
		display: flex;
		gap: 4px;
		padding: 3px;
		border-radius: 9px;
		background: #eae4db;
	}

	.switch > button {
		border-color: transparent;
		background: transparent;
	}

	.switch > button.active {
		background: #ddbd8c;
		color: #242526;
		font-weight: 800;
	}
</style>
