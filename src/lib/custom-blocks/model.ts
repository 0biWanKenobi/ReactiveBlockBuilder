import type { JSONContent } from '@tiptap/core';
import type { BlockLibrary, BlockValues, CustomBlockDefinition, LeafValue } from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(): string {
  return crypto.randomUUID();
}

export function generateTypeId(name: string, existing: string[]): string {
  const stem = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom-block';
  let result = stem;
  for (let suffix = 2; existing.includes(result); suffix++) result = `${stem}-${suffix}`;
  return result;
}

/** Assign identity once. Classes and child positions must never act as identities. */
export function ensureNodeIds(node: JSONContent, used = new Set<string>()): JSONContent {
  const copy = clone(node);
  const visit = (current: JSONContent) => {
    if (current.type !== 'text' && current.type !== 'doc') {
      current.attrs ??= {};
      const currentId = current.attrs.nodeId;
      if (typeof currentId !== 'string' || !currentId || used.has(currentId)) {
        current.attrs.nodeId = id();
      }
      used.add(current.attrs.nodeId as string);
    }
    current.content?.forEach(visit);
  };
  visit(copy);
  return copy;
}

export function resetLeafDefaults(node: JSONContent): JSONContent {
  const copy = clone(node);
  const visit = (current: JSONContent) => {
    switch (current.type) {
      case 'textBlock':
        current.content = [{ type: 'text', text: '...' }];
        break;
      case 'formula':
        current.attrs = { ...current.attrs, field: '' };
        break;
      case 'image':
        current.attrs = { ...current.attrs, src: '', alt: '' };
        break;
      case 'customBlock':
        current.attrs = { ...current.attrs, values: {} };
        break;
    }
    current.content?.forEach(visit);
  };
  visit(copy);
  return copy;
}

function valueOf(node: JSONContent): LeafValue | undefined {
  if (node.type === 'textBlock') return (node.content ?? []).map((part) => part.text ?? '').join('');
  if (node.type === 'formula') return String(node.attrs?.field ?? '');
  if (node.type === 'image') return {
    src: String(node.attrs?.src ?? ''),
    alt: String(node.attrs?.alt ?? '')
  };
}

function applyLeafValue(node: JSONContent, value: LeafValue): JSONContent {
  const copy = clone(node);
  if (copy.type === 'textBlock' && typeof value === 'string') {
    copy.content = value ? [{ type: 'text', text: value }] : [];
  } else if (copy.type === 'formula' && typeof value === 'string') {
    copy.attrs = { ...copy.attrs, field: value };
  } else if (copy.type === 'image' && typeof value === 'object') {
    copy.attrs = { ...copy.attrs, src: value.src, alt: value.alt };
  }
  return copy;
}

function prefixedValues(values: BlockValues, prefix: string): BlockValues {
  const result: BlockValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(prefix + '/')) result[key.slice(prefix.length + 1)] = value;
  }
  return result;
}

function expandInstance(
  compact: JSONContent,
  library: BlockLibrary,
  stack: string[]
): JSONContent {
  const typeId = String(compact.attrs?.typeId ?? '');
  if (stack.includes(typeId)) throw new Error(`Circular custom block reference: ${[...stack, typeId].join(' → ')}`);
  const definition = library.get(typeId);
  if (!definition) throw new Error(`Missing custom block definition: ${typeId}`);
  const values = (compact.attrs?.values ?? {}) as BlockValues;
  const chain = [...stack, typeId];
  const resolve = (node: JSONContent, path: string): JSONContent => {
    const nodeId = String(node.attrs?.nodeId ?? '');
    const key = path && nodeId ? `${path}/${nodeId}` : nodeId;
    if (node.type === 'customBlock') {
      const nested = prefixedValues(values, key);
      return expandInstance({
        ...node,
        attrs: {
          ...node.attrs,
          values: { ...(node.attrs?.values as BlockValues ?? {}), ...nested }
        },
        content: undefined
      }, library, chain);
    }
    const applied = Object.hasOwn(values, key) ? applyLeafValue(node, values[key]) : clone(node);
    if (applied.content) applied.content = applied.content.map((child) => resolve(child, key));
    return applied;
  };
  const root = resolve(definition.structure, '');
  if (definition.rootClass.trim()) {
    const current = String(root.attrs?.class ?? '').split(/\s+/).filter(Boolean);
    for (const cls of definition.rootClass.trim().split(/\s+/)) if (!current.includes(cls)) current.push(cls);
    root.attrs = { ...root.attrs, class: current.join(' ') };
  }
  return {
    type: 'customBlock',
    attrs: {
      typeId, instanceId: compact.attrs?.instanceId ?? id(),
      nodeId: compact.attrs?.nodeId ?? id(), class: compact.attrs?.class ?? ''
    },
    content: [root]
  };
}

export function expandDocument(node: JSONContent, library: BlockLibrary): JSONContent {
  const visit = (current: JSONContent): JSONContent => {
    if (current.type === 'customBlock') return expandInstance(current, library, []);
    return { ...current, content: current.content?.map(visit) };
  };
  return visit(clone(node));
}

function collectOverrides(current: JSONContent, baseline: JSONContent, output: BlockValues, path = '') {
  if (current.type !== baseline.type) return;
  const nodeId = String(current.attrs?.nodeId ?? '');
  const key = nodeId ? (path ? `${path}/${nodeId}` : nodeId) : path;
  const value = valueOf(current);
  const defaultValue = valueOf(baseline);
  if (value !== undefined && JSON.stringify(value) !== JSON.stringify(defaultValue)) {
    output[key] = value;
  }
  const defaults = new Map((baseline.content ?? []).filter((node) => node.attrs?.nodeId)
    .map((node) => [String(node.attrs?.nodeId), node]));
  for (const child of current.content ?? []) {
    const matching = defaults.get(String(child.attrs?.nodeId ?? ''));
    if (matching) collectOverrides(child, matching, output, key);
  }
}

function collapseInstance(node: JSONContent, library: BlockLibrary): JSONContent {
  const typeId = String(node.attrs?.typeId ?? '');
  const baseline = expandInstance({ type: 'customBlock', attrs: { typeId, values: {} } }, library, []);
  const values: BlockValues = {};
  if (node.content?.[0] && baseline.content?.[0]) {
    collectOverrides(node.content[0], baseline.content[0], values);
  }
  return {
    type: 'customBlock',
    attrs: {
      typeId,
      instanceId: node.attrs?.instanceId ?? id(),
      nodeId: node.attrs?.nodeId ?? id(),
      values
    }
  };
}

export function collapseDocument(node: JSONContent, library: BlockLibrary): JSONContent {
  const visit = (current: JSONContent): JSONContent => {
    if (current.type === 'customBlock') return collapseInstance(current, library);
    return { ...current, content: current.content?.map(visit) };
  };
  return visit(clone(node));
}

/** Capture the original instance's leaf values before the user resets definition defaults. */
export function captureInitialValues(template: JSONContent, source: JSONContent): BlockValues {
  const values: BlockValues = {};
  const visit = (reference: JSONContent, actual: JSONContent, prefix = '') => {
    const nodeId = String(reference.attrs?.nodeId ?? '');
    const key = nodeId ? (prefix ? `${prefix}/${nodeId}` : nodeId) : prefix;
    const value = valueOf(actual);
    if (value !== undefined && reference.type === actual.type) values[key] = value;
    for (let i = 0; i < (reference.content?.length ?? 0); i++) {
      const child = reference.content?.[i];
      const corresponding = actual.content?.[i];
      if (child && corresponding) visit(child, corresponding, key);
    }
  };
  visit(template, source);
  return values;
}

export function createDefinition(
  name: string,
  structure: JSONContent,
  library: BlockLibrary
): CustomBlockDefinition {
  if (structure.type !== 'container' || !(structure.content?.length)) {
    throw new Error('A custom block must contain a non-empty root container');
  }
  return {
    typeId: generateTypeId(name, library.list().map((block) => block.typeId)),
    name,
    rootClass: '',
    structure: ensureNodeIds(collapseDocument({ type: 'doc', content: [structure] }, library).content?.[0] ?? structure)
  };
}

export function makeInstance(definition: CustomBlockDefinition): JSONContent {
  return { type: 'customBlock', attrs: { typeId: definition.typeId, instanceId: id(), values: {} } };
}
