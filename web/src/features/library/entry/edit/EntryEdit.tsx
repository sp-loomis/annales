// Edit mode for one entry: editable header (title, type, tags, entry-level
// actions), block compositor, relation block (relations mutate immediately),
// and Save / Cancel. Save orchestrates the API fan-out (useSaveEntry); Cancel
// discards the draft and compensates eagerly-created artifacts.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DropdownMenu, Popover } from "radix-ui";
import { CaretDown, DotsThree, X } from "@phosphor-icons/react";
import { keys } from "../../../../api/keys";
import { deleteEntry, deleteRelation, listEntryTypes } from "../../../../api/endpoints";
import type { EntryDetail, EntryType } from "../../../../api/types";
import { useDraftStore } from "../../../../stores/draftStore";
import { useWorkspaceStore } from "../../../../stores/workspaceStore";
import { Button } from "../../../../components/Button";
import { IconButton } from "../../../../components/IconButton";
import { TextInput } from "../../../../components/TextInput";
import { Chip } from "../../../../components/Chip";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { RelationBlock } from "../read/RelationBlock";
import { AddRelationPopover } from "../../relations/AddRelationPopover";
import { DateRangeBlock } from "../../dates/DateRangeBlock";
import { BlockCompositor } from "./BlockCompositor";
import { useSaveEntry, cancelDraft } from "./useSaveEntry";
import { getUntitledLabel, isTempEntryId } from "../tempEntry";
import { WorldIcon } from "../../../../components/icons/WorldIcon";
import { getOverlayContainer } from "../../../../lib/overlay";
import { TID } from "../../../../testids";
import { useScaledPx } from "../../../../theme/ui-scale";
import entryStyles from "../EntryView.module.css";
import styles from "./EntryEdit.module.css";

type EntryTypeOption = Pick<EntryType, "id" | "name" | "slug" | "iconName" | "iconWeight">;

function TypeRow({
  type,
  active,
  onSelect,
}: {
  type: EntryTypeOption;
  active: boolean;
  onSelect: () => void;
}) {
  const typeIconSize = useScaledPx(13);
  return (
    <button
      type="button"
      className={[styles.typeRow, active ? styles.activeTypeRow : ""].filter(Boolean).join(" ")}
      onClick={onSelect}>
      <span className={styles.typeRowIcon}>
        <WorldIcon iconName={type.iconName} iconWeight={type.iconWeight} size={typeIconSize} />
      </span>
      <span className={styles.typeName}>{type.name}</span>
    </button>
  );
}

export function EntryEdit({
  entryId,
  entry,
  onExit,
}: {
  entryId: string;
  entry?: EntryDetail;
  onExit: () => void;
}) {
  const typeIconSize = useScaledPx(13);
  const typeChevronSize = useScaledPx(12);
  const menuIconSize = useScaledPx(18);
  const tagCloseIconSize = useScaledPx(10);
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const draft = useDraftStore((s) => s.drafts[entryId]);
  const updateDraft = useDraftStore((s) => s.updateDraft);
  const isTempEntry = isTempEntryId(entryId);
  const queryClient = useQueryClient();

  const [tagInput, setTagInput] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const portalContainer = getOverlayContainer();
  const { save, saving, errors } = useSaveEntry(entryId, worldId, onExit);

  const { data: types } = useQuery({
    queryKey: worldId ? keys.entryTypes(worldId) : ["entry-types", "none"],
    queryFn: () => listEntryTypes(worldId!),
    enabled: worldId !== null && typeOpen,
  });
  const cachedTypes = worldId
    ? queryClient.getQueryData<{ items: EntryTypeOption[] }>(keys.entryTypes(worldId))
    : undefined;
  const selectedType =
    types?.items.find((t) => t.slug === draft.typeSlug) ??
    cachedTypes?.items.find((t) => t.slug === draft.typeSlug);
  const selectedTypeLabel = (selectedType?.name ?? draft.typeSlug) || "Select type";

  const deleteMutation = useMutation({
    mutationFn: () => deleteEntry(entryId),
    onSuccess: async () => {
      useDraftStore.getState().dropDraft(entryId);
      closeTab(entryId);
      if (worldId) {
        await queryClient.invalidateQueries({ queryKey: keys.entries(worldId) });
        await queryClient.invalidateQueries({ queryKey: ["worlds", worldId, "search"] });
      }
    },
  });

  const removeRelation = useMutation({
    mutationFn: (relationId: string) => deleteRelation(relationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.entry(entryId) }),
  });

  if (!draft) return null;

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || draft.tags.includes(tag)) {
      setTagInput("");
      return;
    }
    updateDraft(entryId, (d) => ({ ...d, tags: [...d.tags, tag] }));
    setTagInput("");
  };

  return (
    <article className={entryStyles.entry}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <Popover.Root open={typeOpen} onOpenChange={setTypeOpen}>
            <Popover.Trigger asChild>
              <button type="button" className={styles.typeTrigger} data-testid={TID.entryTypeBadge}>
                <span className={styles.typeTriggerInner}>
                  <span className={styles.typeTriggerIcon}>
                    <WorldIcon
                      iconName={selectedType?.iconName}
                      iconWeight={selectedType?.iconWeight}
                      size={typeIconSize}
                    />
                  </span>
                  <span className={styles.typeTriggerLabel}>{selectedTypeLabel}</span>
                </span>
                <CaretDown size={typeChevronSize} />
              </button>
            </Popover.Trigger>
            <Popover.Portal container={portalContainer}>
              <Popover.Content className={styles.typePopover} sideOffset={6} align="start">
                <div className={styles.typeList}>
                  {(types?.items ?? []).map((t) => (
                    <TypeRow
                      key={t.id}
                      type={t}
                      active={t.slug === draft.typeSlug}
                      onSelect={() => {
                        updateDraft(entryId, (d) => ({ ...d, typeSlug: t.slug }));
                        setTypeOpen(false);
                      }}
                    />
                  ))}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <div className={styles.headerActions}>
            {!isTempEntry && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <IconButton label="Entry actions" data-testid={TID.entryMenu}>
                    <DotsThree size={menuIconSize} weight="bold" />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal container={portalContainer}>
                  <DropdownMenu.Content className={styles.menu} align="end" sideOffset={4}>
                    <DropdownMenu.Item
                      className={styles.menuItemDanger}
                      onSelect={() => setDeleteOpen(true)}
                      data-testid={TID.entryDelete}>
                      Delete entry
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
            <Button
              className={styles.editorActionButton}
              onClick={() => {
                cancelDraft(entryId);
                if (isTempEntry) {
                  closeTab(entryId);
                  return;
                }
                onExit();
              }}
              data-testid={TID.entryCancel}>
              Cancel
            </Button>
            <Button
              className={styles.editorActionButton}
              variant="primary"
              onClick={() => void save()}
              disabled={saving}
              data-testid={TID.entrySave}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
        <input
          className={styles.titleInput}
          value={draft.title}
          onChange={(e) => updateDraft(entryId, (d) => ({ ...d, title: e.target.value }))}
          placeholder={getUntitledLabel("")}
          data-testid={TID.entryTitleInput}
        />
        <div className={styles.tags}>
          {draft.tags.map((tag) => (
            <Chip
              key={tag}
              onClick={() =>
                updateDraft(entryId, (d) => ({ ...d, tags: d.tags.filter((t) => t !== tag) }))
              }>
              {tag}
              <X size={tagCloseIconSize} />
            </Chip>
          ))}
          <TextInput
            className={styles.tagInput}
            placeholder="Add tag…"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            data-testid={TID.entryTagInput}
          />
        </div>
        {errors.length > 0 && (
          <div className={styles.errors}>
            Some changes failed to save — fix and save again. {errors.join("; ")}
          </div>
        )}
      </header>

      <BlockCompositor entryId={entryId} allowArtifacts={!isTempEntry} />

      {!isTempEntry && entry && <DateRangeBlock entry={entry} editable />}

      {!isTempEntry && entry && (
        <RelationBlock
          relations={entry.relations}
          onRemove={(r) => removeRelation.mutate(r.id)}
          actions={<AddRelationPopover entry={entry} />}
        />
      )}

      {!isTempEntry && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete entry?"
          description={`"${getUntitledLabel(draft.title)}" and all of its sections, images, sketches and relations will be permanently deleted.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => deleteMutation.mutate()}
        />
      )}
    </article>
  );
}
