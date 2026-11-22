<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import PopoverMenu from '#lib/components/popover/PopoverMenu.svelte';
	import PopoverMenuItem from '#lib/components/popover/PopoverMenuItem.svelte';
	import Switch from '#lib/components/Switch.svelte';
	import type { Tab } from '#lib/types/shared.ts';
	import { getViewState } from '#lib/viewState.svelte.ts';

	export type EditorMode = 'design' | 'play';
	type HeaderProps = { mode: EditorMode };

	let { mode = $bindable('design') }: HeaderProps = $props();

	const viewState = getViewState();

	let definitionMenu: HTMLDivElement;
</script>

<header class="topbar">
	<div>
		<h1>Character Sheet Designer</h1>
		<p>Build a sheet with your own style and reactive properties.</p>
	</div>
	<div class="center-header-actions">
		<Switch
			values={['sheet', 'JSON', 'CSS'] satisfies Tab[]}
			labels={['📝 Editor', '{ } Definition', '🖌️ Style']}
			bind:active={
				() => viewState.tab,
				(v) => {
					viewState.tab = v;
					if (v != 'JSON') {
						return;
					}
					definitionMenu.showPopover();
				}
			}
			aria-label="Tabs"
		/>
		<div>
			<Button title="Save">💾</Button>
			<Button title="Open">📂</Button>
		</div>

		<PopoverMenu
			ariaLabel="View Definition Menu"
			positionAnchor="--definition-kind-menu"
			style="top: calc(anchor(bottom) + 12px);"
			bind:to={definitionMenu}
		>
			<PopoverMenuItem
				label="Sheet"
				selected={viewState.json == 'Document'}
				onclick={() => {
					viewState.json = 'Document';
					definitionMenu.hidePopover();
				}}
			/>
			<hr />
			<PopoverMenuItem
				label="Formulas"
				selected={viewState.json == 'Formulas'}
				onclick={() => {
					viewState.json = 'Formulas';
					definitionMenu.hidePopover();
				}}
			/>
		</PopoverMenu>
	</div>
	<Switch
		values={['design', 'play']}
		labels={['✎ Design', '▶ Play']}
		bind:active={mode}
		aria-label="Editor mode"
	/>
</header>

<style>
	.center-header-actions {
		:global(.switch button:nth-child(2)) {
			/** open the sheet JSON or the formulas one*/
			anchor-name: --definition-kind-menu;
		}
	}

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
