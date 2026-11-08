<script lang="ts">
	import { executeRoll, resolve, type Sheet, type RollOutcome } from '../formula/engine';

	let { attrs, fields }: { attrs: { field: string }; fields: Sheet } = $props();
	let evaluated = $derived.by(() => {
		try {
			return { value: resolve(fields, attrs.field), error: '' };
		} catch (error) {
			return { value: null, error: error instanceof Error ? error.message : String(error) };
		}
	});
	let lastRoll = $state<RollOutcome | null>(null);
	let rollError = $state('');

	function roll(exp: string) {
		try {
			lastRoll = executeRoll(exp);
			rollError = '';
		} catch (error) {
			rollError = error instanceof Error ? error.message : String(error);
		}
	}
</script>

<span class="rbb-formula" title={attrs.field}>
	{#if evaluated.error}
		<span class="rbb-formula-error" title={evaluated.error}>⚠ {evaluated.error}</span>
	{:else if evaluated.value?.rollable}
		<button class="rbb-roll" type="button" onclick={() => roll(evaluated.value.expression)}
			>🎲 Roll {attrs.field}</button
		>
		{#if rollError}
			<span class="rbb-formula-error" title={rollError}>⚠ {rollError}</span>
		{/if}
		{#if lastRoll}
			<strong class="rbb-roll-total">{lastRoll.total}</strong>
			<small class="rbb-roll-detail">
				{#each lastRoll.dice as pool, p}
					{#if p > 0}
						·
					{/if}
					[{#each pool.rolls as value, i}{#if i > 0},
						{/if}{#if pool.kept[i]}{value}{:else}<s>{value}</s>{/if}{/each}]
				{/each}
			</small>
		{/if}
	{:else}
		<span>{String(evaluated.value?.value ?? '—')}</span>
	{/if}
</span>
