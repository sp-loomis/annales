// Renders section contentJson (ProseMirror doc) as React. The schema is small
// and closed (see tiptap/extensions.ts), so a hand-rolled walker beats
// generateHTML here: entryLink nodes render as live LinkChip components with
// icons and click-through. Unknown nodes render their children in a neutral
// wrapper for forward compatibility.

import type { ReactNode } from 'react';
import type { PMNode } from '../../../../api/types';
import { LinkChip } from './LinkChip';
import styles from './ProseRenderer.module.css';

function renderText(node: PMNode, key: number): ReactNode {
  let content: ReactNode = node.text ?? '';
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        content = <strong>{content}</strong>;
        break;
      case 'italic':
        content = <em>{content}</em>;
        break;
      case 'code':
        content = <code>{content}</code>;
        break;
      default:
        break;
    }
  }
  return <span key={key}>{content}</span>;
}

function renderChildren(node: PMNode): ReactNode {
  return (node.content ?? []).map((child, i) => <Node key={i} node={child} index={i} />);
}

function Node({ node, index }: { node: PMNode; index: number }): ReactNode {
  switch (node.type) {
    case 'text':
      return renderText(node, index);
    case 'paragraph':
      return <p>{renderChildren(node)}</p>;
    case 'heading': {
      const level = Number(node.attrs?.level ?? 2);
      const Tag = level === 3 ? 'h3' : level === 4 ? 'h4' : 'h2';
      return <Tag>{renderChildren(node)}</Tag>;
    }
    case 'bulletList':
      return <ul>{renderChildren(node)}</ul>;
    case 'orderedList':
      return <ol>{renderChildren(node)}</ol>;
    case 'listItem':
      return <li>{renderChildren(node)}</li>;
    case 'blockquote':
      return <blockquote>{renderChildren(node)}</blockquote>;
    case 'hardBreak':
      return <br />;
    case 'entryLink':
      return (
        <LinkChip
          entryId={String(node.attrs?.entryId ?? '')}
          label={String(node.attrs?.label ?? 'Untitled')}
          typeSlug={node.attrs?.typeSlug ? String(node.attrs.typeSlug) : null}
        />
      );
    default:
      return <div>{renderChildren(node)}</div>;
  }
}

export function ProseRenderer({ doc }: { doc: PMNode | null }) {
  if (!doc || !doc.content?.length) return null;
  return <div className={styles.prose}>{renderChildren(doc)}</div>;
}
