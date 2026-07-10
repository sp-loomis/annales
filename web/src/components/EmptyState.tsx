// Shared empty state: what goes here + how to begin. Never a blank rectangle.

import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export function EmptyState({
  icon,
  message,
  action,
}: {
  icon?: ReactNode;
  message: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      {icon && <div className={styles.icon}>{icon}</div>}
      <div className={styles.message}>{message}</div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
