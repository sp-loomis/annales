import { Article, List, SquaresFour } from '@phosphor-icons/react';
import { ToggleGroup } from 'radix-ui';
import type { Density } from '../../../api/types';
import { TID } from '../../../testids';
import styles from './DensityToggle.module.css';

const OPTIONS: { value: Density; label: string; Icon: typeof List }[] = [
  { value: 'compact', label: 'Compact', Icon: List },
  { value: 'comfortable', label: 'Comfortable', Icon: SquaresFour },
  { value: 'detailed', label: 'Detailed', Icon: Article },
];

export function DensityToggle({
  density,
  onChange,
}: {
  density: Density;
  onChange: (d: Density) => void;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={density}
      onValueChange={(v) => {
        if (v) onChange(v as Density);
      }}
      className={styles.group}
      aria-label="Result density"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <ToggleGroup.Item
          key={value}
          value={value}
          className={styles.item}
          aria-label={label}
          title={label}
          data-testid={TID.densityToggle(value)}
        >
          <Icon size={14} />
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
