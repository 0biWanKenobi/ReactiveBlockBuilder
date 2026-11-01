<script lang="ts">
	import { onMount } from 'svelte';
	import CodeEditor from '#lib/editor/CodeEditor.svelte';
	import Dropdown from '#lib/components/Dropdown.svelte';
	import type { CustomBlockRepository } from '#lib/custom-blocks/repository';
	import {
		composeThemeCSS,
		defaultThemeStylesheets,
		stockBlockStyles,
		themeStylesheetIds,
		type ThemeStylesheet,
		type ThemeStylesheets
	} from '#lib/themes/styles';

	let {
		repository,
		blockCSS,
		activeStylesheet = $bindable('base'),
		onMessage
	}: {
		repository: CustomBlockRepository;
		blockCSS: Record<string, string>;
		activeStylesheet: ThemeStylesheet;
		onMessage: (message: string) => void;
	} = $props();

	let drafts = $state<ThemeStylesheets>({ ...defaultThemeStylesheets });
	let saved = $state<ThemeStylesheets>({ ...defaultThemeStylesheets });
	let resetDefaults = $state<ThemeStylesheets>({ ...defaultThemeStylesheets });
	let loading = $state(true);
	let saving = $state(false);
	let styleElement = $state.raw<HTMLStyleElement | null>(null);
	let label = $derived(
		activeStylesheet === 'base' ? 'Shared' : stockBlockStyles[activeStylesheet].label
	);
	let dirty = $derived(drafts[activeStylesheet] !== saved[activeStylesheet]);
	let stylesheetOptions = $derived(
		themeStylesheetIds.map((section) => ({
			value: section,
			label:
				(section === 'base' ? 'Shared' : stockBlockStyles[section].label) +
				(drafts[section] !== saved[section] ? ' *' : '')
		}))
	);
	const btnDisabled = $derived(loading || saving);

	onMount(() => {
		const element = document.createElement('style');
		element.dataset.reactiveBlockBuilder = 'sample';
		document.head.appendChild(element);
		styleElement = element;
		let disposed = false;

		void (async () => {
			try {
				const stored = await repository.readThemeStylesheets();
				const defaults = { ...defaultThemeStylesheets };
				await Promise.all(
					themeStylesheetIds.flatMap((section) => [
						format(stored, section),
						format(defaults, section)
					])
				);
				if (disposed) return;
				drafts = { ...stored };
				saved = { ...stored };
				resetDefaults = defaults;
				loading = false;
			} catch (error) {
				if (!disposed)
					onMessage(
						`Theme loading failed: ${error instanceof Error ? error.message : String(error)}`
					);
			}
		})();

		return () => {
			disposed = true;
			element.remove();
			styleElement = null;
		};
	});

	$effect(() => {
		if (styleElement)
			styleElement.textContent =
				composeThemeCSS(drafts) + '\n' + Object.values(blockCSS).join('\n');
	});

	async function save() {
		const section = activeStylesheet;
		const css = drafts[section];
		saving = true;
		try {
			await repository.writeThemeStylesheet(section, css);
			saved[section] = css;
			onMessage(
				`${section === 'base' ? 'Shared' : stockBlockStyles[section].label} theme CSS saved`
			);
		} catch (error) {
			onMessage(`Theme save failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			saving = false;
		}
	}

	function discard() {
		drafts[activeStylesheet] = saved[activeStylesheet];
		onMessage(`${label} theme CSS discarded`);
	}

	function reset() {
		drafts[activeStylesheet] = resetDefaults[activeStylesheet];
		onMessage(`${label} theme CSS reset to default. Save to keep it.`);
	}

	async function format(
		styles: ThemeStylesheets = drafts,
		section: ThemeStylesheet = activeStylesheet
	) {
		const css = styles[section];
		try {
			const [prettier, postcss] = await Promise.all([
				import('prettier/standalone'),
				import('prettier/plugins/postcss')
			]);
			const formatted = await prettier.format(css, {
				parser: 'css',
				plugins: [postcss],
				tabWidth: 2
			});
			if (styles[section] === css) {
				styles[section] = formatted;
				if (styles === drafts) onMessage('CSS formatted');
			}
		} catch (error) {
			if (styles === drafts)
				onMessage(`Cannot format CSS: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
</script>

<div class="theme-heading">
	<div class="theme-title">
		<strong>Theme CSS</strong>
		<Dropdown
			label="Theme stylesheet"
			bind:value={activeStylesheet}
			options={stylesheetOptions}
			disabled={loading}
		/>
	</div>
	<div class="theme-actions">
		<span>{loading ? 'Loading…' : dirty ? 'Live preview · unsaved' : 'Live preview · saved'}</span>
		<button class="primary" disabled={btnDisabled} onclick={save}>Save</button>
		<button disabled={btnDisabled} onclick={discard}>Discard</button>
		<button disabled={btnDisabled} onclick={reset}>Reset to default</button>
		<button
			title="Format CSS"
			aria-label="Format CSS"
			disabled={btnDisabled}
			onclick={() => format()}>Format</button
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
	<div class="theme-source" inert={loading}>
		<CodeEditor
			language="css"
			label="Theme CSS"
			value={drafts[activeStylesheet]}
			onChange={(next) => (drafts[activeStylesheet] = next)}
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
