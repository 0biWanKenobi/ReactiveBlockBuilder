import type { StorageAdapter } from '../storage/StorageAdapter';
import type { CustomBlockDefinition } from './types';
import {
	defaultThemeStylesheets,
	themeStylesheetIds,
	type ThemeStylesheet,
	type ThemeStylesheets
} from '../themes/styles';

export const DEFAULT_THEME = 'default';
const blockPath = (id: string) => `custom-blocks/${id}on`;
const stylePath = (theme: string, id: string) => `themes/${theme}/blocks/${id}.css`;
const basePath = (theme: string) => `themes/${theme}/base.css`;
const themePath = (theme: string, section: ThemeStylesheet) =>
	section === 'base' ? basePath(theme) : `themes/${theme}/stock-blocks/${section}.css`;

export class CustomBlockRepository {
	constructor(private storage: StorageAdapter) {}

	async list(): Promise<CustomBlockDefinition[]> {
		const paths = await this.storage.list('custom-blocks');
		const blocks = await Promise.all(
			paths
				.filter((path) => path.endsWith('on'))
				.map(async (path) => {
					const content = await this.storage.read(path);
					return content ? (JSON.parse(content) as CustomBlockDefinition) : null;
				})
		);
		return blocks.filter((block): block is CustomBlockDefinition => !!block);
	}

	async save(definition: CustomBlockDefinition): Promise<void> {
		await this.storage.write(blockPath(definition.typeId), JSON.stringify(definition, null, 2));
	}

	async delete(typeId: string): Promise<void> {
		await this.storage.delete(blockPath(typeId));
		await this.storage.delete(stylePath(DEFAULT_THEME, typeId));
	}

	async readThemeStylesheets(theme = DEFAULT_THEME): Promise<ThemeStylesheets> {
		const entries = await Promise.all(
			themeStylesheetIds.map(async (section) => {
				const css = await this.storage.read(themePath(theme, section));
				// An explicitly empty stylesheet is a complete replacement too.
				return [section, css ?? defaultThemeStylesheets[section]];
			})
		);
		return Object.fromEntries(entries) as ThemeStylesheets;
	}

	async writeThemeStylesheet(
		section: ThemeStylesheet,
		css: string,
		theme = DEFAULT_THEME
	): Promise<void> {
		await this.storage.write(themePath(theme, section), css);
	}

	async readBlockCSS(typeId: string, theme = DEFAULT_THEME): Promise<string> {
		return (await this.storage.read(stylePath(theme, typeId))) ?? '';
	}

	async writeBlockCSS(typeId: string, css: string, theme = DEFAULT_THEME): Promise<void> {
		await this.storage.write(stylePath(theme, typeId), css);
	}
}
