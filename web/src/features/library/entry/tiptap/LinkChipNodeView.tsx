import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { LinkChip } from '../read/LinkChip';

export function LinkChipNodeView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <LinkChip
        entryId={String(node.attrs.entryId)}
        label={String(node.attrs.label ?? 'Untitled')}
        typeSlug={node.attrs.typeSlug ? String(node.attrs.typeSlug) : null}
        interactive={false}
      />
    </NodeViewWrapper>
  );
}
