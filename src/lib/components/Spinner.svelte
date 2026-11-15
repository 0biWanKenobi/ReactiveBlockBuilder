<svg class="spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
	<circle cx="12" cy="12" r="9" stroke="#dedad4" stroke-width="3" />
	<path d="M12 3a9 9 0 0 1 9 9" stroke="#8a6541" stroke-width="3" stroke-linecap="round" />
</svg>

<style>
	.spinner {
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		animation: spin 800ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}
</style>
