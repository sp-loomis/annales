// World Settings → Calendars. Calendars nest under a timeline; a lightweight
// selector (auto-creates a default) chooses the parent. Each calendar opens a
// wide editor dialog (definition form + live tester). Delete surfaces the
// IN_USE guard when date ranges reference the calendar.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash, PencilSimple } from "@phosphor-icons/react";
import { keys } from "../../api/keys";
import {
  createCalendar,
  createTimeline,
  deleteCalendar,
  listCalendars,
  listTimelines,
  patchTimeline,
} from "../../api/endpoints";
import { ApiError } from "../../api/client";
import type { Calendar } from "../../api/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Button } from "../../components/Button";
import { TextInput } from "../../components/TextInput";
import { IconButton } from "../../components/IconButton";
import { Dialog, DialogContent } from "../../components/Dialog";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { TID } from "../../testids";
import { TEMPLATES } from "./calendar/templates";
import { CalendarEditor } from "./calendar/CalendarEditor";
import styles from "./SettingsPanels.module.css";
import calStyles from "./calendar/Calendars.module.css";

export function CalendarsPanel() {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const queryClient = useQueryClient();
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState(TEMPLATES[0].key);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<Calendar | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Calendar | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: timelines } = useQuery({
    queryKey: worldId ? keys.timelines(worldId) : ["timelines", "none"],
    queryFn: () => listTimelines(worldId!),
    enabled: worldId !== null,
  });

  const createDefaultTimeline = useMutation({
    mutationFn: () => createTimeline(worldId!, { name: "Primary" }),
    onSuccess: (t) => {
      setTimelineId(t.id);
      queryClient.invalidateQueries({ queryKey: keys.timelines(worldId!) });
    },
  });

  // Auto-create a default timeline the first time a world has none.
  useEffect(() => {
    if (!worldId || !timelines) return;
    if (timelines.items.length === 0) {
      if (!createDefaultTimeline.isPending) createDefaultTimeline.mutate();
    } else if (timelineId === null || !timelines.items.some((t) => t.id === timelineId)) {
      setTimelineId(timelines.items[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, timelines]);

  const addTimeline = useMutation({
    mutationFn: () => createTimeline(worldId!, { name: `Timeline ${(timelines?.items.length ?? 0) + 1}` }),
    onSuccess: (t) => {
      setTimelineId(t.id);
      queryClient.invalidateQueries({ queryKey: keys.timelines(worldId!) });
    },
  });

  const renameTimeline = useMutation({
    mutationFn: (name: string) => patchTimeline(timelineId!, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.timelines(worldId!) }),
  });

  const { data: calendars } = useQuery({
    queryKey: timelineId ? keys.calendars(timelineId) : ["calendars", "none"],
    queryFn: () => listCalendars(timelineId!),
    enabled: timelineId !== null,
  });

  const create = useMutation({
    mutationFn: () => {
      const template = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0];
      return createCalendar(timelineId!, { name: newName.trim(), definition: template.definition });
    },
    onSuccess: (c) => {
      setNewName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: keys.calendars(timelineId!) });
      setEditing(c);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Create failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCalendar(id),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: keys.calendars(timelineId!) });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === "IN_USE"
          ? "Calendar is used by existing date ranges and cannot be deleted."
          : "Delete failed"
      ),
  });

  const selectedTimeline = useMemo(
    () => timelines?.items.find((t) => t.id === timelineId) ?? null,
    [timelines, timelineId]
  );

  if (!worldId) return null;

  return (
    <div className={styles.panel}>
      {/* timeline selector */}
      <div className={calStyles.timelineBar}>
        <label className={styles.hint}>Timeline</label>
        <select
          className={calStyles.timelineSelect}
          value={timelineId ?? ""}
          onChange={(e) => setTimelineId(e.target.value)}
          data-testid={TID.timelineSelect}>
          {(timelines?.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {selectedTimeline && (
          <TextInput
            className={calStyles.timelineName}
            defaultValue={selectedTimeline.name}
            key={selectedTimeline.id}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== selectedTimeline.name) renameTimeline.mutate(name);
            }}
          />
        )}
        <Button variant="ghost" onClick={() => addTimeline.mutate()} data-testid={TID.timelineAdd}>
          New timeline
        </Button>
      </div>

      {/* calendar list */}
      <div className={styles.rows}>
        {(calendars?.items ?? []).map((c) => (
          <div key={c.id} className={styles.row} data-testid={TID.calendarRow(c.id)}>
            <span className={calStyles.calName}>{c.name}</span>
            <span className={calStyles.spacer} />
            <IconButton
              label="Edit calendar"
              onClick={() => setEditing(c)}
              data-testid={TID.calendarEdit(c.id)}>
              <PencilSimple size={14} />
            </IconButton>
            <IconButton
              label="Delete calendar"
              onClick={() => setPendingDelete(c)}
              data-testid={TID.calendarDelete(c.id)}>
              <Trash size={14} />
            </IconButton>
          </div>
        ))}
        {calendars && calendars.items.length === 0 && (
          <p className={styles.hint}>No calendars yet. Pick a template and add one.</p>
        )}
      </div>

      {/* add calendar */}
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim() && timelineId) create.mutate();
        }}>
        <TextInput
          placeholder="New calendar name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select
          className={calStyles.timelineSelect}
          value={templateKey}
          onChange={(e) => setTemplateKey(e.target.value)}>
          {TEMPLATES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={!newName.trim() || !timelineId} data-testid={TID.calendarAdd}>
          Add
        </Button>
      </form>
      {error && <p className={styles.error}>{error}</p>}

      {/* editor dialog */}
      <Dialog.Root open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && timelineId && (
          <DialogContent title={`Edit calendar — ${editing.name}`} wide testId="calendar-editor">
            <CalendarEditor
              calendar={editing}
              timelineId={timelineId}
              onClose={() => setEditing(null)}
            />
          </DialogContent>
        )}
      </Dialog.Root>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete "${pendingDelete?.name}"?`}
        description="The calendar definition will be permanently deleted."
        confirmLabel="Delete calendar"
        danger
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
