import type { JSONContent } from '@tiptap/core';

export type LeafValue = string | { src: string; alt: string };
export type BlockValues = Record<string, LeafValue>;

export interface CustomBlockDefinition {
  typeId: string;
  name: string;
  rootClass: string;
  structure: JSONContent;
}

export interface BlockLibrary {
  get(typeId: string): CustomBlockDefinition | undefined;
  list(): CustomBlockDefinition[];
}
