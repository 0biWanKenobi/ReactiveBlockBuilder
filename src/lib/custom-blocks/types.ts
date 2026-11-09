import type { JSONContent } from '@tiptap/core';

export interface CustomBlockDefinition {
	typeId: string;
	name: string;
	rootClass: string;
	structure: PopulatedNode<'container'>;
}

export interface BlockLibrary {
	get(typeId: string): CustomBlockDefinition | undefined;
	list(): CustomBlockDefinition[];
}

export type TypedNode<T = string> = JSONContent & {
	type: T;
};

export type PopulatedNode<T = string, N = JSONContent> = TypedNode<T> & {
	content: [N, ...JSONContent[]];
};

export type PopulatedDocument = PopulatedNode<'doc'>;
