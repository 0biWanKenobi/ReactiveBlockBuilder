import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type { CustomBlockDefinition } from './types.js';

export const DEFAULT_THEME = 'default';
const blockPath = (id: string) => `custom-blocks/${id}.json`;
const stylePath = (theme: string, id: string) => `themes/${theme}/blocks/${id}.css`;
const basePath = (theme: string) => `themes/${theme}/base.css`;

export class CustomBlockRepository {
  constructor(private storage: StorageAdapter) {}

  async list(): Promise<CustomBlockDefinition[]> {
    const paths = await this.storage.list('custom-blocks');
    const blocks = await Promise.all(paths.filter((path) => path.endsWith('.json'))
      .map(async (path) => {
        const content = await this.storage.read(path);
        return content ? JSON.parse(content) as CustomBlockDefinition : null;
      }));
    return blocks.filter((block): block is CustomBlockDefinition => !!block);
  }

  async save(definition: CustomBlockDefinition): Promise<void> {
    await this.storage.write(blockPath(definition.typeId), JSON.stringify(definition, null, 2));
  }

  async delete(typeId: string): Promise<void> {
    await this.storage.delete(blockPath(typeId));
  }

  async readBaseCSS(theme = DEFAULT_THEME): Promise<string | null> {
    return this.storage.read(basePath(theme));
  }

  async writeBaseCSS(css: string, theme = DEFAULT_THEME): Promise<void> {
    await this.storage.write(basePath(theme), css);
  }

  async readBlockCSS(typeId: string, theme = DEFAULT_THEME): Promise<string> {
    return (await this.storage.read(stylePath(theme, typeId))) ?? '';
  }

  async writeBlockCSS(typeId: string, css: string, theme = DEFAULT_THEME): Promise<void> {
    await this.storage.write(stylePath(theme, typeId), css);
  }
}
