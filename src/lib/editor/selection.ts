import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

export interface SelectedEditorBlock {
  pos: number;
  type: string;
  attrs: Record<string, unknown>;
}

/** Shared block identity and position resolution for both editor surfaces. */
export function selectedBlock(editor: Pick<Editor, 'state'>): SelectedEditorBlock | null {
  const selection = editor.state.selection;
  const node = selection instanceof NodeSelection
    ? { pos: selection.from, block: selection.node }
    : selection.$from.depth > 0
      ? {
          pos: selection.$from.before(selection.$from.depth),
          block: selection.$from.parent
        }
      : null;
  return node
    ? { pos: node.pos, type: node.block.type.name, attrs: { ...node.block.attrs } }
    : null;
}

/** Inspector edits should not steal focus from the active input. */
export function updateBlockAttribute(editor: Editor, pos: number, attribute: string, value: string): void {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(
    pos, undefined, { ...node.attrs, [attribute]: value }
  ));
}
