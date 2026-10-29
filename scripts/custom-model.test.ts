import { test, expect } from 'bun:test';
import {
  createDefinition, makeInstance, expandDocument, collapseDocument,
  resetLeafDefaults, validateDefinition, captureInitialValues
} from '../src/lib/custom-blocks/model.js';
import type { CustomBlockDefinition } from '../src/lib/custom-blocks/types.js';

function library(...definitions: CustomBlockDefinition[]) {
  return {
    get: (id: string) => definitions.find((definition) => definition.typeId === id),
    list: () => definitions
  };
}

test('compact instances inherit defaults and only persist overrides', () => {
  const registry = library();
  const definition = createDefinition('Score', {
    type: 'container', attrs: { class: 'score' },
    content: [
      { type: 'textBlock', attrs: { class: 'label' }, content: [{ type: 'text', text: 'Strength' }] },
      { type: 'formula', attrs: { class: 'value', field: 'STR' } }
    ]
  }, registry);
  const definitions = library(definition);
  const root = definition.structure.attrs?.nodeId;
  const label = definition.structure.content?.[0].attrs?.nodeId;
  const key = `${root}/${label}`;
  const compact = { type: 'doc', content: [{
    ...makeInstance(definition),
    attrs: { ...makeInstance(definition).attrs, values: { [key]: 'Dexterity' } }
  }] };

  const expanded = expandDocument(compact, definitions);
  const leaf = expanded.content?.[0].content?.[0].content?.[0];
  expect(leaf?.content?.[0].text).toBe('Dexterity');
  const persisted = collapseDocument(expanded, definitions);
  expect(persisted.content?.[0].content).toBeUndefined();
  expect(persisted.content?.[0].attrs?.values).toEqual({ [key]: 'Dexterity' });

  const changedDefinition = {
    ...definition,
    rootClass: 'new-root',
    structure: {
      ...definition.structure,
      content: [
        ...(definition.structure.content ?? []),
        { type: 'image', attrs: { nodeId: 'portrait', src: '', alt: '', class: 'image' } }
      ]
    }
  };
  const refreshed = expandDocument(persisted, library(changedDefinition));
  expect(refreshed.content?.[0].content?.[0].attrs?.class).toContain('new-root');
  expect(refreshed.content?.[0].content?.[0].content?.length).toBe(3);
  expect(refreshed.content?.[0].content?.[0].content?.[0].content?.[0].text).toBe('Dexterity');

  const removedDefinition = {
    ...changedDefinition,
    structure: {
      ...changedDefinition.structure,
      content: changedDefinition.structure.content?.filter((node) => node.attrs?.nodeId !== label)
    }
  };
  const afterRemoval = expandDocument(persisted, library(removedDefinition));
  const cleaned = collapseDocument(afterRemoval, library(removedDefinition));
  expect(cleaned.content?.[0].attrs?.values).toEqual({});
});

test('reset type defaults leaves structure and ids in place', () => {
  const registry = library();
  const definition = createDefinition('Header', {
    type: 'container', attrs: { class: 'header' },
    content: [
      { type: 'textBlock', content: [{ type: 'text', text: 'Arianne' }] },
      { type: 'formula', attrs: { field: 'STR' } },
      { type: 'image', attrs: { src: 'portrait.png', alt: 'Portrait' } }
    ]
  }, registry);
  const reset = resetLeafDefaults(definition.structure);
  expect(reset.attrs?.nodeId).toBe(definition.structure.attrs?.nodeId);
  expect(reset.content?.[0].content?.[0].text).toBe('...');
  expect(reset.content?.[1].attrs?.field).toBe('');
  expect(reset.content?.[2].attrs?.src).toBe('');
});

test('definition validator rejects missing and cyclic dependencies', () => {
  const registry = library();
  const child = createDefinition('Child', {
    type: 'container', content: [{ type: 'textBlock', content: [{ type: 'text', text: 'Child' }] }]
  }, registry);
  const parent = createDefinition('Parent', {
    type: 'container', content: [{ type: 'customBlock', attrs: { typeId: child.typeId, instanceId: 'nested-1' } }]
  }, library(child));
  expect(() => validateDefinition(parent, library(child))).not.toThrow();
  expect(() => validateDefinition(parent, registry)).toThrow(/Missing custom block definition/);
  const recursive = {
    ...child,
    structure: {
      ...child.structure, content: [
        { type: 'customBlock', attrs: { typeId: parent.typeId, instanceId: 'nested-2' } }
      ]
    }
  };
  expect(() => validateDefinition(recursive, library(child, parent))).toThrow(/Circular custom block reference/);
});

test('nested custom block values resolve child, parent and sheet overrides', () => {
  const child = createDefinition('Child', {
    type: 'container', content: [
      { type: 'textBlock', content: [{ type: 'text', text: 'Child default' }] }
    ]
  }, library());
  const childRoot = String(child.structure.attrs?.nodeId);
  const childText = String(child.structure.content?.[0].attrs?.nodeId);
  const nestedKey = `${childRoot}/${childText}`;
  const parent = createDefinition('Parent', {
    type: 'container', content: [{
      type: 'customBlock', attrs: {
        typeId: child.typeId, instanceId: 'inner', values: { [nestedKey]: 'Parent default' }
      }
    }]
  }, library(child));
  const all = library(child, parent);
  const parentRoot = String(parent.structure.attrs?.nodeId);
  const innerId = String(parent.structure.content?.[0].attrs?.nodeId);
  const overrideKey = `${parentRoot}/${innerId}/${nestedKey}`;
  const compact = { type: 'doc', content: [{
    type: 'customBlock', attrs: { typeId: parent.typeId, instanceId: 'outer',
      values: { [overrideKey]: 'Sheet value' }
    }
  }] };
  const expanded = expandDocument(compact, all);
  const sheetText = expanded.content?.[0].content?.[0].content?.[0]
    .content?.[0].content?.[0].content?.[0]?.text;
  expect(sheetText).toBe('Sheet value');
  expect(collapseDocument(expanded, all).content?.[0].attrs?.values)
    .toEqual({ [overrideKey]: 'Sheet value' });
  const inherited = expandDocument({
    type: 'doc', content: [makeInstance(parent)]
  }, all);
  expect(inherited.content?.[0].content?.[0].content?.[0].content?.[0]
    .content?.[0].content?.[0]?.text).toBe('Parent default');
});

test('nested values are captured when converting an expanded container into a definition', () => {
  const child = createDefinition('Nested', {
    type: 'container', content: [{ type: 'textBlock',
      content: [{ type: 'text', text: 'Default' }] }]
  }, library());
  const originals = library(child);
  const source = expandDocument({
    type: 'doc', content: [{
      type: 'container', content: [makeInstance(child)]
    }]
  }, originals).content?.[0];
  if (!source) throw new Error('Missing expanded source');
  const leaf = source.content?.[0].content?.[0].content?.[0];
  if (!leaf) throw new Error('Missing nested leaf');
  leaf.content = [{ type: 'text', text: 'Original instance' }];
  const definition = createDefinition('Wrapper', source, originals);
  const template = expandDocument({ type: 'doc', content: [definition.structure] }, originals).content?.[0];
  if (!template) throw new Error('Missing wrapper template');
  const originalValues = captureInitialValues(template, source);
  const instance = makeInstance(definition);
  instance.attrs = { ...instance.attrs, values: originalValues };
  const restored = expandDocument({ type: 'doc', content: [instance] }, library(child, definition));
  expect(restored.content?.[0].content?.[0].content?.[0].content?.[0]
    .content?.[0].content?.[0]?.text).toBe('Original instance');
});

test('definition evolution retains stable overrides through reorder and prunes removed leaves', () => {
  const base = createDefinition('Evolving', {
    type: 'container', content: [
      { type: 'textBlock', content: [{ type: 'text', text: 'First' }] },
      { type: 'textBlock', content: [{ type: 'text', text: 'Second' }] }
    ]
  }, library());
  const root = String(base.structure.attrs?.nodeId);
  const first = String(base.structure.content?.[0].attrs?.nodeId);
  const second = String(base.structure.content?.[1].attrs?.nodeId);
  const instance = makeInstance(base);
  instance.attrs = { ...instance.attrs, values: { [root + '/' + first]: 'Customized' } };
  const compact = { type: 'doc', content: [instance] };
  const reordered = { ...base, structure: {
    ...base.structure, content: [
      base.structure.content![1], base.structure.content![0],
      { type: 'textBlock', attrs: { nodeId: 'added' }, content: [{ type: 'text', text: 'New' }] }
    ]
  } };
  const edited = expandDocument(compact, library(reordered));
  const children = edited.content![0].content![0].content!;
  expect(children.map(c => c.content?.[0]?.text)).toEqual(['Second', 'Customized', 'New']);
  expect(collapseDocument(edited, library(reordered)).content![0].attrs?.values)
    .toEqual({ [root + '/' + first]: 'Customized' });
  const deleted = { ...reordered, structure: { ...reordered.structure,
    content: reordered.structure.content!.filter(c => c.attrs?.nodeId !== first)
  } };
  const revised = collapseDocument(expandDocument(compact, library(deleted)), library(deleted));
  expect(revised.content![0].attrs?.values).toEqual({});
  expect(String(second)).toBeTruthy();
});
