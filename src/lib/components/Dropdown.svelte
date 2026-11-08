<script lang="ts" generics="T extends string">
	let {
		value = $bindable(),
		options,
		label,
		disabled = false,
		fullWidth = false
	}: {
		value: T;
		options: readonly { value: T; label: string }[];
		label: string;
		disabled?: boolean;
		fullWidth?: boolean;
	} = $props();

	const id = $props.id();
	let trigger: HTMLButtonElement;
	let menu: HTMLDivElement;
	let open = $state(false);
	let activeIndex = $state(0);
	let search = '';
	let lastInput = 0;
	let selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? '');

	function close() {
		menu?.hidePopover();
		open = false;
	}

	function show() {
		if (disabled || !options.length) return;
		menu.showPopover({ source: trigger });
	}

	function beforetoggle(event: ToggleEvent) {
		open = event.newState === 'open';
		if (open) {
			activeIndex = Math.max(
				0,
				options.findIndex((option) => option.value === value)
			);
			search = '';
		}
	}

	function choose(index: number) {
		value = options[index].value;
		close();
		trigger.focus({ preventScroll: true });
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Tab') {
			close();
			return;
		}
		if (event.key === 'Escape') {
			if (open) {
				event.preventDefault();
				close();
			}
			return;
		}
		if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
			event.preventDefault();
			if (!open) show();
			else if (event.key === 'ArrowDown') activeIndex = (activeIndex + 1) % options.length;
			else if (event.key === 'ArrowUp')
				activeIndex = (activeIndex + options.length - 1) % options.length;
			if (event.key === 'Home') activeIndex = 0;
			if (event.key === 'End') activeIndex = options.length - 1;
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			if (open) choose(activeIndex);
			else show();
		} else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			if (!open) show();
			const now = Date.now();
			search = (now - lastInput < 700 ? search : '') + event.key.toLowerCase();
			lastInput = now;
			const found = options.findIndex((option) => option.label.toLowerCase().startsWith(search));
			if (found >= 0) activeIndex = found;
		}
	}

	$effect(() => {
		if (disabled) close();
	});
	$effect(() => {
		if (open)
			menu.querySelectorAll('[role="option"]')[activeIndex]?.scrollIntoView({ block: 'nearest' });
	});
</script>

<div class="dropdown" class:full-width={fullWidth}>
	<button
		bind:this={trigger}
		class="trigger"
		type="button"
		role="combobox"
		aria-label={label}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={`${id}-options`}
		aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
		popovertarget={`${id}-options`}
		disabled={disabled || !options.length}
		onkeydown={keydown}
	>
		<span class="value">{selectedLabel}</span>
		<svg class="arrow" aria-hidden="true" viewBox="0 0 16 16">
			<path d="m4 6 4 4 4-4" />
		</svg>
	</button>
	<div
		bind:this={menu}
		id={`${id}-options`}
		class="options"
		popover="auto"
		role="listbox"
		tabindex="-1"
		aria-label={label}
		onbeforetoggle={beforetoggle}
		onpointerdown={(event) => event.preventDefault()}
		onkeydown={keydown}
	>
		{#each options as option, index (option.value)}
			<button
				type="button"
				role="option"
				id={`${id}-option-${index}`}
				aria-selected={value === option.value}
				class:highlighted={activeIndex === index}
				tabindex="-1"
				onpointermove={() => (activeIndex = index)}
				onclick={() => choose(index)}
			>
				<span>{option.label}</span>
				<span class="check" aria-hidden="true">{value === option.value ? '✓' : ''}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.dropdown {
		display: inline-flex;
		min-width: 0;
		anchor-scope: --dropdown-trigger;
	}
	.full-width,
	.full-width .trigger {
		width: 100%;
	}
	.trigger {
		anchor-name: --dropdown-trigger;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		min-width: 0;
		border: 1px solid #d8d2c9;
		border-radius: 6px;
		background: #fff;
		padding: 8px 12px;
		color: #292723;
		font: inherit;
		text-align: left;
	}
	.value {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.arrow {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.trigger:focus-visible,
	.trigger[aria-expanded='true'] {
		outline: 2px solid #987451;
		outline-offset: 2px;
	}
	.trigger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.options {
		position: fixed;
		position-anchor: --dropdown-trigger;
		position-area: block-end span-inline-end;
		position-try-fallbacks:
			flip-block,
			flip-inline,
			flip-block flip-inline;
		position-try-order: most-block-size;
		position-visibility: anchors-visible;
		inset: auto;
		margin-block: 4px;
		margin-inline: 0;
		inline-size: max-content;
		min-inline-size: anchor-size(inline);
		max-inline-size: calc(100dvi - 16px);
		max-block-size: min(280px, calc(100% - 8px));
		box-sizing: border-box;
		overflow: auto;
		padding: 4px;
		border: 1px solid #d8c9b6;
		border-radius: 8px;
		background: #fffdf8;
		color: #4c4034;
		box-shadow: 0 8px 24px #332c2426;
		font: inherit;
		font-size: 0.76rem;
	}
	.options button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.options button[aria-selected='true'] {
		font-weight: 700;
	}
	.options button.highlighted {
		background: #eee1cc;
	}
	.check {
		width: 1em;
		flex-shrink: 0;
		color: #795c36;
	}
</style>
