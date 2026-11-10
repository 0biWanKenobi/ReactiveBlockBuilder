<script lang="ts">
	export type DialogButton = {
		text: string;
		primary?: boolean;
		danger?: boolean;
		action?: () => void;
	};

	let {
		open = $bindable(false),
		title,
		message,
		buttons
	}: {
		open?: boolean;
		title: string;
		message: string;
		buttons: readonly DialogButton[];
	} = $props();

	const id = $props.id();
	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function close() {
		dialog?.close();
		open = false;
	}

	function choose(button: DialogButton) {
		close();
		button.action?.();
	}
</script>

<dialog
	bind:this={dialog}
	class="confirmation-dialog"
	aria-labelledby={`${id}-title`}
	aria-describedby={`${id}-message`}
	onclose={() => (open = false)}
	onkeydown={(event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	}}
>
	<div class="dialog-body">
		<div class="dialog-icon" aria-hidden="true">?</div>
		<div class="dialog-copy">
			<h2 id={`${id}-title`}>{title}</h2>
			<p id={`${id}-message`}>{message}</p>
		</div>
	</div>
	<div class="dialog-actions">
		{#each buttons as button, index (index)}
			<button
				type="button"
				class:primary={button.primary}
				class:danger={button.danger}
				onclick={() => choose(button)}>{button.text}</button
			>
		{/each}
	</div>
</dialog>

<style>
	.confirmation-dialog {
		box-sizing: border-box;
		width: min(480px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		margin: auto;
		padding: 0;
		overflow: auto;
		overscroll-behavior: contain;
		border: 1px solid #d8cbbc;
		border-radius: 16px;
		background: #fdfaf5;
		color: #312d2a;
		font-family:
			Inter,
			system-ui,
			-apple-system,
			sans-serif;
		box-shadow:
			0 24px 80px #211a2440,
			0 4px 16px #211a241a;
	}
	.confirmation-dialog[open] {
		animation: appear 160ms ease-out;
	}
	.confirmation-dialog::backdrop {
		background: #1d202970;
		backdrop-filter: blur(3px);
		overscroll-behavior: contain;
	}
	:global(html:has(dialog.confirmation-dialog[open])) {
		scrollbar-gutter: stable;
	}
	:global(body:has(dialog.confirmation-dialog[open])) {
		overflow: hidden;
	}
	.dialog-body {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		padding: 28px 28px 24px;
	}
	.dialog-icon {
		display: grid;
		flex: 0 0 40px;
		place-items: center;
		height: 40px;
		border: 1px solid #e4d1b2;
		border-radius: 12px;
		background: #f3e6cf;
		color: #876535;
		font-size: 1.3rem;
		font-weight: 750;
	}
	.dialog-copy {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	h2 {
		margin: 2px 0 10px;
		font-size: 1.05rem;
		line-height: 1.35;
		font-weight: 750;
	}
	p {
		margin: 0;
		color: #74685c;
		font-size: 0.85rem;
		line-height: 1.65;
		white-space: pre-line;
	}
	.dialog-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 10px;
		padding: 16px 24px;
		border-top: 1px solid #e9dfd2;
		background: #f6f0e6;
	}
	button {
		border: 1px solid #d4c7b7;
		border-radius: 8px;
		background: #fdfaf5;
		color: #5e4e3f;
		padding: 10px 14px;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	button:hover {
		filter: brightness(0.97);
	}
	button:focus-visible {
		outline: 2px solid #987451;
		outline-offset: 3px;
	}
	button.primary {
		border-color: #c9a66f;
		background: #ddbd8c;
		color: #342b20;
		font-weight: 750;
	}
	button.danger {
		border-color: #e5c8c0;
		background: #fff5f3;
		color: #a74335;
	}
	button.primary.danger {
		border-color: #a84335;
		background: #b94c3d;
		color: #fffaf5;
	}
	@keyframes appear {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.confirmation-dialog[open] {
			animation: none;
		}
	}
	@media (max-width: 480px) {
		.dialog-body {
			gap: 12px;
			padding: 22px 20px;
		}
		.dialog-actions {
			padding: 16px 20px;
		}
	}
</style>
