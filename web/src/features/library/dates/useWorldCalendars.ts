// Loads every calendar in a world (across all its timelines) so date-range
// cards can render and expand across sibling calendars. One aggregate query,
// cached under keys.worldCalendars.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys } from "../../../api/keys";
import { listCalendars, listTimelines } from "../../../api/endpoints";
import type { Calendar, Timeline } from "../../../api/types";

export interface WorldCalendars {
  timelines: Timeline[];
  calendars: Calendar[];
  byId: Map<string, Calendar>;
  /** Calendars sharing a timeline with `calendarId` (excludes it). */
  siblings: (calendarId: string) => Calendar[];
  /** Calendars on a given timeline. */
  onTimeline: (timelineId: string) => Calendar[];
}

async function fetchWorldCalendars(worldId: string): Promise<{
  timelines: Timeline[];
  calendars: Calendar[];
}> {
  const timelines = (await listTimelines(worldId)).items;
  const perTimeline = await Promise.all(timelines.map((t) => listCalendars(t.id)));
  return { timelines, calendars: perTimeline.flatMap((p) => p.items) };
}

export function useWorldCalendars(worldId: string | null) {
  const query = useQuery({
    queryKey: worldId ? keys.worldCalendars(worldId) : ["worlds", "none", "all-calendars"],
    queryFn: () => fetchWorldCalendars(worldId!),
    enabled: worldId !== null,
  });

  const value = useMemo<WorldCalendars>(() => {
    const timelines = query.data?.timelines ?? [];
    const calendars = query.data?.calendars ?? [];
    const byId = new Map(calendars.map((c) => [c.id, c]));
    return {
      timelines,
      calendars,
      byId,
      onTimeline: (timelineId: string) => calendars.filter((c) => c.timelineId === timelineId),
      siblings: (calendarId: string) => {
        const cal = byId.get(calendarId);
        if (!cal) return [];
        return calendars.filter((c) => c.timelineId === cal.timelineId && c.id !== calendarId);
      },
    };
  }, [query.data]);

  return { ...value, isLoading: query.isLoading };
}
