<script lang="ts">
	import type { NativeProps } from '#lib/types/shared.ts';

	type ButtonProps = Partial<NativeProps<'button'>>;

	type PopoverMenuItemProps = {
		label: string;
		selected?: boolean;
	} & Omit<ButtonProps, 'type' | 'role'>;

	let { label, selected = false, ...restProps }: PopoverMenuItemProps = $props();
</script>

<button class:selected type="button" role="menuitem" {...restProps}>{label}</button>

<style>
	button {
		display: block;
		width: 100%;
		padding: 9px 10px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		text-align: left;
		white-space: nowrap;
	}
	button.selected,
	button:hover,
	button:focus-visible {
		background: #eee1cc;
		outline: none;
	}
</style>
