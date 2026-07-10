// Tab bar for open entries. [TypeIcon] Title + close ×; dirty tabs show a dot
// until hover. Overflow (tabs exceed the row) reveals a CaretDown menu listing
// every open tab. Closing a dirty tab asks for confirmation first.

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { DropdownMenu } from 'radix-ui';
import { ArrowsInSimple, ArrowsOutSimple, CaretDown, Circle, CornersIn, X } from '@phosphor-icons/react';
import { keys } from '../../../api/keys';
import { getEntry, listEntryTypes } from '../../../api/endpoints';
import { useWorkspaceStore, selectWorkspace } from '../../../stores/workspaceStore';
import { useDraftStore, useIsDirty } from '../../../stores/draftStore';
import { isDraftDirty } from '../entry/edit/draft';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { IconButton } from '../../../components/IconButton';
import { WorldIcon } from '../../../components/icons/WorldIcon';
import { TID } from '../../../testids';
import { useShellChromeControls } from '../../shell/ShellChromeContext';
import styles from './TabBar.module.css';

function Tab({
  entryId,
  active,
  onSelect,
  onClose,
}: {
  entryId: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const dirty = useIsDirty(entryId);
  const { data: entry } = useQuery({ queryKey: keys.entry(entryId), queryFn: () => getEntry(entryId) });
  const { data: types } = useQuery({
    queryKey: worldId ? keys.entryTypes(worldId) : ['entry-types', 'none'],
    queryFn: () => listEntryTypes(worldId!),
    enabled: worldId !== null,
  });
  const type = types?.items.find((t) => t.slug === entry?.type);

  return (
    <div
      className={[styles.tab, active ? styles.active : ''].filter(Boolean).join(' ')}
      data-testid={TID.tab(entryId)}
    >
      <button type="button" className={styles.tabLabel} onClick={onSelect}>
        <WorldIcon iconName={type?.iconName} iconWeight={type?.iconWeight} size={13} />
        <span className={styles.tabTitle}>{entry?.title ?? '…'}</span>
      </button>
      <button
        type="button"
        className={styles.tabClose}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close tab"
        data-testid={TID.tabClose(entryId)}
      >
        {dirty ? <Circle size={8} weight="fill" className={styles.dirtyDot} /> : null}
        <X size={11} className={dirty ? styles.closeIconDirty : undefined} />
      </button>
    </div>
  );
}

export function TabBar() {
  const shellControls = useShellChromeControls();
  const openEntryIds = useWorkspaceStore((s) => selectWorkspace(s).openEntryIds);
  const activeEntryId = useWorkspaceStore((s) => selectWorkspace(s).activeEntryId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const queryClient = useQueryClient();

  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [openEntryIds.length]);

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
    ? (queryClient.getQueryData<{ title: string }>(keys.entry(pendingClose))?.title ?? 'this entry')
    : '';

  const fullscreenLabel = shellControls?.isFullscreen
    ? 'Exit fullscreen'
    : shellControls?.isFullscreenSupported
      ? 'Enter fullscreen'
      : 'Fullscreen unavailable in this browser';

  return (
    <div className={styles.bar}>
      <div className={styles.row} ref={rowRef}>
        {openEntryIds.map((id) => (
          <Tab
            key={id}
            entryId={id}
            active={id === activeEntryId}
            onSelect={() => setActiveTab(id)}
            onClose={() => requestClose(id)}
          />
        ))}
      </div>
      {shellControls?.isFocusMode && (
        <div className={styles.actions}>
          <IconButton
            label="Exit focus mode"
            onClick={shellControls.toggleFocus}
            active
            aria-pressed
            data-testid={TID.focusButton}
          >
            <CornersIn size={16} />
          </IconButton>
          <IconButton
            label={fullscreenLabel}
            onClick={shellControls.toggleFullscreen}
            active={shellControls.isFullscreen}
            aria-pressed={shellControls.isFullscreen}
            disabled={!shellControls.isFullscreenSupported}
            data-testid={TID.fullscreenButton}
          >
            {shellControls.isFullscreen ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
          </IconButton>
        </div>
      )}
      {overflowing && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={styles.overflowTrigger}
              aria-label="All open tabs"
              data-testid={TID.tabOverflowTrigger}
            >
              <CaretDown size={13} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={styles.overflowMenu} align="end" sideOffset={4}>
              {openEntryIds.map((id) => (
                <OverflowItem key={id} entryId={id} onSelect={() => setActiveTab(id)} />
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
  const { data: entry } = useQuery({ queryKey: keys.entry(entryId), queryFn: () => getEntry(entryId) });
  return (
    <DropdownMenu.Item
      className={styles.overflowItem}
      onSelect={onSelect}
      data-testid={TID.tabOverflowItem(entryId)}
    >
      {entry?.title ?? '…'}
    </DropdownMenu.Item>
  );
}
