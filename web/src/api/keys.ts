// Query-key factory. Every useQuery/invalidate goes through these so cache
// scoping stays consistent.

export const keys = {
  worlds: ['worlds'] as const,
  world: (worldId: string) => ['worlds', worldId] as const,
  entryTypes: (worldId: string) => ['worlds', worldId, 'entry-types'] as const,
  relationTypes: (worldId: string) => ['worlds', worldId, 'relation-types'] as const,
  entries: (worldId: string) => ['worlds', worldId, 'entries'] as const,
  entry: (entryId: string) => ['entries', entryId] as const,
  search: (worldId: string, params: Record<string, unknown>) =>
    ['worlds', worldId, 'search', params] as const,
  theme: (worldId: string) => ['worlds', worldId, 'theme'] as const,
  workspace: (worldId: string) => ['worlds', worldId, 'workspace-state'] as const,
  artifact: (kind: string, id: string) => ['artifacts', kind, id] as const,
  timelines: (worldId: string) => ['worlds', worldId, 'timelines'] as const,
  calendars: (timelineId: string) => ['timelines', timelineId, 'calendars'] as const,
  worldCalendars: (worldId: string) => ['worlds', worldId, 'all-calendars'] as const,
};
