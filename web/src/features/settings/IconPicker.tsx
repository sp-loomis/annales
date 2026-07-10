// Searchable Phosphor icon picker. The full icon map is the lazily-loaded
// chunk behind useIconMap; a "Suggested" section curates ~40 worldbuilding
// icons, full-set search below (capped for render sanity). Weight selector
// offers the six Phosphor weights plus "world default" (stored as null).

import { useMemo, useState } from 'react';
import { Popover } from 'radix-ui';
import { useIconMap, WorldIcon } from '../../components/icons/WorldIcon';
import { SUGGESTED_ICONS } from '../../components/icons/suggested';
import { TextInput } from '../../components/TextInput';
import { Spinner } from '../../components/Spinner';
import { TID } from '../../testids';
import styles from './IconPicker.module.css';

const WEIGHTS = ['thin', 'light', 'regular', 'bold', 'fill', 'duotone'] as const;
const MAX_RESULTS = 120;

export function IconPicker({
  iconName,
  iconWeight,
  onChange,
}: {
  iconName: string | null;
  iconWeight: string | null;
  onChange: (patch: { iconName?: string | null; iconWeight?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const map = useIconMap();

  const names = useMemo(() => {
    if (!map) return [];
    const all = Object.keys(map);
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return all.filter((n) => n.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [map, query]);

  const suggested = useMemo(
    () => (map ? SUGGESTED_ICONS.filter((n) => n in map) : []),
    [map]
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={styles.trigger} aria-label="Choose icon">
          <WorldIcon iconName={iconName} iconWeight={iconWeight} size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.popover} sideOffset={6} align="start">
          <TextInput
            autoFocus
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid={TID.iconPickerSearch}
          />
          {!map ? (
            <div className={styles.loading}>
              <Spinner />
            </div>
          ) : (
            <div className={styles.scroll}>
              {!query.trim() && (
                <>
                  <div className={styles.sectionLabel}>Suggested</div>
                  <IconGrid
                    names={suggested}
                    current={iconName}
                    weight={iconWeight}
                    onPick={(name) => onChange({ iconName: name })}
                  />
                </>
              )}
              {query.trim() && (
                <IconGrid
                  names={names}
                  current={iconName}
                  weight={iconWeight}
                  onPick={(name) => onChange({ iconName: name })}
                />
              )}
            </div>
          )}
          <div className={styles.weightRow}>
            <button
              type="button"
              className={[styles.weight, iconWeight === null ? styles.weightActive : ''].join(' ')}
              onClick={() => onChange({ iconWeight: null })}
              title="Use world default weight"
            >
              auto
            </button>
            {WEIGHTS.map((w) => (
              <button
                key={w}
                type="button"
                className={[styles.weight, iconWeight === w ? styles.weightActive : ''].join(' ')}
                onClick={() => onChange({ iconWeight: w })}
                title={w}
              >
                <WorldIcon iconName={iconName ?? 'Circle'} iconWeight={w} size={14} />
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function IconGrid({
  names,
  current,
  weight,
  onPick,
}: {
  names: string[];
  current: string | null;
  weight: string | null;
  onPick: (name: string) => void;
}) {
  if (names.length === 0) {
    return <p className={styles.noResults}>No icons matched.</p>;
  }
  return (
    <div className={styles.grid}>
      {names.map((name) => (
        <button
          key={name}
          type="button"
          className={[styles.cell, name === current ? styles.cellActive : ''].join(' ')}
          onClick={() => onPick(name)}
          title={name}
          data-testid={TID.iconPickerItem(name)}
        >
          <WorldIcon iconName={name} iconWeight={weight} size={17} />
        </button>
      ))}
    </div>
  );
}
