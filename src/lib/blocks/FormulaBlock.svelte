<script lang="ts">
  import { executeRoll, resolve, type Sheet, type RollOutcome } from '../formula/engine.js';

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

  function roll() {
    if (!evaluated.value?.rollable) return;
    try {
      lastRoll = executeRoll(evaluated.value.expression);
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
    <button class="rbb-roll" type="button" onclick={roll}>🎲 Roll {attrs.field}</button>
    {#if lastRoll}
      <strong class="rbb-roll-total">{lastRoll.total}</strong>
      <small class="rbb-roll-detail">
        {#each lastRoll.dice as pool, p}
          {#if p > 0} · {/if}
          [{#each pool.rolls as value, i}{#if i > 0}, {/if}{#if pool.kept[i]}{value}{:else}<s>{value}</s>{/if}{/each}]
        {/each}
      </small>
    {/if}
  {:else}
    <span>{String(evaluated.value?.value ?? '—')}</span>
  {/if}
</span>

<style>
  .rbb-formula { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .rbb-formula-error { color: #bb3434; font-size: .75rem; }
  .rbb-roll { border: 1px solid #bd9e74; border-radius: 6px; padding: 4px 7px; cursor: pointer; background: #fff4df; font-size: .74rem; }
  .rbb-roll-total { color: #655028; }
  .rbb-roll-detail { font-size: .68rem; color: #6f6559; }
</style>
