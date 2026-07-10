// Chrome around one compositor block: drag handle (dnd-kit sortable) and a
// hover-revealed action row. The reorder affordance is isolated here so the
// mobile Move up/down variant can slot in later without touching block bodies.

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVertical } from "@phosphor-icons/react";
import { TID } from "../../../../testids";
import styles from "./BlockFrame.module.css";

export function BlockFrame({
  blockKey,
  children,
  actions,
}: {
  blockKey: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: blockKey,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[styles.frame, isDragging ? styles.dragging : ""].filter(Boolean).join(" ")}
      data-testid={TID.block(blockKey)}>
      <div className={styles.gutter}>
        <button
          type="button"
          className={styles.handle}
          aria-label="Drag to reorder"
          data-testid={TID.blockDragHandle(blockKey)}
          {...attributes}
          {...listeners}>
          <DotsSixVertical size={14} />
        </button>
      </div>
      <div className={styles.content}>
        {actions && <div className={styles.topActions}>{actions}</div>}
        {children}
      </div>
    </div>
  );
}
