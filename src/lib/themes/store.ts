import { derived, get, writable } from 'svelte/store';
import type { CustomBlockRepository } from '../custom-blocks/repository';
import {
	composeThemeCSS,
	defaultThemeStylesheets,
	stockBlockStyles,
	themeStylesheetIds,
	type ThemeStylesheet,
	type ThemeStylesheets
} from './styles';

async function formatCSS(css: string): Promise<string> {
	const [prettier, postcss] = await Promise.all([
		import('prettier/standalone'),
		import('prettier/plugins/postcss')
	]);
	return prettier.format(css, { parser: 'css', plugins: [postcss], tabWidth: 2 });
}

export function createThemeStyleStore(
	repository: CustomBlockRepository,
	onMessage: (message: string) => void
) {
	const state = writable({
		drafts: { ...defaultThemeStylesheets },
		saved: { ...defaultThemeStylesheets },
		resetDefaults: { ...defaultThemeStylesheets },
		loading: true,
		saving: false
	});
	const label = (section: ThemeStylesheet) =>
		section === 'base' ? 'Shared' : stockBlockStyles[section].label;
	const edit = (section: ThemeStylesheet, css: string) => {
		state.update((value) => ({ ...value, drafts: { ...value.drafts, [section]: css } }));
	};

	async function formatStylesheets(styles: ThemeStylesheets): Promise<ThemeStylesheets> {
		const entries = await Promise.all(
			themeStylesheetIds.map(async (section) => {
				let css = styles[section];
				try {
					css = await formatCSS(css);
				} catch {
					// Preserve stored CSS even when the formatter cannot parse it.
				}
				return [section, css];
			})
		);
		return Object.fromEntries(entries) as ThemeStylesheets;
	}

	function mountStyleElement() {
		const element = document.createElement('style');
		element.dataset.reactiveBlockBuilder = 'sample';
		document.head.appendChild(element);
		return element;
	}

	return {
		subscribe: state.subscribe,
		appliedCSS: derived(state, ({ drafts }) => composeThemeCSS(drafts)),
		edit,
		async load() {
			try {
				const stored = await repository.readThemeStylesheets();
				const [drafts, resetDefaults] = await Promise.all([
					formatStylesheets(stored),
					formatStylesheets(defaultThemeStylesheets)
				]);
				state.update((value) => ({
					...value,
					drafts,
					saved: { ...drafts },
					resetDefaults,
					loading: false
				}));
			} catch (error) {
				onMessage(
					`Theme loading failed: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		},
		async save(section: ThemeStylesheet) {
			const css = get(state).drafts[section];
			state.update((value) => ({ ...value, saving: true }));
			try {
				await repository.writeThemeStylesheet(section, css);
				state.update((value) => ({ ...value, saved: { ...value.saved, [section]: css } }));
				onMessage(`${label(section)} theme CSS saved`);
			} catch (error) {
				onMessage(`Theme save failed: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				state.update((value) => ({ ...value, saving: false }));
			}
		},
		discard(section: ThemeStylesheet) {
			edit(section, get(state).saved[section]);
			onMessage(`${label(section)} theme CSS discarded`);
		},
		reset(section: ThemeStylesheet) {
			edit(section, get(state).resetDefaults[section]);
			onMessage(`${label(section)} theme CSS reset to default. Save to keep it.`);
		},
		async format(section: ThemeStylesheet) {
			const css = get(state).drafts[section];
			try {
				const formatted = await formatCSS(css);
				if (get(state).drafts[section] === css) {
					edit(section, formatted);
					onMessage('CSS formatted');
				}
			} catch (error) {
				onMessage(`Cannot format CSS: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
		mountStyleElement
	};
}

export type ThemeStyleStore = ReturnType<typeof createThemeStyleStore>;
