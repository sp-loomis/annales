// Per-entry edit buffers. Drafts live here (not in component state) so they
// survive tab switches/unmounts, and so the beforeunload guard and tab-close
// dialogs can read dirtiness outside React.

import { create } from 'zustand';
import type { EntryDetail } from '../api/types';
import {
  draftFromDetail,
  isDraftDirty,
  type EntryDraft,
} from '../features/library/entry/edit/draft';

interface DraftStore {
  drafts: Record<string, EntryDraft>;
  startDraft: (detail: EntryDetail) => void;
  updateDraft: (entryId: string, updater: (d: EntryDraft) => EntryDraft) => void;
  dropDraft: (entryId: string) => void;
}

export const useDraftStore = create<DraftStore>((set) => ({
  drafts: {},

  startDraft: (detail) =>
    set((s) => ({ drafts: { ...s.drafts, [detail.id]: draftFromDetail(detail) } })),

  updateDraft: (entryId, updater) =>
    set((s) => {
      const draft = s.drafts[entryId];
      if (!draft) return s;
      return { drafts: { ...s.drafts, [entryId]: updater(draft) } };
    }),

  dropDraft: (entryId) =>
    set((s) => {
      const { [entryId]: _dropped, ...rest } = s.drafts;
      return { drafts: rest };
    }),
}));

export function isEntryDirty(entryId: string): boolean {
  const draft = useDraftStore.getState().drafts[entryId];
  return draft ? isDraftDirty(draft) : false;
}

export function anyEntryDirty(): boolean {
  return Object.values(useDraftStore.getState().drafts).some(isDraftDirty);
}

/** Reactive dirty selector for one entry. */
export const useIsDirty = (entryId: string) =>
  useDraftStore((s) => {
    const d = s.drafts[entryId];
    return d ? isDraftDirty(d) : false;
  });

/** Reactive any-dirty selector (drives the beforeunload registration). */
export const useAnyDirty = () => useDraftStore((s) => Object.values(s.drafts).some(isDraftDirty));
