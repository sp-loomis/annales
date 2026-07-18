// Client-side calendar evaluation via the shared engine (`@calendar`), the same
// code the server runs — exact parity (see TestPanel.tsx). Lets the date-range
// UI cascade pickers, render pretty/short, and expand a tick across sibling
// calendars without any /convert round-trips. Compilation is memoized per
// definition object identity.

import {
  CalendarError,
  compileCalendar,
  dateToTicks,
  formatDate,
  paramOptions,
  tickToDate,
  type CompiledCalendar,
  type DateTuple,
  type ParamOptions,
} from "@calendar";
import type { CalendarDefinition } from "../../../api/types";

const cache = new WeakMap<object, CompiledResult>();

type CompiledResult = { cal: CompiledCalendar; error: null } | { cal: null; error: string };

/** Compile (memoized). Never throws — returns an error string on bad definitions. */
export function compile(def: CalendarDefinition): CompiledResult {
  const key = def as unknown as object;
  const hit = cache.get(key);
  if (hit) return hit;
  let result: CompiledResult;
  try {
    result = { cal: compileCalendar(def), error: null };
  } catch (err) {
    result = { cal: null, error: err instanceof CalendarError ? err.message : "Invalid calendar" };
  }
  cache.set(key, result);
  return result;
}

/** Render a (possibly partial) date prefix. Returns null if it can't be formatted. */
export function format(
  cal: CompiledCalendar,
  raw: DateTuple,
  style: "pretty" | "short"
): string | null {
  try {
    const ticks = dateToTicks(cal, raw);
    return formatDate(cal, raw, style, ticks.tickStart);
  } catch {
    return null;
  }
}

export type Expansion =
  | { outOfRange: true }
  | { outOfRange: false; pretty: string; short: string };

/** Render the instant at `tick` in this calendar; out-of-range → flagged. */
export function expand(cal: CompiledCalendar, tick: number): Expansion {
  try {
    const date = tickToDate(cal, tick);
    const ticks = dateToTicks(cal, date);
    return {
      outOfRange: false,
      pretty: formatDate(cal, date, "pretty", ticks.tickStart),
      short: formatDate(cal, date, "short", ticks.tickStart),
    };
  } catch {
    return { outOfRange: true };
  }
}

/** Domain of the next unbound param, given the chosen prefix. Drives the picker. */
export function options(cal: CompiledCalendar, prefix: DateTuple): ParamOptions {
  return paramOptions(cal, prefix);
}

function epochTuple(cal: CompiledCalendar): DateTuple {
  const out: DateTuple = {};
  for (const p of cal.params) {
    const v = cal.epoch.get(p.name);
    out[p.name] = typeof v === "object" && v !== null ? (v as { value: number | string }).value : (v as number | string);
  }
  return out;
}

/**
 * Reproject a partial date onto a different calendar, preserving the instant:
 * take the old date's minimum tick, convert to a full tuple in the new calendar,
 * then truncate to the original precision (the user can drop finer params).
 * If the tick lies outside the new calendar's range, falls back to its epoch
 * (`clamped: true`).
 */
export function reproject(
  oldCal: CompiledCalendar,
  raw: DateTuple,
  newCal: CompiledCalendar
): { date: DateTuple; clamped: boolean } {
  const depth = Object.keys(raw).length;
  const truncate = (full: DateTuple): DateTuple => {
    const out: DateTuple = {};
    for (const p of newCal.params.slice(0, Math.min(depth, newCal.params.length))) {
      out[p.name] = full[p.name];
    }
    return out;
  };
  try {
    const tick = dateToTicks(oldCal, raw).tickStart;
    if (tick === null) return { date: truncate(epochTuple(newCal)), clamped: true };
    return { date: truncate(tickToDate(newCal, tick)), clamped: false };
  } catch {
    return { date: truncate(epochTuple(newCal)), clamped: true };
  }
}
