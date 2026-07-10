// Client workspace state: active world, per-world open tabs, per-world sidebar
// prefs. Persisted per world to /workspace-state (see useWorkspacePersistence);
// this store is the live source of truth while the app runs.

import { create } from 'zustand';
import type { Density, GroupBy, SidebarPrefs, SortMode } from '../api/types';

export const DEFAULT_SIDEBAR: SidebarPrefs = {
  query: '',
  typeSlugs: [],
  tags: [],
  sort: 'updated',
  groupBy: 'none',
  density: 'comfortable',
  filtersOpen: false,
};

export interface WorldWorkspace {
  openEntryIds: string[];
  activeEntryId: string | null;
  sidebar: SidebarPrefs;
}

const emptyWorkspace = (): WorldWorkspace => ({
  openEntryIds: [],
  activeEntryId: null,
  sidebar: { ...DEFAULT_SIDEBAR },
});

// Stable fallback for selectors: zustand v5 (useSyncExternalStore) requires
// snapshot-stable references — fabricating a fresh object per read loops.
const EMPTY_WORKSPACE: WorldWorkspace = Object.freeze({
  openEntryIds: Object.freeze([]) as unknown as string[],
  activeEntryId: null,
  sidebar: Object.freeze({ ...DEFAULT_SIDEBAR }) as SidebarPrefs,
});

interface WorkspaceStore {
  activeWorldId: string | null;
  /** True while restoring from the server — suppresses autosave echo-writes. */
  hydrating: boolean;
  byWorld: Record<string, WorldWorkspace>;

  setActiveWorld: (worldId: string | null) => void;
  hydrateFromServer: (
    worldId: string,
    dto: { openEntryIds: string[]; sidebarState: Partial<SidebarPrefs> | null }
  ) => void;
  setHydrating: (v: boolean) => void;

  openTab: (entryId: string) => void;
  closeTab: (entryId: string) => void;
  setActiveTab: (entryId: string) => void;

  setSidebar: (patch: Partial<SidebarPrefs>) => void;
}

function currentWorkspace(state: WorkspaceStore): WorldWorkspace {
  const id = state.activeWorldId;
  if (!id) return EMPTY_WORKSPACE;
  return state.byWorld[id] ?? EMPTY_WORKSPACE;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeWorldId: null,
  hydrating: false,
  byWorld: {},

  setActiveWorld: (worldId) =>
    set((s) => ({
      activeWorldId: worldId,
      // Ensure a real workspace entry exists so selectors read stored refs.
      byWorld:
        worldId && !s.byWorld[worldId]
          ? { ...s.byWorld, [worldId]: emptyWorkspace() }
          : s.byWorld,
    })),
  setHydrating: (v) => set({ hydrating: v }),

  hydrateFromServer: (worldId, dto) =>
    set((s) => ({
      byWorld: {
        ...s.byWorld,
        [worldId]: {
          openEntryIds: dto.openEntryIds,
          activeEntryId: dto.openEntryIds[0] ?? null,
          sidebar: { ...DEFAULT_SIDEBAR, ...(dto.sidebarState ?? {}) },
        },
      },
    })),

  openTab: (entryId) =>
    set((s) => {
      const worldId = s.activeWorldId;
      if (!worldId) return s;
      const ws = s.byWorld[worldId] ?? emptyWorkspace();
      const openEntryIds = ws.openEntryIds.includes(entryId)
        ? ws.openEntryIds
        : [...ws.openEntryIds, entryId];
      return {
        byWorld: { ...s.byWorld, [worldId]: { ...ws, openEntryIds, activeEntryId: entryId } },
      };
    }),

  closeTab: (entryId) =>
    set((s) => {
      const worldId = s.activeWorldId;
      if (!worldId) return s;
      const ws = s.byWorld[worldId] ?? emptyWorkspace();
      const idx = ws.openEntryIds.indexOf(entryId);
      const openEntryIds = ws.openEntryIds.filter((id) => id !== entryId);
      const activeEntryId =
        ws.activeEntryId === entryId
          ? (openEntryIds[Math.min(idx, openEntryIds.length - 1)] ?? null)
          : ws.activeEntryId;
      return {
        byWorld: { ...s.byWorld, [worldId]: { ...ws, openEntryIds, activeEntryId } },
      };
    }),

  setActiveTab: (entryId) =>
    set((s) => {
      const worldId = s.activeWorldId;
      if (!worldId) return s;
      const ws = s.byWorld[worldId] ?? emptyWorkspace();
      return { byWorld: { ...s.byWorld, [worldId]: { ...ws, activeEntryId: entryId } } };
    }),

  setSidebar: (patch) =>
    set((s) => {
      const worldId = s.activeWorldId;
      if (!worldId) return s;
      const ws = s.byWorld[worldId] ?? emptyWorkspace();
      return {
        byWorld: { ...s.byWorld, [worldId]: { ...ws, sidebar: { ...ws.sidebar, ...patch } } },
      };
    }),
}));

/** Selector for the active world's workspace (empty defaults when none). */
export const selectWorkspace = currentWorkspace;

export type { Density, GroupBy, SortMode };
