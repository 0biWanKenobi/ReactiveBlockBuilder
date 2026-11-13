<script lang="ts">
	let { label, checked = $bindable(false) }: { label: string; checked?: boolean } = $props();
</script>

<label>
	<span>{label}</span>
	<input type="checkbox" bind:checked />
</label>

<style>
	label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin: 0 0 14px;
		min-height: 26px;
		color: #6d6155;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
	}

	input[type='checkbox'] {
		appearance: none;
		display: grid;
		place-content: center;
		flex: 0 0 18px;
		box-sizing: border-box;
		width: 18px;
		min-width: 18px;
		height: 18px;
		margin: 0;
		padding: 0;
		border: 1px solid #c4ad91;
		border-radius: 4px;
		background: #fdfaf5;
		color: #4c4034;
		cursor: pointer;
	}

	input::before {
		content: '';
		width: 4px;
		height: 8px;
		border: solid currentColor;
		border-width: 0 2px 2px 0;
		transform: translateY(-1px) rotate(45deg);
		visibility: hidden;
	}

	input:checked {
		border-color: #987451;
		background: #ddbd8c;
	}

	input:checked::before {
		visibility: visible;
	}

	input:hover {
		border-color: #987451;
	}

	input:focus-visible {
		outline: 2px solid #987451;
		outline-offset: 2px;
	}
</style>
