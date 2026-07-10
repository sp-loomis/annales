import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Chip.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: ReactNode;
  /** Render as a non-interactive span (result-card tags are not clickable in v1). */
  asLabel?: boolean;
}

export function Chip({ selected, asLabel, className, children, ...rest }: Props) {
  const cls = [styles.chip, selected ? styles.selected : '', className].filter(Boolean).join(' ');
  if (asLabel) return <span className={cls}>{children}</span>;
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
