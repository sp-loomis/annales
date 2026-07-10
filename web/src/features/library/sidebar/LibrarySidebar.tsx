import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "@phosphor-icons/react";
import { keys } from "../../../api/keys";
import { listEntryTypes } from "../../../api/endpoints";
import { useWorkspaceStore, selectWorkspace } from "../../../stores/workspaceStore";
import { useDraftStore } from "../../../stores/draftStore";
import { Button } from "../../../components/Button";
import { SearchBar } from "./SearchBar";
import { FilterPanel } from "./FilterPanel";
import { DensityToggle } from "./DensityToggle";
import { ResultList } from "./ResultList";
import { useSidebarData } from "./useSidebarData";
import { makeTempEntryId } from "../entry/tempEntry";
import { TID } from "../../../testids";
import styles from "./LibrarySidebar.module.css";

export function LibrarySidebar() {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const sidebar = useWorkspaceStore((s) => selectWorkspace(s).sidebar);
  const setSidebar = useWorkspaceStore((s) => s.setSidebar);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const startUntitledDraft = useDraftStore((s) => s.startUntitledDraft);
  const queryClient = useQueryClient();

  const { items, allTags, searchActive, textQueryActive, isLoading } = useSidebarData(
    worldId,
    sidebar
  );

  if (!worldId) return null;

  const createUntitledEntry = async () => {
    const types = await queryClient.fetchQuery({
      queryKey: keys.entryTypes(worldId),
      queryFn: () => listEntryTypes(worldId),
      staleTime: 30_000,
    });
    const defaultType = types.items[0]?.slug;
    if (!defaultType) return;
    const tempEntryId = makeTempEntryId();
    startUntitledDraft(tempEntryId, defaultType);
    openTab(tempEntryId);
  };

  const filterCount = sidebar.typeSlugs.length + sidebar.tags.length;

  return (
    <div className={styles.sidebar}>
      <SearchBar
        query={sidebar.query}
        onQueryChange={(query) => setSidebar({ query })}
        filtersOpen={sidebar.filtersOpen}
        onToggleFilters={() => setSidebar({ filtersOpen: !sidebar.filtersOpen })}
        filterCount={filterCount}
      />
      {sidebar.filtersOpen && (
        <FilterPanel worldId={worldId} prefs={sidebar} allTags={allTags} onChange={setSidebar} />
      )}
      <div className={styles.listHeader}>
        <span className={styles.count}>
          {items.length} {items.length === 1 ? "entry" : "entries"}
        </span>
        <div className={styles.headerActions}>
          <DensityToggle
            density={sidebar.density}
            onChange={(density) => setSidebar({ density })}
          />
          <Button
            variant="ghost"
            className={styles.newEntry}
            onClick={() => void createUntitledEntry()}
            data-testid={TID.newEntryButton}>
            <Plus size={13} />
            New
          </Button>
        </div>
      </div>
      <div className={styles.scroll}>
        <ResultList
          worldId={worldId}
          items={items}
          density={sidebar.density}
          groupBy={sidebar.groupBy}
          showSnippets={textQueryActive}
          isLoading={isLoading}
          searchActive={searchActive}
          onOpen={openTab}
        />
      </div>
    </div>
  );
}
