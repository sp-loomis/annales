import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import styles from './IconButton.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label: string;
}

// forwardRef: Radix asChild slots pass refs into these.
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { active, label, className, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={[styles.iconButton, active ? styles.active : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
});
