import { expect, test } from 'bun:test';
import { CustomBlockRepository } from '../src/lib/custom-blocks/repository';
import type { StorageAdapter } from '../src/lib/storage/StorageAdapter';
import { composeThemeCSS, defaultThemeStylesheets } from '../src/lib/themes/styles';

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
