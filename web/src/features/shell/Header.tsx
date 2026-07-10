import { GearSix } from '@phosphor-icons/react';
import { IconButton } from '../../components/IconButton';
import { WorldSwitcher } from './WorldSwitcher';
import { TID } from '../../testids';
import styles from './Header.module.css';

export function Header({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <span className={styles.logo}>Sheaf</span>
        <WorldSwitcher />
      </div>
      <IconButton label="World settings" onClick={onOpenSettings} data-testid={TID.settingsButton}>
        <GearSix size={18} />
      </IconButton>
    </header>
  );
}
