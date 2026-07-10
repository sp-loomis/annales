// Sidebar data flow. Two sources:
//  - Browse: the drained entries list (GET /worlds/:id/entries, all pages) —
//    the search endpoint 400s with zero filters, and it has no sort param, so
//    browse-mode sort/group/type-filtering happen client-side.
//  - Search: GET /worlds/:id/search when a text query or tag filter is set
//    (server AND-filters tags, ranks text hits, returns <b> snippets). The
//    endpoint's `type` param is single-valued, so type multi-select is always
//    applied client-side over either source.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { keys } from '../../../api/keys';
import { listAllEntries, search } from '../../../api/endpoints';
import type { EntrySummary, SearchMatch, SidebarPrefs } from '../../../api/types';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';

export interface SidebarItem {
  entryId: string;
  title: string;
  /** EntryType slug. */
  type: string;
  tags: string[];
  updatedAt: string | null;
  matches: SearchMatch[];
}

export function useEntriesQuery(worldId: string | null) {
  return useQuery({
    queryKey: worldId ? keys.entries(worldId) : ['entries', 'none'],
    queryFn: () => listAllEntries(worldId!),
    enabled: worldId !== null,
  });
}

export function useSidebarData(worldId: string | null, prefs: SidebarPrefs) {
  const query = useDebouncedValue(prefs.query.trim(), 250);
  const searchActive = query.length > 0 || prefs.tags.length > 0;

  const entriesQuery = useEntriesQuery(worldId);

  const searchQuery = useQuery({
    queryKey: worldId
      ? keys.search(worldId, { q: query, tags: prefs.tags })
      : ['search', 'none'],
    queryFn: () =>
      search(worldId!, {
        q: query || undefined,
        tags: prefs.tags,
        limit: 200,
      }),
    enabled: worldId !== null && searchActive,
  });

  const byId = useMemo(() => {
    const m = new Map<string, EntrySummary>();
    for (const e of entriesQuery.data ?? []) m.set(e.id, e);
    return m;
  }, [entriesQuery.data]);

  const items = useMemo<SidebarItem[]>(() => {
    let base: SidebarItem[];
    if (searchActive) {
      const fromSearch: SidebarItem[] = (searchQuery.data?.items ?? []).map((r) => {
        const summary = byId.get(r.entryId);
        return {
          entryId: r.entryId,
          title: r.title,
          type: r.type,
          tags: summary?.tags ?? [],
          updatedAt: summary?.updatedAt ?? null,
          matches: r.matches,
        };
      });
      // The backend indexes section/artifact text only — titles never reach
      // SearchIndex — so title hits are matched client-side over the drained
      // entries list and merged in front of the FTS results.
      const q = query.toLowerCase();
      const seen = new Set(fromSearch.map((i) => i.entryId));
      const titleHits: SidebarItem[] =
        q.length > 0
          ? (entriesQuery.data ?? [])
              .filter(
                (e) =>
                  e.title.toLowerCase().includes(q) &&
                  !seen.has(e.id) &&
                  prefs.tags.every((t) => e.tags.includes(t))
              )
              .map((e) => ({
                entryId: e.id,
                title: e.title,
                type: e.type,
                tags: e.tags,
                updatedAt: e.updatedAt,
                matches: [],
              }))
          : [];
      base = [...titleHits, ...fromSearch];
    } else {
      base = (entriesQuery.data ?? []).map((e) => ({
        entryId: e.id,
        title: e.title,
        type: e.type,
        tags: e.tags,
        updatedAt: e.updatedAt,
        matches: [],
      }));
    }

    if (prefs.typeSlugs.length > 0) {
      const allowed = new Set(prefs.typeSlugs);
      base = base.filter((i) => allowed.has(i.type));
    }

    // Ranked text search keeps API order under the default sort.
    const rankOrdered = searchActive && query.length > 0 && prefs.sort === 'updated';
    if (!rankOrdered) {
      base = [...base].sort((a, b) => {
        switch (prefs.sort) {
          case 'title-asc':
            return a.title.localeCompare(b.title);
          case 'title-desc':
            return b.title.localeCompare(a.title);
          case 'updated':
          default:
            return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
        }
      });
    }
    return base;
  }, [
    searchActive,
    searchQuery.data,
    entriesQuery.data,
    byId,
    prefs.typeSlugs,
    prefs.tags,
    prefs.sort,
    query,
  ]);

  /** Tag universe for the filter panel, derived from all entries in the world. */
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const e of entriesQuery.data ?? []) for (const t of e.tags) s.add(t);
    return [...s].sort();
  }, [entriesQuery.data]);

  return {
    items,
    allTags,
    searchActive,
    textQueryActive: query.length > 0,
    isLoading: searchActive ? searchQuery.isLoading : entriesQuery.isLoading,
    isError: searchActive ? searchQuery.isError : entriesQuery.isError,
  };
}
