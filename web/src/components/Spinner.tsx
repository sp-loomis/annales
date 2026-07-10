import { CircleNotch } from '@phosphor-icons/react';
import styles from './Spinner.module.css';

export function Spinner({ size = 16 }: { size?: number }) {
  return <CircleNotch size={size} className={styles.spinner} aria-label="Loading" />;
}
