// One open entry, rendered in its tab. Read mode by default; Edit switches to
// the draft-backed editor (EntryEdit). Only the active tab is mounted — dirty
// drafts survive unmount because they live in draftStore.

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PencilSimple } from "@phosphor-icons/react";
import { keys } from "../../../api/keys";
import { getEntry, listEntryTypes } from "../../../api/endpoints";
import { ApiError } from "../../../api/client";
import type { EntryDetail } from "../../../api/types";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import { useDraftStore } from "../../../stores/draftStore";
import { Button } from "../../../components/Button";
import { Chip } from "../../../components/Chip";
import { Spinner } from "../../../components/Spinner";
import { EmptyState } from "../../../components/EmptyState";
import { WorldIcon } from "../../../components/icons/WorldIcon";
import { ProseRenderer } from "./read/ProseRenderer";
import { ImageBlockRead } from "./read/ImageBlockRead";
import { SketchPreview } from "./read/SketchPreview";
import { RelationBlock } from "./read/RelationBlock";
import { DateRangeBlock } from "../dates/DateRangeBlock";
import { EntryEdit } from "./edit/EntryEdit";
import { isTempEntryId } from "./tempEntry";
import { TID } from "../../../testids";
import { useScaledPx } from "../../../theme/ui-scale";
import styles from "./EntryView.module.css";

type OrderedBlock =
  | { kind: "section"; id: string; order: number }
  | { kind: "image"; id: string; order: number }
  | { kind: "sketch"; id: string; order: number };

function orderedBlocks(entry: EntryDetail): OrderedBlock[] {
  return [
    ...entry.sections.map((s) => ({ kind: "section" as const, id: s.id, order: s.order })),
    ...entry.images.map((i) => ({ kind: "image" as const, id: i.id, order: i.order })),
    ...entry.sketches.map((s) => ({ kind: "sketch" as const, id: s.id, order: s.order })),
  ].sort((a, b) => a.order - b.order);
}

export function EntryView({ entryId }: { entryId: string }) {
  const typeIconSize = useScaledPx(13);
  const editIconSize = useScaledPx(14);
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const draft = useDraftStore((s) => s.drafts[entryId]);
  const hasDraft = draft !== undefined;
  const startDraft = useDraftStore((s) => s.startDraft);
  const isTempEntry = isTempEntryId(entryId);

  const {
    data: entry,
    isLoading,
    error,
  } = useQuery({
    queryKey: keys.entry(entryId),
    queryFn: () => getEntry(entryId),
    enabled: !isTempEntry,
  });

  const { data: types } = useQuery({
    queryKey: worldId ? keys.entryTypes(worldId) : ["entry-types", "none"],
    queryFn: () => listEntryTypes(worldId!),
    enabled: worldId !== null,
  });

  // Entry deleted elsewhere: close the tab silently.
  useEffect(() => {
    if (isTempEntry) return;
    if (error instanceof ApiError && error.status === 404) closeTab(entryId);
  }, [error, entryId, closeTab, isTempEntry]);

  const blocks = useMemo(() => (entry ? orderedBlocks(entry) : []), [entry]);

  if (isLoading && !isTempEntry) {
    return (
      <div className={styles.loading}>
        <Spinner size={22} />
      </div>
    );
  }

  if (hasDraft) {
    return <EntryEdit entryId={entryId} entry={entry} onExit={() => {}} />;
  }

  if (!entry) {
    return <EmptyState message="This entry could not be loaded." />;
  }

  const type = types?.items.find((t) => t.slug === entry.type);
  const sectionById = new Map(entry.sections.map((s) => [s.id, s]));
  const imageById = new Map(entry.images.map((i) => [i.id, i]));
  const sketchById = new Map(entry.sketches.map((s) => [s.id, s]));

  return (
    <article className={styles.entry}>
      <header className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.typeBadge}>
            <span className={styles.typeBadgeIcon}>
              <WorldIcon
                iconName={type?.iconName}
                iconWeight={type?.iconWeight}
                size={typeIconSize}
              />
            </span>
            <span className={styles.typeBadgeLabel}>{type?.name ?? entry.type}</span>
          </span>
          {entry.tags.map((tag) => (
            <Chip key={tag} asLabel>
              {tag}
            </Chip>
          ))}
        </div>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{entry.title}</h1>
          <Button
            className={styles.editButton}
            onClick={() => {
              startDraft(entry);
            }}
            data-testid={TID.entryEdit}>
            <PencilSimple size={editIconSize} />
            Edit
          </Button>
        </div>
      </header>

      <div data-content-scale="fixed">
        {blocks.length === 0 ? (
          <EmptyState message="This page is blank. Edit the entry to add a first section." />
        ) : (
          blocks.map((block) => {
            if (block.kind === "section") {
              const section = sectionById.get(block.id)!;
              return (
                <div key={block.id} className={styles.sectionBlock}>
                  <ProseRenderer doc={section.contentJson} />
                </div>
              );
            }
            if (block.kind === "image") {
              const image = imageById.get(block.id)!;
              return <ImageBlockRead key={block.id} imageId={image.id} label={image.label} />;
            }
            const sketch = sketchById.get(block.id)!;
            return <SketchPreview key={block.id} sketchId={sketch.id} label={sketch.label} />;
          })
        )}
      </div>

      <DateRangeBlock entry={entry} />

      <RelationBlock relations={entry.relations} />
    </article>
  );
}
