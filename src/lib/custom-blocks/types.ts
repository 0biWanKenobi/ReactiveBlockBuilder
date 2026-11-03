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

export type PopulatedNode<T = string> = JSONContent & {
	type: T;
	content: [JSONContent, ...JSONContent[]];
};

export type PopulatedDocument = JSONContent & {
	type: 'doc';
	content: [JSONContent, ...JSONContent[]];
};