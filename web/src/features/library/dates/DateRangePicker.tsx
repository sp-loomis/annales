// Cascading date picker. Walks the calendar's params coarsest → finest; each
// level's valid domain comes from the shared engine (`options`), so dynamic
// domains (variable month length, leap days) resolve correctly. The user can
// stop early (partial date) or drop the finest level to widen precision.

import { X } from "@phosphor-icons/react";
import type { CompiledCalendar, DateTuple, ParamOptions } from "@calendar";
import type { CalendarDefinition, NamedValueDef } from "../../../api/types";
import { options as resolveOptions } from "./calendarClient";
import { IconButton } from "../../../components/IconButton";
import { useScaledPx } from "../../../theme/ui-scale";
import styles from "./Dates.module.css";

interface Row {
  level: number;
  name: string;
  opt: Exclude<ParamOptions, { param: null }>;
  chosen: number | string | undefined;
}

function displayMap(def: CalendarDefinition, paramName: string): Map<string, string> {
  const param = def.params.find((p) => p.name === paramName);
  const map = new Map<string, string>();
  for (const v of param?.values ?? []) {
    const def_: NamedValueDef = v;
    if (typeof def_ === "string") map.set(def_, def_);
    else map.set(def_.value, def_.display ?? def_.value);
  }
  return map;
}

export function DateRangePicker({
  cal,
  def,
  value,
  onChange,
}: {
  cal: CompiledCalendar;
  def: CalendarDefinition;
  value: DateTuple;
  onChange: (next: DateTuple) => void;
}) {
  const dropIconSize = useScaledPx(11);

  // Build the visible rows: every already-chosen level plus one trailing
  // unbound slot. Stops if a domain fails to resolve (defensive; shouldn't
  // happen because switches reproject to valid tuples).
  const rows: Row[] = [];
  let prefix: DateTuple = {};
  for (let i = 0; i < cal.params.length; i++) {
    let opt: ParamOptions;
    try {
      opt = resolveOptions(cal, prefix);
    } catch {
      break;
    }
    if (opt.param === null) break;
    const chosen = value[opt.param];
    rows.push({ level: i, name: opt.param, opt, chosen });
    if (chosen === undefined) break;
    prefix = { ...prefix, [opt.param]: chosen };
  }

  const deepestSet = [...rows].reverse().find((r) => r.chosen !== undefined);

  function setAt(level: number, name: string, v: number | string | undefined) {
    const next: DateTuple = {};
    for (const p of cal.params.slice(0, level)) {
      if (value[p.name] !== undefined) next[p.name] = value[p.name];
    }
    if (v !== undefined) next[name] = v;
    onChange(next);
  }

  return (
    <div className={styles.picker}>
      {rows.map((row) => {
        const canDrop =
          row.chosen !== undefined && row.level > 0 && deepestSet?.name === row.name;
        return (
          <div key={row.name} className={styles.pickerRow}>
            <label className={styles.pickerLabel}>{row.name}</label>
            {row.opt.kind === "named" ? (
              <NamedField
                def={def}
                paramName={row.name}
                values={row.opt.values}
                chosen={row.chosen as string | undefined}
                onPick={(v) => setAt(row.level, row.name, v)}
              />
            ) : (
              <NumberField
                opt={row.opt}
                chosen={row.chosen as number | undefined}
                onPick={(v) => setAt(row.level, row.name, v)}
              />
            )}
            {canDrop && (
              <IconButton
                label={`Remove ${row.name}`}
                className={styles.pickerDrop}
                onClick={() => setAt(row.level, row.name, undefined)}>
                <X size={dropIconSize} />
              </IconButton>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NamedField({
  def,
  paramName,
  values,
  chosen,
  onPick,
}: {
  def: CalendarDefinition;
  paramName: string;
  values: string[];
  chosen: string | undefined;
  onPick: (v: string | undefined) => void;
}) {
  const displays = displayMap(def, paramName);
  return (
    <select
      className={styles.pickerControl}
      value={chosen ?? ""}
      onChange={(e) => onPick(e.target.value === "" ? undefined : e.target.value)}>
      <option value="">— add {paramName} —</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {displays.get(v) ?? v}
        </option>
      ))}
    </select>
  );
}

function NumberField({
  opt,
  chosen,
  onPick,
}: {
  opt: { from: number | null; to: number | null };
  chosen: number | undefined;
  onPick: (v: number | undefined) => void;
}) {
  const min = opt.from !== null && opt.to !== null ? Math.min(opt.from, opt.to) : undefined;
  const max = opt.from !== null && opt.to !== null ? Math.max(opt.from, opt.to) : undefined;
  return (
    <input
      type="number"
      className={styles.pickerControl}
      value={chosen ?? ""}
      min={min}
      max={max}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onPick(undefined);
        const n = Number.parseInt(raw, 10);
        if (Number.isNaN(n)) return;
        if (min !== undefined && n < min) return;
        if (max !== undefined && n > max) return;
        onPick(n);
      }}
    />
  );
}
