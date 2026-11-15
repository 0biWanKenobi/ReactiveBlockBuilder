<script lang="ts">
	import CodeEditor from '#lib/editor/CodeEditor.svelte';
	import Dropdown from '#lib/components/Dropdown.svelte';
	import type { ThemeStyleStore } from '#lib/themes/store';
	import { stockBlockStyles, themeStylesheetIds, type ThemeStylesheet } from '#lib/themes/styles';

	let {
		themeStyles: theme,
		activeStylesheet = $bindable('base')
	}: {
		themeStyles: ThemeStyleStore;
		activeStylesheet: ThemeStylesheet;
	} = $props();

	let label = $derived(
		activeStylesheet === 'base' ? 'Shared' : stockBlockStyles[activeStylesheet].label
	);
	let dirty = $derived($theme.drafts[activeStylesheet] !== $theme.saved[activeStylesheet]);
	let stylesheetOptions = $derived(
		themeStylesheetIds.map((section) => ({
			value: section,
			label:
				(section === 'base' ? 'Shared' : stockBlockStyles[section].label) +
				($theme.drafts[section] !== $theme.saved[section] ? ' *' : '')
		}))
	);
	const btnDisabled = $derived($theme.loading || $theme.saving);
</script>

<div class="theme-heading">
	<div class="theme-title">
		<strong>Theme</strong>
		<Dropdown
			label="Theme stylesheet"
			bind:value={activeStylesheet}
			options={stylesheetOptions}
			disabled={$theme.loading}
		/>
	</div>
	<div class="theme-actions">
		<span
			>{$theme.loading
				? 'Loading…'
				: dirty
					? 'Live preview · unsaved'
					: 'Live preview · saved'}</span
		>
		<button
			class="primary"
			disabled={btnDisabled}
			onclick={() => theme.save(activeStylesheet)}
			title="Save">💾</button
		>
		<button
			disabled={btnDisabled}
			onclick={() => theme.discard(activeStylesheet)}
			title="Discard Changes">↩️</button
		>
		<button
			disabled={btnDisabled}
			onclick={() => theme.reset(activeStylesheet)}
			title="Reset to Default">🔄</button
		>
		<button
			title="Format CSS"
			aria-label="Format CSS"
			disabled={btnDisabled}
			onclick={() => theme.format(activeStylesheet)}>🪄</button
		>
	</div>
</div>
<div class="theme-target">
	<p>
		{activeStylesheet === 'base'
			? 'Shared sheet appearance and theme-wide overrides.'
			: `Applies to all ${label.toLowerCase()} blocks in this theme. Shared CSS can override these styles.`}
	</p>
</div>
{#key activeStylesheet}
	<div class="theme-source" inert={$theme.loading}>
		<CodeEditor
			language="css"
			label="Theme"
			value={$theme.drafts[activeStylesheet]}
			onChange={(next) => theme.edit(activeStylesheet, next)}
		/>
	</div>
{/key}

<style>
	.theme-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 11px 13px;
		border-bottom: 1px solid #eee9e2;
		font-size: 0.76rem;
	}
	.theme-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;

		button {
			font-size: 0.86rem;
		}
	}
	.theme-title {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.theme-actions span,
	.theme-target p {
		color: #8a806f;
	}
	.theme-target {
		padding: 8px 13px;
		border-bottom: 1px solid #eee9e2;
		font-size: 0.76rem;
	}
	.theme-target p {
		margin: 0;
	}
	.theme-source {
		display: flex;
		flex: 1;
		min-height: 0;
		min-width: 0;
	}
</style>
