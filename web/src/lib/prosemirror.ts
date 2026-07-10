// ProseMirror document helpers for section split/merge.

import type { Editor } from '@tiptap/core';
import type { PMNode } from '../api/types';

export const EMPTY_DOC: PMNode = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Slice the editor's document at the cursor into two standalone docs. */
export function splitDocAtCursor(editor: Editor): { before: PMNode; after: PMNode } {
  const { doc, selection } = editor.state;
  const before = doc.cut(0, selection.from).toJSON() as PMNode;
  const after = doc.cut(selection.from).toJSON() as PMNode;
  return {
    before: before.content?.length ? before : EMPTY_DOC,
    after: after.content?.length ? after : EMPTY_DOC,
  };
}

/** Concatenate two docs' top-level content (merge of adjacent sections). */
export function mergeDocs(a: PMNode | null, b: PMNode | null): PMNode {
  const content = [...(a?.content ?? []), ...(b?.content ?? [])];
  return content.length ? { type: 'doc', content } : EMPTY_DOC;
}
