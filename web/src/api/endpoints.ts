// Typed endpoint functions, one section per backend route module.

import { del, get, patch, post, put } from "./client";
import type {
  ArtifactDetail,
  ArtifactWithUpload,
  Calendar,
  CalendarConvertResult,
  CalendarDefinition,
  DateRangeMeta,
  EntryDetail,
  EntrySummary,
  EntryType,
  Page,
  PMNode,
  RelationRow,
  RelationType,
  SearchResult,
  Section,
  Timeline,
  World,
  WorkspaceStateDto,
  WorldTheme,
} from "./types";

// ---- worlds ----

export const listWorlds = () => get<Page<World>>("/worlds");
export const createWorld = (name: string) => post<World>("/worlds", { name });
export const renameWorld = (worldId: string, name: string) =>
  patch<World>(`/worlds/${worldId}`, { name });
export const deleteWorld = (worldId: string) => del(`/worlds/${worldId}`);

// ---- entry types ----

export const listEntryTypes = (worldId: string) =>
  get<Page<EntryType>>(`/worlds/${worldId}/entry-types`);
export const createEntryType = (
  worldId: string,
  body: { name: string; slug: string; iconName?: string | null; iconWeight?: string | null }
) => post<EntryType>(`/worlds/${worldId}/entry-types`, body);
export const patchEntryType = (
  id: string,
  body: Partial<Pick<EntryType, "name" | "slug" | "iconName" | "iconWeight">>
) => patch<EntryType>(`/entry-types/${id}`, body);
export const deleteEntryType = (id: string) => del(`/entry-types/${id}`);

// ---- relation types ----

export const listRelationTypes = (worldId: string) =>
  get<Page<RelationType>>(`/worlds/${worldId}/relation-types`);
export const createRelationType = (
  worldId: string,
  body: {
    name: string;
    inverseName?: string | null;
    iconName?: string | null;
    iconWeight?: string | null;
  }
) => post<RelationType>(`/worlds/${worldId}/relation-types`, body);
export const patchRelationType = (
  id: string,
  body: Partial<Pick<RelationType, "name" | "inverseName" | "iconName" | "iconWeight">>
) => patch<RelationType>(`/relation-types/${id}`, body);
export const deleteRelationType = (id: string) => del(`/relation-types/${id}`);

// ---- entries ----

export const createEntry = (
  worldId: string,
  body: { type: string; title: string; tags?: string[] }
) => post<EntrySummary>(`/worlds/${worldId}/entries`, body);

export async function listAllEntries(worldId: string): Promise<EntrySummary[]> {
  const items: EntrySummary[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: "200" });
    if (cursor) qs.set("cursor", cursor);
    const page: Page<EntrySummary> = await get(`/worlds/${worldId}/entries?${qs}`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export const getEntry = (entryId: string) => get<EntryDetail>(`/entries/${entryId}`);
export const patchEntry = (entryId: string, body: { type?: string; title?: string }) =>
  patch<EntrySummary>(`/entries/${entryId}`, body);
export const putEntryTags = (entryId: string, tags: string[]) =>
  put<{ tags: string[] }>(`/entries/${entryId}/tags`, { tags });
export const deleteEntry = (entryId: string) => del(`/entries/${entryId}`);

// ---- sections ----

export const createSection = (entryId: string) =>
  post<Section & { entryId: string }>(`/entries/${entryId}/sections`, {});
export const patchSection = (id: string, body: { contentJson?: PMNode; order?: number }) =>
  patch<Section & { entryId: string }>(`/sections/${id}`, body);
export const deleteSection = (id: string) => del(`/sections/${id}`);

// ---- artifacts (images / sketches) ----

export type UploadKind = "images" | "sketches";

export const createArtifact = (
  kind: UploadKind,
  entryId: string,
  body: { label?: string | null; contentType?: string }
) => post<ArtifactWithUpload>(`/entries/${entryId}/${kind}`, body);
export const artifactUploadUrl = (kind: UploadKind, id: string) =>
  post<ArtifactWithUpload>(`/${kind}/${id}/upload-url`);
export const finalizeArtifact = (kind: UploadKind, id: string) =>
  post<ArtifactDetail>(`/${kind}/${id}/finalize`);
export const getArtifact = (kind: UploadKind, id: string) => get<ArtifactDetail>(`/${kind}/${id}`);
export const patchArtifact = (
  kind: UploadKind,
  id: string,
  body: { label?: string | null; order?: number }
) => patch<ArtifactDetail>(`/${kind}/${id}`, body);
export const deleteArtifact = (kind: UploadKind, id: string) => del(`/${kind}/${id}`);

/**
 * PUT bytes to a presigned URL (absolute, outside the /api proxy).
 * Uses XHR so upload progress is observable.
 */
export function uploadToPresigned(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error("upload failed: network error"));
    xhr.send(body);
  });
}

// ---- relations ----

export const createRelation = (body: { fromId: string; toId: string; typeId: string }) =>
  post<RelationRow>("/relations", body);
export const deleteRelation = (id: string) => del(`/relations/${id}`);

// ---- date ranges ----

export interface DateRangeInput {
  calendarId: string;
  rawComponents: Record<string, number | string>;
  precisionTier?: string;
  label?: string | null;
  displayStyle?: "pretty" | "short";
}

export const createDateRange = (entryId: string, body: DateRangeInput) =>
  post<DateRangeMeta>(`/entries/${entryId}/date-ranges`, { precisionTier: "exact", ...body });
export const patchDateRange = (id: string, body: Partial<DateRangeInput>) =>
  patch<DateRangeMeta>(`/date-ranges/${id}`, body);
export const deleteDateRange = (id: string) => del(`/date-ranges/${id}`);

// ---- search ----

export interface SearchParams {
  q?: string;
  type?: string;
  tags?: string[];
  limit?: number;
}

export function search(worldId: string, params: SearchParams): Promise<Page<SearchResult>> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.type) qs.set("type", params.type);
  for (const tag of params.tags ?? []) qs.append("tag", tag);
  qs.set("limit", String(params.limit ?? 200));
  return get(`/worlds/${worldId}/search?${qs}`);
}

// ---- timelines ----

export const listTimelines = (worldId: string) =>
  get<Page<Timeline>>(`/worlds/${worldId}/timelines`);
export const createTimeline = (worldId: string, body: { name: string; params?: object | null }) =>
  post<Timeline>(`/worlds/${worldId}/timelines`, body);
export const patchTimeline = (id: string, body: { name?: string; params?: object | null }) =>
  patch<Timeline>(`/timelines/${id}`, body);
export const deleteTimeline = (id: string) => del(`/timelines/${id}`);

// ---- calendars ----

export const listCalendars = (timelineId: string) =>
  get<Page<Calendar>>(`/timelines/${timelineId}/calendars`);
export const createCalendar = (
  timelineId: string,
  body: { name: string; definition: CalendarDefinition }
) => post<Calendar>(`/timelines/${timelineId}/calendars`, body);
export const patchCalendar = (
  id: string,
  body: { name?: string; definition?: CalendarDefinition }
) => patch<Calendar>(`/calendars/${id}`, body);
export const deleteCalendar = (id: string) => del(`/calendars/${id}`);

/** Server-side tick↔date conversion + rendering (exact engine parity). */
export const convertCalendar = (id: string, body: { tick: number } | { date: object }) =>
  post<CalendarConvertResult>(`/calendars/${id}/convert`, body);

// ---- theme / workspace state ----

export const getTheme = (worldId: string) => get<WorldTheme>(`/worlds/${worldId}/theme`);
export const putTheme = (worldId: string, body: Partial<Omit<WorldTheme, "worldId">>) =>
  put<WorldTheme>(`/worlds/${worldId}/theme`, body);

export const getWorkspaceState = (worldId: string) =>
  get<WorkspaceStateDto>(`/worlds/${worldId}/workspace-state`);
export const putWorkspaceState = (
  worldId: string,
  body: { openEntryIds?: string[]; sidebarState?: object | null }
) => put<WorkspaceStateDto>(`/worlds/${worldId}/workspace-state`, body);
