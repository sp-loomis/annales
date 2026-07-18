// Live tick↔date + rendering tester. Compiles the current draft in-browser via
// the shared engine (exact server parity), so it works on unsaved edits. An
// optional button re-runs the conversion against the saved calendar's /convert
// endpoint to confirm client/server agreement.

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CalendarError,
  compileCalendar,
  computeDerived,
  dateToTicks,
  formatDate,
  tickToDate,
  type CompiledCalendar,
  type DateTuple,
} from "@calendar";
import { convertCalendar } from "../../../api/endpoints";
import { ApiError } from "../../../api/client";
import type { CalendarConvertResult, CalendarDefinition } from "../../../api/types";
import { Button } from "../../../components/Button";
import { TextInput } from "../../../components/TextInput";
import { TID } from "../../../testids";
import styles from "./Calendars.module.css";

interface Rendered {
  date: DateTuple;
  tickStart: number | null;
  tickEnd: number | null;
  pretty: string;
  short: string;
  derived?: Record<string, number | boolean | string>;
}

function renderFull(cal: CompiledCalendar, date: DateTuple, tickStart: number | null): Rendered {
  const isFull = Object.keys(date).length === cal.params.length;
  return {
    date,
    tickStart,
    tickEnd: null,
    pretty: formatDate(cal, date, "pretty", tickStart),
    short: formatDate(cal, date, "short", tickStart),
    ...(isFull && tickStart !== null ? { derived: computeDerived(cal, date, tickStart) } : {}),
  };
}

function valueIds(param: CalendarDefinition["params"][number]): string[] {
  return (param.values ?? []).map((v) => (typeof v === "string" ? v : v.value));
}

export function TestPanel({
  def,
  calendarId,
  dirty,
}: {
  def: CalendarDefinition;
  calendarId: string | null;
  dirty: boolean;
}) {
  const compiled = useMemo(() => {
    try {
      return { cal: compileCalendar(def), error: null as string | null };
    } catch (err) {
      return { cal: null, error: err instanceof CalendarError ? err.message : String(err) };
    }
  }, [def]);

  const [tick, setTick] = useState("0");
  const [dateInputs, setDateInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Rendered | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [server, setServer] = useState<CalendarConvertResult | null>(null);

  const cal = compiled.cal;

  const runTick = () => {
    setServer(null);
    if (!cal) return;
    try {
      const date = tickToDate(cal, Number(tick));
      const ticks = dateToTicks(cal, date);
      setResult(renderFull(cal, date, ticks.tickStart));
      setRunError(null);
    } catch (err) {
      setResult(null);
      setRunError(err instanceof CalendarError ? err.message : String(err));
    }
  };

  const runDate = () => {
    setServer(null);
    if (!cal) return;
    // Contiguous top-down prefix: stop at the first empty param.
    const raw: Record<string, number | string> = {};
    for (const p of def.params) {
      const v = dateInputs[p.name];
      if (v === undefined || v === "") break;
      raw[p.name] = p.type === "named" ? v : Number(v);
    }
    try {
      const ticks = dateToTicks(cal, raw);
      const rendered = renderFull(cal, raw as DateTuple, ticks.tickStart);
      rendered.tickEnd = ticks.tickEnd;
      setResult(rendered);
      setRunError(null);
    } catch (err) {
      setResult(null);
      setRunError(err instanceof CalendarError ? err.message : String(err));
    }
  };

  const verify = useMutation({
    mutationFn: (body: { tick: number } | { date: object }) => convertCalendar(calendarId!, body),
    onSuccess: (r) => setServer(r),
    onError: (e) => setRunError(e instanceof ApiError ? e.message : "Server convert failed"),
  });

  return (
    <div className={styles.testPanel}>
      <h3 className={styles.sectionTitle}>Test</h3>

      {compiled.error ? (
        <p className={styles.error} data-testid={TID.testError}>
          {compiled.error}
        </p>
      ) : (
        <p className={styles.ok}>Definition compiles ✓</p>
      )}

      <div className={styles.testBlock}>
        <label className={styles.smallLabel}>Tick → date</label>
        <div className={styles.row}>
          <TextInput
            type="number"
            value={tick}
            onChange={(e) => setTick(e.target.value)}
            data-testid={TID.testTickInput}
          />
          <Button onClick={runTick} disabled={!cal} data-testid={TID.testTickRun}>
            Convert
          </Button>
        </div>
      </div>

      <div className={styles.testBlock}>
        <label className={styles.smallLabel}>Date → tick (leave finer params blank for a range)</label>
        {def.params.map((p) => (
          <div key={p.name} className={styles.field}>
            <label className={styles.smallLabel}>{p.name}</label>
            {p.type === "named" ? (
              <select
                className={styles.modeSelect}
                value={dateInputs[p.name] ?? ""}
                onChange={(e) => setDateInputs((s) => ({ ...s, [p.name]: e.target.value }))}>
                <option value="">—</option>
                {valueIds(p).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            ) : (
              <TextInput
                type="number"
                value={dateInputs[p.name] ?? ""}
                onChange={(e) => setDateInputs((s) => ({ ...s, [p.name]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <Button onClick={runDate} disabled={!cal} data-testid={TID.testDateRun}>
          Convert
        </Button>
      </div>

      {runError && (
        <p className={styles.error} data-testid={TID.testError}>
          {runError}
        </p>
      )}

      {result && (
        <div className={styles.result} data-testid={TID.testResult}>
          <dl className={styles.resultGrid}>
            <dt>pretty</dt>
            <dd>{result.pretty}</dd>
            <dt>short</dt>
            <dd>{result.short}</dd>
            <dt>tickStart</dt>
            <dd>{String(result.tickStart)}</dd>
            <dt>tickEnd</dt>
            <dd>{String(result.tickEnd)}</dd>
            <dt>date</dt>
            <dd>{JSON.stringify(result.date)}</dd>
            {result.derived && (
              <>
                <dt>derived</dt>
                <dd>{JSON.stringify(result.derived)}</dd>
              </>
            )}
          </dl>

          {calendarId && (
            <div className={styles.verifyRow}>
              <Button
                variant="ghost"
                disabled={dirty || verify.isPending}
                title={dirty ? "Save the calendar first to verify against the server" : undefined}
                onClick={() => {
                  const full = Object.keys(result.date).length === def.params.length;
                  verify.mutate(full ? { date: result.date } : { tick: Number(tick) });
                }}>
                Verify on server
              </Button>
              {server && (
                <span className={styles.ok}>
                  server: {server.pretty} / {server.short} · ticks {String(server.tickStart)}–
                  {String(server.tickEnd)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
