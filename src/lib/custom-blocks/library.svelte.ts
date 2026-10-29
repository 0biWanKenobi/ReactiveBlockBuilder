import type { CustomBlockDefinition, BlockLibrary } from './types.js';

export class CustomBlockLibrary implements BlockLibrary {
  definitions = $state<CustomBlockDefinition[]>([]);

  list() { return this.definitions; }
  get(typeId: string) { return this.definitions.find((item) => item.typeId === typeId); }
  replace(definitions: CustomBlockDefinition[]) { this.definitions = definitions; }
  upsert(definition: CustomBlockDefinition) {
    this.definitions = [...this.definitions.filter((item) => item.typeId !== definition.typeId), definition];
  }
  remove(typeId: string) {
    this.definitions = this.definitions.filter((item) => item.typeId !== typeId);
  }
}
