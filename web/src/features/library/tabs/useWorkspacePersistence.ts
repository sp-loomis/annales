// Per-world workspace persistence. On world activation: fetch the saved
// state and hydrate the store (a `hydrating` flag suppresses echo-writes).
// Afterwards: subscribe to tab/sidebar changes outside React, debounce 750ms,
// PUT /workspace-state. Pending writes flush on world switch/unmount.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../../../api/keys";
import { getWorkspaceState, putWorkspaceState } from "../../../api/endpoints";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import { isTempEntryId } from "../entry/tempEntry";

const DEBOUNCE_MS = 750;

export function useWorkspacePersistence() {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    let timer: number | null = null;
    let lastSerialized: string | null = null;

    const payloadFor = (id: string) => {
      const ws = useWorkspaceStore.getState().byWorld[id];
      if (!ws) return null;
      return {
        openEntryIds: ws.openEntryIds.filter((entryId) => !isTempEntryId(entryId)),
        sidebarState: ws.sidebar,
      };
    };

    useWorkspaceStore.getState().setHydrating(true);
    queryClient
      .fetchQuery({
        queryKey: keys.workspace(worldId),
        queryFn: () => getWorkspaceState(worldId),
        staleTime: 0,
      })
      .then((dto) => {
        if (cancelled) return;
        useWorkspaceStore.getState().hydrateFromServer(worldId, dto);
        lastSerialized = JSON.stringify(payloadFor(worldId));
      })
      .catch(() => {
        // Offline or deleted world: keep local defaults, skip autosave baseline.
      })
      .finally(() => {
        if (!cancelled) useWorkspaceStore.getState().setHydrating(false);
      });

    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      if (state.hydrating || state.activeWorldId !== worldId) return;
      const payload = payloadFor(worldId);
      if (!payload) return;
      const serialized = JSON.stringify(payload);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      if (timer !== null) clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        putWorkspaceState(worldId, payload).catch(() => {});
      }, DEBOUNCE_MS);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (timer !== null) {
        clearTimeout(timer);
        const payload = payloadFor(worldId);
        if (payload) putWorkspaceState(worldId, payload).catch(() => {});
      }
    };
  }, [worldId, queryClient]);
}
