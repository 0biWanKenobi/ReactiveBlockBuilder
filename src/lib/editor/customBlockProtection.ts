import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';

/**
 * The sheet can edit custom-block values, but not their internal layout.
 * The definition editor does not install this extension.
 *
 * Compare structural fingerprints rather than positions so whole custom
 * blocks can still be moved, copied or deleted.
 */
function fingerprint(node: ProseMirrorNode): string {
  const attrs = { ...node.attrs };
  if (node.type.name === 'formula') delete attrs.field;
  if (node.type.name === 'image') {
    delete attrs.src;
    delete attrs.alt;
  }
  // Text content is a value, not structure. No inline marks are supported.
  const children = node.type.name === 'textBlock'
    ? []
    : node.content.content.map(fingerprint);
  return JSON.stringify([node.type.name, attrs, children]);
}

function outerBlocks(doc: ProseMirrorNode): Map<string, string> {
  const blocks = new Map<string, string>();
  doc.descendants((node) => {
    if (node.type.name !== 'customBlock') return true;
    const id = String(node.attrs.instanceId ?? '');
    if (id) blocks.set(id, fingerprint(node));
    // Nested definitions are already included in the outer fingerprint.
    return false;
  });
  return blocks;
}

export function preservesCustomStructure(before: ProseMirrorNode, after: ProseMirrorNode): boolean {
  const existing = outerBlocks(before);
  const updated = outerBlocks(after);
  for (const [id, structure] of existing) {
    const next = updated.get(id);
    if (next !== undefined && next !== structure) return false;
  }
  return true;
}

export const CustomBlockProtection = Extension.create({
  name: 'customBlockProtection',
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction(transaction, state) {
        if (!transaction.docChanged || transaction.getMeta('rbb:definition-reconcile')) return true;
        return preservesCustomStructure(state.doc, transaction.doc);
      }
    })];
  }
});
