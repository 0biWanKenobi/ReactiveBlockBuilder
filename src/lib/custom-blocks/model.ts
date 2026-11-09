import type { JSONContent } from '@tiptap/core';
import type { BlockLibrary, CustomBlockDefinition, PopulatedNode } from './types';

const id = () => crypto.randomUUID();
const isCustomNode = (node: JSONContent): boolean => node.attrs?.customNode === true;

/** Stable definition slots are scoped to each custom instance. */
export function ensureNodeIds<T extends JSONContent>(node: T, used = new Set<string>()): T {
	const copy = structuredClone(node);
	const visit = (current: JSONContent, scope: Set<string>) => {
		if (current.type !== 'text' && current.type !== 'doc') {
			current.attrs ??= {};
			const currentId = current.attrs.nodeId;
			if (typeof currentId !== 'string' || !currentId || scope.has(currentId))
				current.attrs.nodeId = id();
			scope.add(current.attrs.nodeId as string);
		}
		const childrenScope = isCustomNode(current) ? new Set<string>() : scope;
		current.content?.forEach((child) => visit(child, childrenScope));
	};
	visit(copy, used);
	return copy;
}

export function resetLeafDefaults(node: JSONContent): JSONContent {
	const copy = structuredClone(node);
	const visit = (current: JSONContent) => {
		if (current.type === 'textBlock') current.content = [{ type: 'text', text: '...' }];
		else if (current.type === 'formula') current.attrs = { ...current.attrs, field: '' };
		else if (current.type === 'image') current.attrs = { ...current.attrs, src: '', alt: '' };
		else current.content?.forEach(visit);
	};
	visit(copy);
	return copy;
}

/** New instances copy definition values; later value edits never replace existing values. */
export function makeInstance(definition: CustomBlockDefinition): PopulatedNode<'container'> {
	const root = structuredClone(definition.structure);
	root.attrs = {
		...root.attrs,
		customNode: true,
		typeId: definition.typeId,
		instanceId: id(),
		nodeId: id()
	};
	return root;
}

/** Index one definition scope, stopping at nested instances. */
function slots(root: JSONContent): Map<string, JSONContent> {
	const result = new Map<string, JSONContent>();
	const visit = (node: JSONContent) => {
		if (node.attrs?.nodeId) result.set(String(node.attrs.nodeId), node);
		if (node.type === 'container' && !isCustomNode(node)) node.content?.forEach(visit);
	};
	root.content?.forEach(visit);
	return result;
}

/** Reconcile validated trees: definitions own structure, instances own surviving values. */
export function prepareDocument<T extends JSONContent>(document: T, library: BlockLibrary): T {
	// Definition snapshots and merged root classes are shared only within this synchronous pass.
	const definitions = new Map<string, PopulatedNode<'container'>>();
	const definitionRoot = (typeId: string): PopulatedNode<'container'> => {
		const cached = definitions.get(typeId);
		if (cached) return cached;
		const definition = library.get(typeId);
		if (!definition) throw new Error(`Missing custom block definition: ${typeId}`);
		const root = copyTree(definition.structure);
		root.attrs = {
			...root.attrs,
			class: [
				...new Set(
					`${root.attrs?.class ?? ''} ${definition.rootClass}`.split(/\s+/).filter(Boolean)
				)
			].join(' ')
		};
		definitions.set(typeId, root);
		return root;
	};
	const visit = (node: JSONContent): JSONContent => {
		if (!isCustomNode(node)) {
			const copy = copyNode(node);
			if (copy.content) copy.content = copy.content.map(visit);
			return copy;
		}
		const typeId = String(node.attrs?.typeId ?? '');
		const templateRoot = definitionRoot(typeId);
		const existing = slots(node);
		const merge = (template: JSONContent): JSONContent => {
			const previous = existing.get(String(template.attrs?.nodeId ?? ''));
			const same =
				previous !== undefined &&
				previous.type === template.type &&
				(!isCustomNode(template) || previous.attrs?.typeId === template.attrs?.typeId);
			if (isCustomNode(template)) return visit(same ? previous : template);
			const result = copyNode(template);
			if (same && template.type === 'textBlock') {
				result.content = (previous.content ?? []).map(copyNode);
			} else if (same && template.type === 'formula') {
				result.attrs = { ...result.attrs, field: previous.attrs?.field };
			} else if (same && template.type === 'image') {
				result.attrs = { ...result.attrs, src: previous.attrs?.src, alt: previous.attrs?.alt };
			} else if (result.content) result.content = result.content.map(merge);
			return result;
		};
		const root = copyNode(templateRoot);
		root.content = root.content.map(merge) as typeof root.content;
		root.attrs = {
			...root.attrs,
			customNode: true,
			typeId,
			instanceId: node.attrs?.instanceId || id(),
			nodeId: node.attrs?.nodeId || id()
		};
		return root;
	};
	return visit(document) as T;
}

/** Stock attributes are scalars; children are copied by the traversal, once per output node. */
function copyNode<T extends JSONContent>(node: T): T {
	return node.attrs ? { ...node, attrs: { ...node.attrs } } : { ...node };
}

/** Read reactive definition proxies once per type, rather than once per instance. */
function copyTree<T extends JSONContent>(node: T): T {
	const copy = copyNode(node);
	if (node.content) copy.content = node.content.map(copyTree);
	return copy;
}

export function createDefinition(
	name: string,
	structure: PopulatedNode<'container'>,
	library: BlockLibrary
): CustomBlockDefinition {
	const stem =
		name
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'custom-block';
	let typeId = stem;
	for (let suffix = 2; library.get(typeId); suffix++) typeId = `${stem}-${suffix}`;
	const root = ensureNodeIds(prepareDocument(structure, library));
	root.attrs = { ...root.attrs, customNode: false, typeId: '', instanceId: '' };
	return { typeId, name, rootClass: '', structure: root };
}

export function validateDefinition(definition: CustomBlockDefinition, library: BlockLibrary): void {
	const visiting = new Set<string>();
	const validated = new Set<string>();
	const visit = (node: JSONContent): void => {
		if (!['container', 'textBlock', 'formula', 'image', 'text'].includes(node.type ?? ''))
			throw new Error('Unsupported node: ' + node.type);
		if (node.attrs?.customNode !== undefined && typeof node.attrs.customNode !== 'boolean') {
			throw new Error('customNode must be a boolean');
		}
		if (isCustomNode(node)) {
			if (node.type !== 'container') throw new Error('Custom nodes require a container root');
			validateType(String(node.attrs?.typeId ?? ''));
			return;
		}
		node.content?.forEach(visit);
	};
	const validateType = (typeId: string): void => {
		if (visiting.has(typeId))
			throw new Error(`Circular custom block reference: ${[...visiting, typeId].join(' → ')}`);
		if (validated.has(typeId)) return;
		const candidate = typeId === definition.typeId ? definition : library.get(typeId);
		if (!candidate) throw new Error(`Missing custom block definition: ${typeId}`);
		if (
			candidate.structure.type !== 'container' ||
			!candidate.structure.content?.length ||
			isCustomNode(candidate.structure)
		)
			throw new Error('Custom blocks require a non-empty stock root container');
		visiting.add(typeId);
		visit(candidate.structure);
		visiting.delete(typeId);
		validated.add(typeId);
	};
	validateType(definition.typeId);
}
