import { Node, mergeAttributes, type Extensions, type JSONContent } from '@tiptap/core';
import { BlockDragPreview } from './blockDragPreview.js';
import { BlockInteraction } from './blockInteraction.js';
import { BlockDragHandle } from './blockDragHandle.js';
import { CustomBlockProtection } from './customBlockProtection.js';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { mount, unmount } from 'svelte';
import FormulaBlock from '../blocks/FormulaBlock.svelte';
import ImageBlock from '../blocks/ImageBlock.svelte';
import { reactiveNodeAttrs } from './reactive.svelte.js';
import type { Sheet } from '../formula/engine.js';

export type SheetNodeType = 'container' | 'textBlock' | 'formula' | 'image' | 'customBlock';
export const allowedNodeTypes: SheetNodeType[] = ['container', 'textBlock', 'formula', 'image', 'customBlock'];

const classes = (defaultClass: string) => ({
  class: { default: defaultClass },
  nodeId: { default: '' }
});

/**
 * Creates the intentionally small sheet schema. The custom atom nodes mount Svelte 5
 * components directly, avoiding both runtime compilation and a third-party bridge.
 */
export function createSheetExtensions(fields: Sheet, options: { protectCustomBlocks?: boolean } = {}): Extensions {
  const Container = Node.create({
    name: 'container',
    group: 'block',
    content: 'block+',
    defining: true,
    addAttributes: () => classes('sheet-container'),
    parseHTML: () => [{ tag: 'section[data-sheet-container]' }],
    renderHTML: ({ HTMLAttributes }) => [
      'section', mergeAttributes({ 'data-sheet-container': '' }, HTMLAttributes), 0
    ]
  });

  const CustomBlock = Node.create({
    name: 'customBlock',
    group: 'block',
    content: 'block+',
    defining: true,
    isolating: true,
    selectable: true,
    addAttributes: () => ({
      ...classes('sheet-custom-block'),
      typeId: { default: '' },
      instanceId: { default: '' },
      nodeId: { default: '' }
    }),
    parseHTML: () => [{ tag: 'section[data-custom-block-type]' }],
    renderHTML: ({ HTMLAttributes }) => [
      'section',
      mergeAttributes({ 'data-custom-block-type': HTMLAttributes.typeId }, HTMLAttributes),
      0
    ]
  });

  const TextBlock = Node.create({
    name: 'textBlock',
    group: 'block',
    content: 'text*',
    defining: true,
    addAttributes: () => classes('sheet-text'),
    parseHTML: () => [{ tag: 'p[data-sheet-text]' }],
    renderHTML: ({ HTMLAttributes }) => [
      'p', mergeAttributes({ 'data-sheet-text': '' }, HTMLAttributes), 0
    ]
  });

  const Formula = Node.create({
    name: 'formula',
    group: 'block',
    atom: true,
    selectable: true,
    addAttributes: () => ({
      ...classes('sheet-formula'),
      field: { default: 'STR_MOD' }
    }),
    parseHTML: () => [{ tag: 'cs-formula' }],
    renderHTML: ({ HTMLAttributes }) => ['cs-formula', HTMLAttributes],
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('div');
        const attrs = reactiveNodeAttrs({ field: String(node.attrs.field ?? '') });
        dom.className = String(node.attrs.class ?? '');
        dom.dataset.sheetBlock = 'formula';
        dom.contentEditable = 'false';
        const component = mount(FormulaBlock, { target: dom, props: { attrs, fields } });
        return {
          dom,
          update(next) {
            if (next.type.name !== 'formula') return false;
            attrs.field = String(next.attrs.field ?? '');
            dom.className = String(next.attrs.class ?? '');
            return true;
          },
          stopEvent(event) {
            return !!(event.target as Element | null)?.closest?.('button');
          },
          destroy() { void unmount(component); }
        };
      };
    }
  });

  const ImageNode = Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    selectable: true,
    addAttributes: () => ({
      ...classes('sheet-image'),
      src: { default: '' },
      alt: { default: '' }
    }),
    parseHTML: () => [{ tag: 'cs-image' }],
    renderHTML: ({ HTMLAttributes }) => ['cs-image', HTMLAttributes],
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('div');
        const attrs = reactiveNodeAttrs({
          src: String(node.attrs.src ?? ''),
          alt: String(node.attrs.alt ?? '')
        });
        dom.className = String(node.attrs.class ?? '');
        dom.dataset.sheetBlock = 'image';
        dom.contentEditable = 'false';
        const component = mount(ImageBlock, { target: dom, props: { attrs } });
        return {
          dom,
          update(next) {
            if (next.type.name !== 'image') return false;
            attrs.src = String(next.attrs.src ?? '');
            attrs.alt = String(next.attrs.alt ?? '');
            dom.className = String(next.attrs.class ?? '');
            return true;
          },
          destroy() { void unmount(component); }
        };
      };
    }
  });

  return [Document, Text, Container, CustomBlock, TextBlock, Formula, ImageNode,
    BlockInteraction, BlockDragPreview, BlockDragHandle,
    ...(options.protectCustomBlocks ? [CustomBlockProtection] : [])];
}

export const insertionSamples: Record<SheetNodeType, JSONContent> = {
  container: {
    type: 'container',
    attrs: { class: 'sheet-container' },
    content: [{ type: 'textBlock', attrs: { class: 'sheet-text' }, content: [{ type: 'text', text: 'New container' }] }]
  },
  textBlock: {
    type: 'textBlock', attrs: { class: 'sheet-text' }, content: [{ type: 'text', text: 'Edit this text' }]
  },
  formula: { type: 'formula', attrs: { class: 'sheet-formula', field: 'STR_MOD' } },
  image: { type: 'image', attrs: { class: 'sheet-image', src: '', alt: '' } },
  customBlock: { type: 'customBlock', attrs: { class: 'sheet-custom-block', typeId: '', instanceId: '' }, content: [ { type: 'container', content: [{ type: 'textBlock', content: [{ type: 'text', text: '...' }] }] } ] }
};
