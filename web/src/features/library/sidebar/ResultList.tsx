import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDashed } from "@phosphor-icons/react";
import { keys } from "../../../api/keys";
import { listEntryTypes } from "../../../api/endpoints";
import type { Density, GroupBy } from "../../../api/types";
import { EmptyState } from "../../../components/EmptyState";
import { Spinner } from "../../../components/Spinner";
import { useScaledPx } from "../../../theme/ui-scale";
import { ResultCard } from "./ResultCard";
import type { SidebarItem } from "./useSidebarData";
import styles from "./ResultList.module.css";

interface Group {
  key: string;
  label: string;
  items: SidebarItem[];
}

export function ResultList({
  worldId,
  items,
  density,
  groupBy,
  showSnippets,
  isLoading,
  searchActive,
  onOpen,
}: {
  worldId: string;
  items: SidebarItem[];
  density: Density;
  groupBy: GroupBy;
  showSnippets: boolean;
  isLoading: boolean;
  searchActive: boolean;
  onOpen: (entryId: string) => void;
}) {
  const emptyIconSize = useScaledPx(26);
  const { data: types } = useQuery({
    queryKey: keys.entryTypes(worldId),
    queryFn: () => listEntryTypes(worldId),
  });

  const groups = useMemo<Group[]>(() => {
    if (groupBy === "none") return [{ key: "all", label: "", items }];
    if (groupBy === "type") {
      const byType = new Map<string, SidebarItem[]>();
      for (const item of items) {
        const list = byType.get(item.type) ?? [];
        list.push(item);
        byType.set(item.type, list);
      }
      return [...byType.entries()].map(([slug, list]) => ({
        key: slug,
        label: types?.items.find((t) => t.slug === slug)?.name ?? slug,
        items: list,
      }));
    }
    const byLetter = new Map<string, SidebarItem[]>();
    for (const item of items) {
      const letter = (item.title[0] ?? "#").toUpperCase();
      const list = byLetter.get(letter) ?? [];
      list.push(item);
      byLetter.set(letter, list);
    }
    return [...byLetter.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([letter, list]) => ({ key: letter, label: letter, items: list }));
  }, [items, groupBy, types]);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<FileDashed size={emptyIconSize} />}
        message={
          searchActive
            ? "Nothing matched. Try a different search or loosen the filters."
            : "No entries yet. Create one to start chronicling this world."
        }
      />
    );
  }

  return (
    <div className={styles.list}>
      {groups.map((group) => (
        <div key={group.key}>
          {group.label && <div className={styles.groupHeader}>{group.label}</div>}
          {group.items.map((item) => (
            <ResultCard
              key={item.entryId}
              item={item}
              density={density}
              showSnippets={showSnippets}
              worldId={worldId}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
