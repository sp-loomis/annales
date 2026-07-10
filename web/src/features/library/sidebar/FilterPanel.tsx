// Search Layer 2: entry-type multi-select chips, tag AND-filter chips, sort
// and group-by controls. Layer 3 (dates, locations, graph search) is reserved
// for add-ons and deliberately absent, not disabled.

import { useQuery } from '@tanstack/react-query';
import { keys } from '../../../api/keys';
import { listEntryTypes } from '../../../api/endpoints';
import type { GroupBy, SidebarPrefs, SortMode } from '../../../api/types';
import { Chip } from '../../../components/Chip';
import { WorldIcon } from '../../../components/icons/WorldIcon';
import { TID } from '../../../testids';
import styles from './FilterPanel.module.css';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'updated', label: 'Updated' },
  { value: 'title-asc', label: 'Title A–Z' },
  { value: 'title-desc', label: 'Title Z–A' },
];

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'type', label: 'Type' },
  { value: 'first-letter', label: 'First letter' },
];

export function FilterPanel({
  worldId,
  prefs,
  allTags,
  onChange,
}: {
  worldId: string;
  prefs: SidebarPrefs;
  allTags: string[];
  onChange: (patch: Partial<SidebarPrefs>) => void;
}) {
  const { data: types } = useQuery({
    queryKey: keys.entryTypes(worldId),
    queryFn: () => listEntryTypes(worldId),
  });

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className={styles.panel}>
      <div className={styles.group}>
        <span className={styles.label}>Types</span>
        <div className={styles.chips}>
          {(types?.items ?? []).map((t) => (
            <Chip
              key={t.id}
              selected={prefs.typeSlugs.includes(t.slug)}
              onClick={() => onChange({ typeSlugs: toggle(prefs.typeSlugs, t.slug) })}
              data-testid={TID.filterTypeChip(t.slug)}
            >
              <WorldIcon iconName={t.iconName} iconWeight={t.iconWeight} size={12} />
              {t.name}
            </Chip>
          ))}
        </div>
      </div>

      {allTags.length > 0 && (
        <div className={styles.group}>
          <span className={styles.label}>Tags</span>
          <div className={styles.chips}>
            {allTags.map((tag) => (
              <Chip
                key={tag}
                selected={prefs.tags.includes(tag)}
                onClick={() => onChange({ tags: toggle(prefs.tags, tag) })}
                data-testid={TID.filterTagChip(tag)}
              >
                {tag}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className={styles.selects}>
        <label className={styles.selectWrap}>
          <span className={styles.label}>Sort</span>
          <select
            className={styles.select}
            value={prefs.sort}
            onChange={(e) => onChange({ sort: e.target.value as SortMode })}
            data-testid={TID.sortSelect}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.selectWrap}>
          <span className={styles.label}>Group by</span>
          <select
            className={styles.select}
            value={prefs.groupBy}
            onChange={(e) => onChange({ groupBy: e.target.value as GroupBy })}
            data-testid={TID.groupBySelect}
          >
            {GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
