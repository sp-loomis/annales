// Add / edit a date range. Like relations, date-range mutations are immediate
// (not Save-deferred). Pick a timeline + calendar, build a (partial) date with
// the cascading picker, choose a display style, and see a live preview. On
// calendar switch the entered instant is reprojected onto the new calendar.

import { useMemo, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "@phosphor-icons/react";
import { keys } from "../../../api/keys";
import { createDateRange, patchDateRange } from "../../../api/endpoints";
import { ApiError } from "../../../api/client";
import type { DateRangeMeta, EntryDetail } from "../../../api/types";
import type { DateTuple } from "@calendar";
import { Button } from "../../../components/Button";
import { TextInput } from "../../../components/TextInput";
import { getOverlayContainer } from "../../../lib/overlay";
import { TID } from "../../../testids";
import { useScaledPx } from "../../../theme/ui-scale";
import { useWorldCalendars } from "./useWorldCalendars";
import { compile, format, reproject } from "./calendarClient";
import { DateRangePicker } from "./DateRangePicker";
import styles from "./Dates.module.css";

export function DateRangePopover({
  entry,
  editing,
  children,
}: {
  entry: EntryDetail;
  editing?: DateRangeMeta;
  /** Custom trigger (the card, in edit mode). Defaults to an "Add date range" button. */
  children?: ReactNode;
}) {
  const triggerIconSize = useScaledPx(12);
  const [open, setOpen] = useState(false);
  const portalContainer = getOverlayContainer();

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {children ?? (
          <Button variant="ghost" className={styles.addTrigger} data-testid={TID.dateRangeAdd}>
            <Plus size={triggerIconSize} />
            Add date range
          </Button>
        )}
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content className={styles.popover} sideOffset={6} align="end">
          {open && <DateRangeForm entry={entry} editing={editing} onDone={() => setOpen(false)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DateRangeForm({
  entry,
  editing,
  onDone,
}: {
  entry: EntryDetail;
  editing?: DateRangeMeta;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const wc = useWorldCalendars(entry.worldId);

  // Initial calendar/timeline: from the edited range, else first available.
  const initialCalendarId =
    editing?.calendarId ?? wc.calendars[0]?.id ?? "";
  const initialTimelineId =
    wc.byId.get(initialCalendarId)?.timelineId ?? wc.timelines[0]?.id ?? "";

  const [timelineId, setTimelineId] = useState(initialTimelineId);
  const [calendarId, setCalendarId] = useState(initialCalendarId);
  const [label, setLabel] = useState(editing?.label ?? "");
  const [raw, setRaw] = useState<DateTuple>({ ...(editing?.rawComponents ?? {}) });
  const [style, setStyle] = useState<"pretty" | "short">(editing?.displayStyle ?? "pretty");
  const [clamped, setClamped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep selections valid once calendars load (create mode with no initial pick).
  const effectiveTimelineId = timelineId || wc.timelines[0]?.id || "";
  const calendarsOnTimeline = wc.onTimeline(effectiveTimelineId);
  const effectiveCalendarId =
    calendarId && wc.byId.get(calendarId)?.timelineId === effectiveTimelineId
      ? calendarId
      : calendarsOnTimeline[0]?.id ?? "";

  const calendar = wc.byId.get(effectiveCalendarId);
  const compiled = useMemo(() => (calendar ? compile(calendar.definition) : null), [calendar]);

  const preview = useMemo(() => {
    if (!compiled?.cal || Object.keys(raw).length === 0) return null;
    return {
      pretty: format(compiled.cal, raw, "pretty"),
      short: format(compiled.cal, raw, "short"),
    };
  }, [compiled, raw]);

  function switchCalendar(nextCalendarId: string) {
    const nextCal = wc.byId.get(nextCalendarId);
    setClamped(false);
    setCalendarId(nextCalendarId);
    if (!nextCal) return;
    const nextCompiled = compile(nextCal.definition);
    if (compiled?.cal && nextCompiled.cal && Object.keys(raw).length > 0) {
      const r = reproject(compiled.cal, raw, nextCompiled.cal);
      setRaw(r.date);
      setClamped(r.clamped);
    } else {
      setRaw({});
    }
  }

  function switchTimeline(nextTimelineId: string) {
    setTimelineId(nextTimelineId);
    const first = wc.onTimeline(nextTimelineId)[0];
    if (first) switchCalendar(first.id);
  }

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        calendarId: effectiveCalendarId,
        rawComponents: raw,
        label: label.trim() || null,
        displayStyle: style,
      };
      return editing
        ? patchDateRange(editing.id, body)
        : createDateRange(entry.id, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.entry(entry.id) });
      setError(null);
      onDone();
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Could not save date range");
    },
  });

  if (wc.isLoading) {
    return <p className={styles.hint}>Loading calendars…</p>;
  }
  if (wc.calendars.length === 0) {
    return (
      <p className={styles.hint}>
        No calendars defined yet. Add one in World Settings → Calendars.
      </p>
    );
  }

  const canSubmit =
    !!effectiveCalendarId && Object.keys(raw).length > 0 && !mutation.isPending;

  return (
    <div className={styles.form}>
      <TextInput
        placeholder="Label (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        data-testid={TID.dateRangeLabelInput}
      />

      {wc.timelines.length > 1 && (
        <select
          className={styles.select}
          value={effectiveTimelineId}
          onChange={(e) => switchTimeline(e.target.value)}
          data-testid={TID.dateRangeTimelineSelect}>
          {wc.timelines.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      <select
        className={styles.select}
        value={effectiveCalendarId}
        onChange={(e) => switchCalendar(e.target.value)}
        data-testid={TID.dateRangeCalendarSelect}>
        {calendarsOnTimeline.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {compiled?.error && <p className={styles.error}>{compiled.error}</p>}

      {compiled?.cal && calendar && (
        <DateRangePicker
          cal={compiled.cal}
          def={calendar.definition}
          value={raw}
          onChange={(next) => {
            setRaw(next);
            setClamped(false);
          }}
        />
      )}

      {clamped && (
        <p className={styles.hint}>
          That instant falls outside this calendar's range — reset to its epoch.
        </p>
      )}

      <div className={styles.styleToggle} data-testid={TID.dateRangeStyleToggle}>
        <button
          type="button"
          className={style === "pretty" ? styles.styleActive : styles.styleOption}
          onClick={() => setStyle("pretty")}>
          Pretty
        </button>
        <button
          type="button"
          className={style === "short" ? styles.styleActive : styles.styleOption}
          onClick={() => setStyle("short")}>
          Short
        </button>
      </div>

      {preview && (
        <p className={styles.preview}>{(style === "pretty" ? preview.pretty : preview.short) ?? "—"}</p>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <Button
        variant="primary"
        disabled={!canSubmit}
        onClick={() => mutation.mutate()}
        data-testid={TID.dateRangeSubmit}>
        {editing ? "Save" : "Add"}
      </Button>
    </div>
  );
}
