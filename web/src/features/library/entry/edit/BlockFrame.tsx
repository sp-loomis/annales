// Chrome around one compositor block: drag handle (dnd-kit sortable) and a
// hover-revealed action row. The reorder affordance is isolated here so the
// mobile Move up/down variant can slot in later without touching block bodies.

import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, DotsSixVertical, SplitVertical, Trash } from '@phosphor-icons/react';
import { IconButton } from '../../../../components/IconButton';
import { TID } from '../../../../testids';
import styles from './BlockFrame.module.css';

export function BlockFrame({
  blockKey,
  children,
  onDelete,
  onDuplicate,
  onSplit,
}: {
  blockKey: string;
  children: ReactNode;
  onDelete: () => void;
  /** Sections only — artifact blocks have no server-side copy. */
  onDuplicate?: () => void;
  /** Sections only. */
  onSplit?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: blockKey,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[styles.frame, isDragging ? styles.dragging : ''].filter(Boolean).join(' ')}
      data-testid={TID.block(blockKey)}
    >
      <div className={styles.gutter}>
        <button
          type="button"
          className={styles.handle}
          aria-label="Drag to reorder"
          data-testid={TID.blockDragHandle(blockKey)}
          {...attributes}
          {...listeners}
        >
          <DotsSixVertical size={14} />
        </button>
      </div>
      <div className={styles.content}>{children}</div>
      <div className={styles.actions}>
        {onSplit && (
          <IconButton label="Split at cursor" onClick={onSplit} data-testid={TID.blockSplit(blockKey)}>
            <SplitVertical size={13} />
          </IconButton>
        )}
        {onDuplicate && (
          <IconButton label="Duplicate" onClick={onDuplicate} data-testid={TID.blockDuplicate(blockKey)}>
            <Copy size={13} />
          </IconButton>
        )}
        <IconButton label="Delete block" onClick={onDelete} data-testid={TID.blockDelete(blockKey)}>
          <Trash size={13} />
        </IconButton>
      </div>
    </div>
  );
}
