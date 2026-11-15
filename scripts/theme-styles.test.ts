import { expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { CustomBlockRepository } from '../src/lib/custom-blocks/repository';
import type { StorageAdapter } from '../src/lib/storage/StorageAdapter';
import { composeThemeCSS, defaultThemeStylesheets } from '../src/lib/themes/styles';
import { createThemeStyleStore } from '../src/lib/themes/store';

function memoryStorage(): StorageAdapter {
	const files = new Map<string, string>();
	return {
		read: async (path) => files.get(path) ?? null,
		write: async (path, content) => {
			files.set(path, content);
		},
		delete: async (path) => {
			files.delete(path);
		},
		list: async (directory) => [...files.keys()].filter((path) => path.startsWith(directory + '/'))
	};
}

test('new themes have full defaults for every stock block', async () => {
	const repository = new CustomBlockRepository(memoryStorage());
	expect(await repository.readThemeStylesheets()).toEqual(defaultThemeStylesheets);
});

test('saved block CSS replaces defaults, including deliberately empty CSS', async () => {
	const storage = memoryStorage();
	const repository = new CustomBlockRepository(storage);
	await repository.writeThemeStylesheet('image', '.portrait { border: 0; }');
	await repository.writeThemeStylesheet('formula', '');
	const reloaded = await new CustomBlockRepository(storage).readThemeStylesheets();
	expect(reloaded.image).toBe('.portrait { border: 0; }');
	expect(reloaded.formula).toBe('');
	expect(reloaded.textBlock).toBe(defaultThemeStylesheets.textBlock);
	const css = composeThemeCSS(reloaded);
	expect(css).toContain('.portrait');
	expect(css).not.toContain('.rbb-image');
	expect(css).not.toContain('.rbb-roll');
});

test('theme saves are isolated by section and theme identifier', async () => {
	const repository = new CustomBlockRepository(memoryStorage());
	await repository.writeThemeStylesheet('image', 'default-image');
	await repository.writeThemeStylesheet('image', 'night-image', 'night');
	await repository.writeThemeStylesheet('base', 'night-base', 'night');
	expect((await repository.readThemeStylesheets()).image).toBe('default-image');
	const night = await repository.readThemeStylesheets('night');
	expect(night.image).toBe('night-image');
	expect(night.base).toBe('night-base');
	expect(night.container).toBe(defaultThemeStylesheets.container);
});

test('custom block styles cannot overwrite or delete stock block styles', async () => {
	const repository = new CustomBlockRepository(memoryStorage());
	await repository.writeThemeStylesheet('image', 'stock-image');
	await repository.writeBlockCSS('image', 'custom-image');
	expect(await repository.readBlockCSS('image')).toBe('custom-image');
	expect((await repository.readThemeStylesheets()).image).toBe('stock-image');
	await repository.delete('image');
	expect((await repository.readThemeStylesheets()).image).toBe('stock-image');
});

test('theme drafts and live CSS survive editor subscriptions ending', async () => {
	const repository = new CustomBlockRepository(memoryStorage());
	const theme = createThemeStyleStore(repository, () => {});
	await theme.load();
	const unsubscribe = theme.subscribe(() => {});
	theme.edit('base', '.sheet-content { color: red; }');
	unsubscribe();

	expect(get(theme.appliedCSS)).toContain('.sheet-content { color: red; }');
	expect(get(theme).drafts.base).toBe('.sheet-content { color: red; }');
	expect((await repository.readThemeStylesheets()).base).toBe(defaultThemeStylesheets.base);
	const otherWorkspace = createThemeStyleStore(repository, () => {});
	expect(get(otherWorkspace).drafts.base).toBe(defaultThemeStylesheets.base);
});

test('theme save, discard and reset keep sibling drafts and empty CSS', async () => {
	const repository = new CustomBlockRepository(memoryStorage());
	const theme = createThemeStyleStore(repository, () => {});
	await theme.load();
	theme.edit('image', '');
	theme.edit('base', '.sheet-content { color: red; }');
	await theme.save('image');
	expect((await repository.readThemeStylesheets()).image).toBe('');
	expect((await repository.readThemeStylesheets()).base).toBe(defaultThemeStylesheets.base);
	theme.reset('image');
	expect(get(theme).drafts.image).toContain('.rbb-image');
	theme.discard('image');
	expect(get(theme).drafts.image).toBe('');
	expect(get(theme).drafts.base).toBe('.sheet-content { color: red; }');
	expect(get(theme.appliedCSS)).not.toContain('.rbb-image');
});

test('async theme saves and formatting preserve newer edits', async () => {
	const storage = memoryStorage();
	const write = storage.write;
	let finishWrite!: () => void;
	storage.write = async (path, css) => {
		await new Promise<void>((resolve) => (finishWrite = resolve));
		await write(path, css);
	};
	const theme = createThemeStyleStore(new CustomBlockRepository(storage), () => {});
	await theme.load();
	theme.edit('base', '.first { color: red; }');
	const saving = theme.save('base');
	theme.edit('base', '.second { color: blue; }');
	finishWrite();
	await saving;
	expect(get(theme).saved.base).toBe('.first { color: red; }');
	expect(get(theme).drafts.base).toBe('.second { color: blue; }');
	expect(get(theme).saving).toBe(false);
	const formatting = theme.format('base');
	theme.edit('base', '.third { color: green; }');
	await formatting;
	expect(get(theme).drafts.base).toBe('.third { color: green; }');
});
