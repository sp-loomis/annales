import { BookOpen } from "@phosphor-icons/react";
import { useWorkspaceStore, selectWorkspace } from "../../stores/workspaceStore";
import { EmptyState } from "../../components/EmptyState";
import { TabBar } from "./tabs/TabBar";
import { EntryView } from "./entry/EntryView";
import { useScaledPx } from "../../theme/ui-scale";
import styles from "./LibraryBody.module.css";

export function LibraryBody() {
  const activeEntryId = useWorkspaceStore((s) => selectWorkspace(s).activeEntryId);
  const emptyIconSize = useScaledPx(32);

  return (
    <div className={styles.body}>
      <TabBar />
      <div className={styles.content}>
        {activeEntryId ? (
          // Key by entry id: switching tabs remounts cleanly; drafts persist in
          // draftStore, and the Query cache makes remount instant.
          <EntryView key={activeEntryId} entryId={activeEntryId} />
        ) : (
          <EmptyState
            icon={<BookOpen size={emptyIconSize} />}
            message="Search or browse the sidebar, then open an entry to start reading."
          />
        )}
      </div>
    </div>
  );
}
