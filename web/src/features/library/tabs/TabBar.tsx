// Tab bar for open entries. [TypeIcon] Title + close ×; dirty tabs show a dot
// until hover. Overflow (tabs exceed the row) reveals a CaretDown menu listing
// every open tab. Closing a dirty tab asks for confirmation first.

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { DropdownMenu } from "radix-ui";
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  CaretDown,
  Circle,
  CornersIn,
  Plus,
  X,
} from "@phosphor-icons/react";
import { keys } from "../../../api/keys";
import { getEntry, listEntryTypes } from "../../../api/endpoints";
import { useWorkspaceStore, selectWorkspace } from "../../../stores/workspaceStore";
import { useDraftStore, useIsDirty } from "../../../stores/draftStore";
import { isDraftDirty } from "../entry/edit/draft";
import { getUntitledLabel, isTempEntryId, makeTempEntryId } from "../entry/tempEntry";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { IconButton } from "../../../components/IconButton";
import { WorldIcon } from "../../../components/icons/WorldIcon";
import { getOverlayContainer } from "../../../lib/overlay";
import { TID } from "../../../testids";
import { useShellChromeControls } from "../../shell/ShellChromeContext";
import { useScaledPxSoft } from "../../../theme/ui-scale";
import styles from "./TabBar.module.css";

function Tab({
  entryId,
  active,
  tabRef,
  onSelect,
  onClose,
}: {
  entryId: string;
  active: boolean;
  tabRef?: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onClose: () => void;
}) {
  const tabTypeIconSize = useScaledPxSoft(13);
  const tabDirtyIconSize = useScaledPxSoft(8);
  const tabCloseIconSize = useScaledPxSoft(11);
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const dirty = useIsDirty(entryId);
  const draft = useDraftStore((s) => s.drafts[entryId]);
  const isTempEntry = isTempEntryId(entryId);
  const { data: entry } = useQuery({
    queryKey: keys.entry(entryId),
    queryFn: () => getEntry(entryId),
    enabled: !isTempEntry,
  });
  const { data: types } = useQuery({
    queryKey: worldId ? keys.entryTypes(worldId) : ["entry-types", "none"],
    queryFn: () => listEntryTypes(worldId!),
    enabled: worldId !== null,
  });
  const typeSlug = entry?.type ?? draft?.typeSlug;
  const type = types?.items.find((t) => t.slug === typeSlug);
  const title =
    entry?.title ?? (draft ? getUntitledLabel(draft.title) : isTempEntry ? "Untitled" : "…");

  return (
    <div
      ref={tabRef}
      className={[styles.tab, active ? styles.active : ""].filter(Boolean).join(" ")}
      data-testid={TID.tab(entryId)}>
      <button type="button" className={styles.tabLabel} onClick={onSelect}>
        <WorldIcon iconName={type?.iconName} iconWeight={type?.iconWeight} size={tabTypeIconSize} />
        <span className={styles.tabTitle}>{title}</span>
      </button>
      <button
        type="button"
        className={styles.tabClose}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close tab"
        data-testid={TID.tabClose(entryId)}>
        {dirty ? (
          <Circle size={tabDirtyIconSize} weight="fill" className={styles.dirtyDot} />
        ) : null}
        <X size={tabCloseIconSize} className={dirty ? styles.closeIconDirty : undefined} />
      </button>
    </div>
  );
}

export function TabBar() {
  const focusIconSize = useScaledPxSoft(16);
  const newIconSize = useScaledPxSoft(13);
  const overflowIconSize = useScaledPxSoft(13);
  const shellControls = useShellChromeControls();
  const portalContainer = getOverlayContainer();
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const openEntryIds = useWorkspaceStore((s) => selectWorkspace(s).openEntryIds);
  const activeEntryId = useWorkspaceStore((s) => selectWorkspace(s).activeEntryId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const startUntitledDraft = useDraftStore((s) => s.startUntitledDraft);
  const queryClient = useQueryClient();

  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [openEntryIds.length]);

  useEffect(() => {
    if (!activeEntryId) return;
    const activeTab = tabRefs.current.get(activeEntryId);
    if (!activeTab) return;
    activeTab.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [activeEntryId, openEntryIds.length]);

  if (openEntryIds.length === 0 && !shellControls?.isFocusMode) return null;

  const requestClose = (entryId: string) => {
    const draft = useDraftStore.getState().drafts[entryId];
    if (draft && isDraftDirty(draft)) {
      setPendingClose(entryId);
    } else {
      useDraftStore.getState().dropDraft(entryId);
      closeTab(entryId);
    }
  };

  const pendingTitle = pendingClose
    ? getUntitledLabel(
        queryClient.getQueryData<{ title: string }>(keys.entry(pendingClose))?.title ??
          useDraftStore.getState().drafts[pendingClose]?.title ??
          ""
      )
    : "";

  const fullscreenLabel = shellControls?.isFullscreen
    ? "Exit fullscreen"
    : shellControls?.isFullscreenSupported
      ? "Enter fullscreen"
      : "Fullscreen unavailable in this browser";

  const createUntitledEntry = async () => {
    if (!worldId) return;
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

  return (
    <div className={styles.bar}>
      <div className={styles.row} ref={rowRef}>
        {openEntryIds.map((id) => (
          <Tab
            key={id}
            entryId={id}
            active={id === activeEntryId}
            tabRef={(el) => {
              if (el) {
                tabRefs.current.set(id, el);
              } else {
                tabRefs.current.delete(id);
              }
            }}
            onSelect={() => setActiveTab(id)}
            onClose={() => requestClose(id)}
          />
        ))}
      </div>
      {overflowing && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={styles.overflowTrigger}
              aria-label="All open tabs"
              data-testid={TID.tabOverflowTrigger}>
              <CaretDown size={overflowIconSize} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={portalContainer}>
            <DropdownMenu.Content className={styles.overflowMenu} align="end" sideOffset={4}>
              {openEntryIds.map((id) => (
                <OverflowItem key={id} entryId={id} onSelect={() => setActiveTab(id)} />
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {shellControls?.isFocusMode && (
        <div className={styles.leadingAction}>
          <IconButton
            className={styles.newButton}
            label="New entry"
            onClick={() => void createUntitledEntry()}
            data-testid={TID.tabNewButton}>
            <Plus size={newIconSize} />
          </IconButton>
        </div>
      )}
      {shellControls?.isFocusMode && (
        <div className={styles.actions}>
          <IconButton
            label="Exit focus mode"
            onClick={shellControls.toggleFocus}
            active
            aria-pressed
            data-testid={TID.focusButton}>
            <CornersIn size={focusIconSize} />
          </IconButton>
          <IconButton
            label={fullscreenLabel}
            onClick={shellControls.toggleFullscreen}
            active={shellControls.isFullscreen}
            aria-pressed={shellControls.isFullscreen}
            disabled={!shellControls.isFullscreenSupported}
            data-testid={TID.fullscreenButton}>
            {shellControls.isFullscreen ? (
              <ArrowsInSimple size={focusIconSize} />
            ) : (
              <ArrowsOutSimple size={focusIconSize} />
            )}
          </IconButton>
        </div>
      )}
      <ConfirmDialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
        title="Discard unsaved changes?"
        description={`Discard unsaved changes to ${pendingTitle}?`}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        confirmTestId={TID.discardConfirm}
        cancelTestId={TID.discardCancel}
        onConfirm={() => {
          if (pendingClose) {
            useDraftStore.getState().dropDraft(pendingClose);
            closeTab(pendingClose);
          }
          setPendingClose(null);
        }}
      />
    </div>
  );
}

function OverflowItem({ entryId, onSelect }: { entryId: string; onSelect: () => void }) {
  const draft = useDraftStore((s) => s.drafts[entryId]);
  const isTempEntry = isTempEntryId(entryId);
  const { data: entry } = useQuery({
    queryKey: keys.entry(entryId),
    queryFn: () => getEntry(entryId),
    enabled: !isTempEntry,
  });
  const title =
    entry?.title ?? (draft ? getUntitledLabel(draft.title) : isTempEntry ? "Untitled" : "…");
  return (
    <DropdownMenu.Item
      className={styles.overflowItem}
      onSelect={onSelect}
      data-testid={TID.tabOverflowItem(entryId)}>
      {title}
    </DropdownMenu.Item>
  );
}
