import { test, expect } from 'bun:test';
import {
  createDefinition, makeInstance, expandDocument, collapseDocument,
  resetLeafDefaults, validateDefinition
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
