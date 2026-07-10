// Styled Radix Dialog wrapper. Compose Root/Trigger from radix-ui directly;
// this exports the styled overlay+content shell.

import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { IconButton } from './IconButton';
import styles from './Dialog.module.css';

export const Dialog = RadixDialog;

export function DialogContent({
  title,
  children,
  wide,
  testId,
  hideClose,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
  testId?: string;
  hideClose?: boolean;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={styles.overlay} />
      <RadixDialog.Content
        className={[styles.content, wide ? styles.wide : ''].filter(Boolean).join(' ')}
        data-testid={testId}
      >
        <div className={styles.header}>
          <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
          {!hideClose && (
            <RadixDialog.Close asChild>
              <IconButton label="Close">
                <X size={16} />
              </IconButton>
            </RadixDialog.Close>
          )}
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
