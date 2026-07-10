// Inline atom node for cross-entry links. JSON shape:
//   { type: 'entryLink', attrs: { entryId, label, typeSlug } }
// label/typeSlug are denormalized render fallbacks captured at link time; the
// chip prefers the live cached title (see LinkChip). Atom: backspace deletes
// the whole chip. Inserted via the [[ typeahead (LinkTypeahead).

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { LinkChipNodeView } from './LinkChipNodeView';

export interface EntryLinkAttrs {
  entryId: string;
  label: string;
  typeSlug: string | null;
}

export const EntryLinkNode = Node.create({
  name: 'entryLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      entryId: { default: '' },
      label: { default: '' },
      typeSlug: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-entry-link-node]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-entry-link-node': node.attrs.entryId }),
      node.attrs.label,
    ];
  },

  renderText({ node }) {
    return node.attrs.label ?? '';
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkChipNodeView);
  },
});
