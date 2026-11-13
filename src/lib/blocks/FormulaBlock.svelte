<script lang="ts">
	import { Dialog } from '#lib';
	import { executeRoll, resolve, type Sheet, type RollOutcome } from '../formula/engine';
	type Attrs = { field: string; label: string; showLabel: boolean };

	let { attrs, sheet }: { attrs: Attrs; sheet: Sheet } = $props();
	let evaluated = $derived.by(() => {
		try {
			return { value: resolve(sheet, attrs.field), error: '' };
		} catch (error) {
			return { value: null, error: error instanceof Error ? error.message : String(error) };
		}
	});
	const rollable = $derived(!!evaluated.value?.rollable);
	let lastRoll = $state<RollOutcome | null>(null);
	let rollError = $state('');

	let rollDialogOpen = $state(false);
	function roll() {
		if (!evaluated.value) return;
		try {
			lastRoll = executeRoll(sheet, attrs.field);
			rollError = '';
		} catch (error) {
			rollError = error instanceof Error ? error.message : String(error);
		}
	}
</script>

{#snippet rollResult(outcome: RollOutcome)}
	<strong class="rbb-roll-total">{outcome.total}</strong>
	<small class="rbb-roll-detail">
		{#each outcome.dice as pool, p (p)}
			{#if p > 0}
				·
			{/if}
			[{#each pool.rolls as value, i (i)}
				{#if i > 0},{/if}
				{#if pool.kept[i]}
					{value}
				{:else}
					<s>{value}</s>
				{/if}
			{/each}]
		{/each}
	</small>
	{#if rollError}
		<span class="rbb-formula-error" title={rollError}>⚠ {rollError}</span>
	{/if}
{/snippet}

<span class="rbb-formula" title={attrs.field}>
	{#if attrs.showLabel && attrs.label}<span class="rbb-formula-label">{attrs.label}:</span>{/if}
	{#if evaluated.error}
		<span class="rbb-formula-error" title={evaluated.error}>⚠ {evaluated.error}</span>
	{:else if rollable}
		<button class="rbb-roll" type="button" onclick={() => (rollDialogOpen = true)}>🎲</button>
	{/if}

	<span class="rbb-formula-value">
		{#if rollable && evaluated.value?.expression}
			{evaluated.value.expression}
		{:else}
			{String(evaluated.value?.value ?? '—')}
		{/if}
	</span>
</span>

{#if rollable}
	<Dialog
		bind:open={rollDialogOpen}
		title={'Click to Roll ' + (attrs.showLabel ? attrs.label : attrs.field)}
		buttons={[{ text: '🎲', action: roll, keepOpen: true }, { text: 'Cancel' }]}
	>
		{#if lastRoll}
			{@render rollResult(lastRoll)}
		{/if}
	</Dialog>
{/if}
