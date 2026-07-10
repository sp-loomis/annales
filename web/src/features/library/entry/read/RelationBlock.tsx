// Fixed block at the bottom of every entry: relations as marginalia cards.
// [RelTypeIcon] name-or-inverseName → [TargetTypeIcon] Target Title.
// Direction picks the label: 'out' uses type.name, 'in' uses inverseName
// (falling back to name). Edit-mode add/remove controls are injected via
// children so the block renders identically in both modes.

import type { ReactNode } from 'react';
import { ArrowsLeftRight, X } from '@phosphor-icons/react';
import type { RelationView } from '../../../../api/types';
import { useWorkspaceStore } from '../../../../stores/workspaceStore';
import { WorldIcon } from '../../../../components/icons/WorldIcon';
import { IconButton } from '../../../../components/IconButton';
import { TID } from '../../../../testids';
import styles from './RelationBlock.module.css';

export function RelationBlock({
  relations,
  onRemove,
  actions,
}: {
  relations: RelationView[];
  /** Present in edit mode: per-card remove affordance. */
  onRemove?: (relation: RelationView) => void;
  /** Present in edit mode: the add-relation control. */
  actions?: ReactNode;
}) {
  const openTab = useWorkspaceStore((s) => s.openTab);

  return (
    <section className={styles.block}>
      <div className={styles.header}>
        <ArrowsLeftRight size={14} />
        <span>Relations</span>
        {actions}
      </div>
      {relations.length === 0 ? (
        <p className={styles.empty}>
          No relations yet. Connections between entries appear here as they are woven.
        </p>
      ) : (
        <div className={styles.cards}>
          {relations.map((r) => (
            <div key={r.id} className={styles.card} data-testid={TID.relationCard(r.id)}>
              <button
                type="button"
                className={styles.cardBody}
                onClick={() => openTab(r.otherEntry.id)}
              >
                <span className={styles.relName}>
                  <WorldIcon iconName={r.type.iconName} iconWeight={r.type.iconWeight} size={13} />
                  {r.direction === 'out' ? r.type.name : (r.type.inverseName ?? r.type.name)}
                </span>
                <span className={styles.target}>
                  <WorldIcon
                    iconName={r.otherEntry.iconName}
                    iconWeight={r.otherEntry.iconWeight}
                    size={13}
                  />
                  {r.otherEntry.title}
                </span>
              </button>
              {onRemove && (
                <IconButton
                  label="Remove relation"
                  className={styles.remove}
                  onClick={() => onRemove(r)}
                  data-testid={TID.relationRemove(r.id)}
                >
                  <X size={12} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
