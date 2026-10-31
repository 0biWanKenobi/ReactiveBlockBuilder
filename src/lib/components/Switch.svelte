<script lang="ts" generics="T">
	import type { SvelteHTMLElements } from 'svelte/elements';

	type ExtraProps = SvelteHTMLElements['div'];
	type SwitchProps = { values: [T, T]; labels: [string, string]; active: T } & Partial<ExtraProps>;

	let {
		values,
		labels,
		active = $bindable(),
		class: customClass,
		...restProps
	}: SwitchProps = $props();

	const left = $derived(values[0]);
	const right = $derived(values[1]);

	const leftLabel = $derived(labels[0]);
	const rightLabel = $derived(labels[1]);

	const classValue = $derived(customClass ? `switch ${customClass}` : 'switch');
</script>

<div class={classValue} {...restProps} role="group">
	<button
		class:active={active === left}
		aria-pressed={active === left}
		onclick={() => (active = left)}>{leftLabel}</button
	>
	<button
		class:active={active === right}
		aria-pressed={active === right}
		onclick={() => (active = right)}>{rightLabel}</button
	>
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
