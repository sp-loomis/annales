// The Dates section: sits between an entry's main content and its Relations.
// Renders each date range as a card showing its label and its own-calendar
// rendering (pretty/short per the range's stored style). A caret expands the
// same instant across sibling calendars on the timeline; calendars where the
// tick is out of range are marked. Edit mode adds remove + click-to-edit + an
// add control. Date-range mutations are immediate (not Save-deferred).

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarBlank, CaretDown, CaretRight, X } from "@phosphor-icons/react";
import { keys } from "../../../api/keys";
import { deleteDateRange } from "../../../api/endpoints";
import type { DateRangeMeta, EntryDetail } from "../../../api/types";
import { IconButton } from "../../../components/IconButton";
import { TID } from "../../../testids";
import { useScaledPx } from "../../../theme/ui-scale";
import { useWorldCalendars, type WorldCalendars } from "./useWorldCalendars";
import { compile, expand, format } from "./calendarClient";
import { DateRangePopover } from "./DateRangePopover";
import styles from "./Dates.module.css";

export function DateRangeBlock({
  entry,
  editable = false,
}: {
  entry: EntryDetail;
  editable?: boolean;
}) {
  const headerIconSize = useScaledPx(14);
  const wc = useWorldCalendars(entry.worldId);
  const ranges = entry.dateRanges;

  // Nothing to show and not editing: omit the section entirely.
  if (ranges.length === 0 && !editable) return null;

  return (
    <section className={styles.block}>
      <div className={styles.header}>
        <CalendarBlank size={headerIconSize} />
        <span>Dates</span>
        {editable && <DateRangePopover entry={entry} />}
      </div>
      {ranges.length === 0 ? (
        <p className={styles.empty}>
          No dates yet. Anchor this entry to a moment on a timeline.
        </p>
      ) : (
        <div className={styles.cards}>
          {ranges.map((range) => (
            <DateRangeCard
              key={range.id}
              entry={entry}
              range={range}
              wc={wc}
              editable={editable}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DateRangeCard({
  entry,
  range,
  wc,
  editable,
}: {
  entry: EntryDetail;
  range: DateRangeMeta;
  wc: WorldCalendars;
  editable: boolean;
}) {
  const caretSize = useScaledPx(12);
  const removeIconSize = useScaledPx(12);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const calendar = wc.byId.get(range.calendarId);
  const compiled = calendar ? compile(calendar.definition) : null;
  const primary =
    compiled?.cal && format(compiled.cal, range.rawComponents, range.displayStyle);

  const remove = useMutation({
    mutationFn: () => deleteDateRange(range.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.entry(entry.id) }),
  });

  const dateText = primary ?? "Unrenderable date";
  const subtitle = range.label ?? calendar?.name ?? "";

  const mainLine = (
    <>
      <span className={styles.cardTitle}>{dateText}</span>
      {subtitle && <span className={styles.cardSub}>{subtitle}</span>}
    </>
  );

  return (
    <div className={styles.card} data-testid={TID.dateRangeCard(range.id)}>
      <div className={styles.cardTop}>
        {editable ? (
          <DateRangePopover entry={entry} editing={range}>
            <button type="button" className={styles.cardBody}>
              {mainLine}
            </button>
          </DateRangePopover>
        ) : (
          <button
            type="button"
            className={styles.cardBody}
            onClick={() => setExpanded((v) => !v)}>
            {mainLine}
          </button>
        )}
        <div className={styles.cardActions}>
          <IconButton
            label={expanded ? "Collapse calendars" : "Show in other calendars"}
            className={styles.caret}
            onClick={() => setExpanded((v) => !v)}
            data-testid={TID.dateRangeExpand(range.id)}>
            {expanded ? <CaretDown size={caretSize} /> : <CaretRight size={caretSize} />}
          </IconButton>
          {editable && (
            <IconButton
              label="Remove date range"
              className={styles.remove}
              onClick={() => remove.mutate()}
              data-testid={TID.dateRangeRemove(range.id)}>
              <X size={removeIconSize} />
            </IconButton>
          )}
        </div>
      </div>
      {expanded && (
        <CrossCalendarList range={range} wc={wc} ownDisplayStyle={range.displayStyle} />
      )}
    </div>
  );
}

function CrossCalendarList({
  range,
  wc,
  ownDisplayStyle,
}: {
  range: DateRangeMeta;
  wc: WorldCalendars;
  ownDisplayStyle: "pretty" | "short";
}) {
  const siblings = wc.siblings(range.calendarId);
  if (siblings.length === 0) {
    return <p className={styles.crossHint}>No other calendars on this timeline.</p>;
  }
  if (range.tickStart === null) {
    return <p className={styles.crossHint}>Open-ended date — cannot align across calendars.</p>;
  }
  return (
    <ul className={styles.cross}>
      {siblings.map((sib) => {
        const compiled = compile(sib.definition);
        let text: string;
        let out = false;
        if (!compiled.cal) {
          text = "invalid calendar";
          out = true;
        } else {
          const e = expand(compiled.cal, range.tickStart!);
          if (e.outOfRange) {
            text = "out of range";
            out = true;
          } else {
            text = ownDisplayStyle === "pretty" ? e.pretty : e.short;
          }
        }
        return (
          <li key={sib.id} className={styles.crossRow}>
            <span className={styles.crossName}>{sib.name}</span>
            <span className={out ? styles.crossOut : styles.crossValue}>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}
