import { Funnel, MagnifyingGlass } from '@phosphor-icons/react';
import { TextInput } from '../../../components/TextInput';
import { IconButton } from '../../../components/IconButton';
import { TID } from '../../../testids';
import styles from './SearchBar.module.css';

export function SearchBar({
  query,
  onQueryChange,
  filtersOpen,
  onToggleFilters,
  filterCount,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  filterCount: number;
}) {
  return (
    <div className={styles.bar}>
      <div className={styles.inputWrap}>
        <MagnifyingGlass size={14} className={styles.searchIcon} />
        <TextInput
          className={styles.input}
          placeholder="Search this world…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          data-testid={TID.searchInput}
        />
      </div>
      <IconButton
        label="Filters"
        active={filtersOpen || filterCount > 0}
        onClick={onToggleFilters}
        data-testid={TID.searchFilterToggle}
      >
        <Funnel size={15} />
        {filterCount > 0 && <span className={styles.badge}>{filterCount}</span>}
      </IconButton>
    </div>
  );
}
