// Icon-only workspace mode rail. Initial build ships Library only; future
// modes (Maps, Languages, Story…) are added here — absent, not disabled.

import { BookOpen } from '@phosphor-icons/react';
import { Tooltip } from 'radix-ui';
import { TID } from '../../testids';
import styles from './ModeRail.module.css';

export function ModeRail() {
  return (
    <nav className={styles.rail}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className={[styles.mode, styles.active].join(' ')}
            data-testid={TID.modeRailLibrary}
            aria-label="Library"
          >
            <BookOpen size={20} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className={styles.tooltip} side="right" sideOffset={6}>
            Library
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </nav>
  );
}
