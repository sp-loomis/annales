// Full-calendar editor shown in a wide dialog: name + structured definition
// form on the left, live tester on the right. Draft lives here; Save PATCHes
// the calendar (server recompiles + recomputes dependent date-range ticks, so
// definition errors and dependent-range breakage surface here).

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "../../../api/keys";
import { patchCalendar } from "../../../api/endpoints";
import { ApiError } from "../../../api/client";
import type { Calendar, CalendarDefinition } from "../../../api/types";
import { Button } from "../../../components/Button";
import { TextInput } from "../../../components/TextInput";
import { TID } from "../../../testids";
import { DefinitionForm } from "./DefinitionForm";
import { TestPanel } from "./TestPanel";
import styles from "./Calendars.module.css";

export function CalendarEditor({
  calendar,
  timelineId,
  onClose,
}: {
  calendar: Calendar;
  timelineId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(calendar.name);
  const [draft, setDraft] = useState<CalendarDefinition>(calendar.definition);
  const [saved, setSaved] = useState<CalendarDefinition>(calendar.definition);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== calendar.name || JSON.stringify(draft) !== JSON.stringify(saved);

  const save = useMutation({
    mutationFn: () =>
      patchCalendar(calendar.id, {
        ...(name !== calendar.name ? { name } : {}),
        definition: draft,
      }),
    onSuccess: () => {
      setSaved(draft);
      setError(null);
      queryClient.invalidateQueries({ queryKey: keys.calendars(timelineId) });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed"),
  });

  return (
    <div className={styles.editor}>
      <div className={styles.editorHead}>
        <TextInput
          className={styles.nameInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid={TID.calendarName}
        />
        <span className={styles.spacer} />
        <Button
          variant="primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
          data-testid={TID.calendarSave}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.editorBody}>
        <div className={styles.editorForm}>
          <DefinitionForm def={draft} onChange={setDraft} />
        </div>
        <div className={styles.editorTest}>
          <TestPanel def={draft} calendarId={calendar.id} dirty={dirty} />
        </div>
      </div>
    </div>
  );
}
