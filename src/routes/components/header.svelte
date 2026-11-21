<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import type { Tab } from '#lib/types/shared.ts';

	export type EditorMode = 'design' | 'play';
	type HeaderProps = { mode: EditorMode; selectedTab: Tab };

	let { mode = $bindable('design'), selectedTab = $bindable('sheet') }: HeaderProps = $props();
</script>

<header class="topbar">
	<div>
		<h1>Character Sheet Designer</h1>
		<p>Build a sheet with your own style and reactive properties.</p>
	</div>
	<div class="center-header-actions">
		<Switch
			values={['sheet', 'JSON', 'CSS'] satisfies Tab[]}
			labels={['📝 Sheet', '{ } Definition', '🖌️ Style']}
			bind:active={selectedTab}
			aria-label="Tabs"
		/>
		<div>
			<Button title="Save">💾</Button>
			<Button title="Open">📂</Button>
		</div>
	</div>
	<Switch
		values={['design', 'play']}
		labels={['✎ Design', '▶ Play']}
		bind:active={mode}
		aria-label="Editor mode"
	/>
</header>

<style>
	.topbar {
		display: flex;
		flex-shrink: 0;
		justify-content: space-between;
		gap: 20px;
		align-items: center;
		padding: 24px 30px;
		background: #23282c;
		color: #faf8f5;
		p {
			margin: 0;
			font-size: 0.87rem;
			color: #bdbfc0;
		}
	}

	h1 {
		margin: 5px 0 3px;
		font-size: 1.7rem;
	}

	.center-header-actions {
		display: flex;
		flex-direction: row;
		align-items: center;
		flex-wrap: wrap;
		column-gap: 10px;
	}

	@media (max-width: 620px) {
		.topbar {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
