import type { Bindings, NamedValue } from '../dsl/index.js';
import { CalendarError, type CompiledCalendar, type CompiledParam } from './types.js';
import {
  bindParam,
  describeScope,
  emptyScope,
  evalUnitTicks,
  numberInDomain,
  resolveParamDomain,
  type ResolvedDomain,
  type ResolvedNumber,
} from './order.js';
import { classifyLevel } from './period.js';

export interface Ticks {
  tickStart: number | null;
  tickEnd: number | null;
}

export type DateTuple = Record<string, number | string>;

/** Tier-2 direct summation refuses to walk further than this from its anchor. */
const SUM_ITERATION_CAP = 5_000_000;

function addSafe(a: number, b: number): number {
  const r = a + b;
  if (!Number.isSafeInteger(r)) {
    throw new CalendarError('tick arithmetic exceeds the supported range (±2^53 − 1)');
  }
  return r;
}

function mulSafe(a: number, b: number): number {
  const r = a * b;
  if (!Number.isSafeInteger(r)) {
    throw new CalendarError('tick arithmetic exceeds the supported range (±2^53 − 1)');
  }
  return r;
}

// ---------------------------------------------------------------------------
// Widths — always positive tick magnitudes over the tick-order index (§4/§5).
// ---------------------------------------------------------------------------

/**
 * Width in ticks of one unit at `level`; `b` binds params[0..level].
 * Returns null when the unit is unbounded (an open descendant range).
 */
export function widthOfUnit(cal: CompiledCalendar, level: number, b: Bindings): number | null {
  const last = cal.params.length - 1;
  if (level === last) return evalUnitTicks(cal.params[last], b);
  const child = cal.params[level + 1];
  const dom = resolveParamDomain(child, b);
  if (dom.kind === 'named') {
    let sum = 0;
    for (const v of dom.active) {
      const w = widthOfUnit(cal, level + 1, bindParam(b, child, v, dom));
      if (w === null) return null;
      sum = addSafe(sum, w);
    }
    return sum;
  }
  if (dom.from === null || dom.to === null) return null;
  return sumLabelRange(cal, level + 1, b, dom, Math.min(dom.from, dom.to), Math.max(dom.from, dom.to));
}

/**
 * Σ widths of the number units at `childLevel` whose labels lie in lo..hi
 * (inclusive). Order is irrelevant to a sum, so label direction never matters.
 * Closed forms per tier; Tier 2 walks term by term.
 */
function sumLabelRange(
  cal: CompiledCalendar,
  childLevel: number,
  parentB: Bindings,
  dom: ResolvedNumber,
  lo: number,
  hi: number
): number {
  if (lo > hi) return 0;
  const child = cal.params[childLevel];
  const widthAt = (label: number): number => {
    const w = widthOfUnit(cal, childLevel, bindParam(parentB, child, label, dom));
    if (w === null) {
      throw new CalendarError(
        `internal: unit '${child.name}=${label}' at ${describeScope(parentB)} is unbounded mid-range`
      );
    }
    return w;
  };
  const count = hi - lo + 1;
  const tier = classifyLevel(cal.params, childLevel);
  if (tier.t === 0) {
    return mulSafe(widthAt(lo), count);
  }
  if (tier.t === 1) {
    const period = tier.period;
    const base: number[] = [];
    let cycleSum = 0;
    for (let i = 0; i < Math.min(period, count); i++) {
      const w = widthAt(lo + i);
      base.push(w);
      cycleSum = addSafe(cycleSum, w);
    }
    if (count <= period) return cycleSum;
    const cycles = Math.floor(count / period);
    const rem = count % period;
    let total = mulSafe(cycleSum, cycles);
    for (let i = 0; i < rem; i++) total = addSafe(total, base[i]);
    return total;
  }
  if (count > SUM_ITERATION_CAP) {
    throw new CalendarError(
      `'${child.name}' range of ${count} units is too far to sum on demand (its width rule is not detectably periodic)`
    );
  }
  let total = 0;
  for (let label = lo; label <= hi; label++) total = addSafe(total, widthAt(label));
  return total;
}

// ---------------------------------------------------------------------------
// Tick-order positioning within a resolved domain.
// ---------------------------------------------------------------------------

/** Monotone tick-order key for a value (comparison only). */
function tickPos(dom: ResolvedDomain, value: number | string): number {
  if (dom.kind === 'named') return dom.tickOrdered.indexOf(value as string);
  return (value as number) * dom.step;
}

/** Σ widths of the units strictly before `value` in tick order; null = infinite. */
function sumBefore(
  cal: CompiledCalendar,
  level: number,
  parentB: Bindings,
  dom: ResolvedDomain,
  value: number | string
): number | null {
  if (dom.kind === 'named') {
    const idx = dom.tickOrdered.indexOf(value as string);
    let sum = 0;
    for (const v of dom.tickOrdered.slice(0, idx)) {
      const w = widthOfUnit(cal, level, bindParam(parentB, cal.params[level], v, dom));
      if (w === null) return null;
      sum = addSafe(sum, w);
    }
    return sum;
  }
  if (dom.from === null) return null;
  const v = value as number;
  const [lo, hi] = dom.step === 1 ? [dom.from, v - 1] : [v + 1, dom.from];
  return sumLabelRange(cal, level, parentB, dom, lo, hi);
}

/** Σ widths of the units strictly after `value` in tick order; null = infinite. */
function sumAfter(
  cal: CompiledCalendar,
  level: number,
  parentB: Bindings,
  dom: ResolvedDomain,
  value: number | string
): number | null {
  if (dom.kind === 'named') {
    const idx = dom.tickOrdered.indexOf(value as string);
    let sum = 0;
    for (const v of dom.tickOrdered.slice(idx + 1)) {
      const w = widthOfUnit(cal, level, bindParam(parentB, cal.params[level], v, dom));
      if (w === null) return null;
      sum = addSafe(sum, w);
    }
    return sum;
  }
  if (dom.to === null) return null;
  const v = value as number;
  const [lo, hi] = dom.step === 1 ? [v + 1, dom.to] : [dom.to, v - 1];
  return sumLabelRange(cal, level, parentB, dom, lo, hi);
}

/** Σ widths of the units strictly between two values (exclusive both ends). */
function sumBetween(
  cal: CompiledCalendar,
  level: number,
  parentB: Bindings,
  dom: ResolvedDomain,
  a: number | string,
  b: number | string
): number {
  if (dom.kind === 'named') {
    const ia = dom.tickOrdered.indexOf(a as string);
    const ib = dom.tickOrdered.indexOf(b as string);
    const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
    let sum = 0;
    for (const v of dom.tickOrdered.slice(lo + 1, hi)) {
      const w = widthOfUnit(cal, level, bindParam(parentB, cal.params[level], v, dom));
      if (w === null) {
        throw new CalendarError(`internal: unit strictly between two others is unbounded`);
      }
      sum = addSafe(sum, w);
    }
    return sum;
  }
  const na = a as number;
  const nb = b as number;
  return sumLabelRange(cal, level, parentB, dom, Math.min(na, nb) + 1, Math.max(na, nb) - 1);
}

// ---------------------------------------------------------------------------
// date → ticks
// ---------------------------------------------------------------------------

interface PrefixEntry {
  param: CompiledParam;
  value: number | string;
  dom: ResolvedDomain;
  scope: Bindings; // scope BEFORE binding this level
}

/** Validate rawComponents as a contiguous top-down prefix; resolve each domain. */
function readPrefix(cal: CompiledCalendar, raw: Record<string, unknown>): PrefixEntry[] {
  const keys = new Set(Object.keys(raw));
  if (keys.size === 0) {
    throw new CalendarError('rawComponents must bind at least the top-level param');
  }
  for (const key of keys) {
    if (!cal.params.some((p) => p.name === key)) {
      throw new CalendarError(`rawComponents binds unknown param '${key}'`);
    }
  }
  const depth = keys.size;
  const entries: PrefixEntry[] = [];
  let scope = emptyScope(cal);
  for (let level = 0; level < depth; level++) {
    const param = cal.params[level];
    if (!keys.has(param.name)) {
      throw new CalendarError(
        `rawComponents must be a contiguous prefix of the schema — '${param.name}' is missing`
      );
    }
    const value = raw[param.name];
    const dom = resolveParamDomain(param, scope);
    if (dom.kind === 'named') {
      if (typeof value !== 'string' || !dom.active.includes(value)) {
        throw new CalendarError(
          `'${param.name}' value ${JSON.stringify(value)} is not in its domain at ${describeScope(scope)}`
        );
      }
      entries.push({ param, value, dom, scope });
      scope = bindParam(scope, param, value, dom);
    } else {
      if (typeof value !== 'number' || !numberInDomain(dom, value)) {
        throw new CalendarError(
          `'${param.name}' value ${JSON.stringify(value)} is outside its domain at ${describeScope(scope)}`
        );
      }
      entries.push({ param, value, dom, scope });
      scope = bindParam(scope, param, value, dom);
    }
  }
  return entries;
}

function epochValueAt(cal: CompiledCalendar, level: number): number | string {
  const v = cal.epoch.get(cal.params[level].name)!;
  return typeof v === 'object' ? (v as NamedValue).value : (v as number);
}

function sameValue(a: number | string, b: number | string): boolean {
  return a === b;
}

/**
 * Tick of the start/end boundary of the unit denoted by a prefix, relative to
 * the epoch (tick 0 = start of the epoch's terminal unit). Null = unbounded.
 */
function boundaryOffset(
  cal: CompiledCalendar,
  prefix: PrefixEntry[],
  side: 'start' | 'end'
): number | null {
  const last = cal.params.length - 1;
  const depth = prefix.length;
  let j = 0;
  while (j < depth && sameValue(prefix[j].value, epochValueAt(cal, j))) j++;

  if (j === depth) {
    // The prefix unit contains the epoch's terminal unit.
    let scope = depth > 0 ? bindParam(prefix[depth - 1].scope, prefix[depth - 1].param, prefix[depth - 1].value, prefix[depth - 1].dom) : emptyScope(cal);
    let total = 0;
    for (let k = depth; k <= last; k++) {
      const param = cal.params[k];
      const dom = resolveParamDomain(param, scope);
      const value = epochValueAt(cal, k);
      const part =
        side === 'start'
          ? sumBefore(cal, k, scope, dom, value)
          : sumAfter(cal, k, scope, dom, value);
      if (part === null) return null;
      total = addSafe(total, part);
      scope = bindParam(scope, param, value, dom);
    }
    if (side === 'start') return total === 0 ? 0 : -total;
    return addSafe(total, evalUnitTicks(cal.params[last], scope));
  }

  // Diverged at level j: prefix[j] and the epoch are sibling units.
  const at = prefix[j];
  const posP = tickPos(at.dom, at.value);
  const posE = tickPos(at.dom, epochValueAt(cal, j));
  const between = sumBetween(cal, j, at.scope, at.dom, at.value, epochValueAt(cal, j));
  const boundScope = (entry: PrefixEntry) => bindParam(entry.scope, entry.param, entry.value, entry.dom);

  if (posP > posE) {
    // Target is tick-later. Distance tick0 → end(epoch unit at level j):
    let scope = bindParam(at.scope, cal.params[j], epochValueAt(cal, j), at.dom);
    let total = 0;
    for (let k = j + 1; k <= last; k++) {
      const param = cal.params[k];
      const dom = resolveParamDomain(param, scope);
      const value = epochValueAt(cal, k);
      const after = sumAfter(cal, k, scope, dom, value);
      if (after === null) {
        throw new CalendarError('internal: open bound below a non-extremal epoch unit');
      }
      total = addSafe(total, after);
      scope = bindParam(scope, param, value, dom);
    }
    total = addSafe(total, evalUnitTicks(cal.params[last], scope));
    total = addSafe(total, between);
    // … then down the target path to the bound unit's start.
    for (let k = j + 1; k < depth; k++) {
      const before = sumBefore(cal, k, prefix[k].scope, prefix[k].dom, prefix[k].value);
      if (before === null) {
        throw new CalendarError('internal: open bound below a non-tick-first unit');
      }
      total = addSafe(total, before);
    }
    if (side === 'start') return total;
    const w = widthOfUnit(cal, depth - 1, boundScope(prefix[depth - 1]));
    return w === null ? null : addSafe(total, w);
  }

  // Target is tick-earlier. Distance start(epoch unit at level j) → tick0:
  let scope = bindParam(at.scope, cal.params[j], epochValueAt(cal, j), at.dom);
  let total = 0;
  for (let k = j + 1; k <= last; k++) {
    const param = cal.params[k];
    const dom = resolveParamDomain(param, scope);
    const value = epochValueAt(cal, k);
    const before = sumBefore(cal, k, scope, dom, value);
    if (before === null) {
      throw new CalendarError('internal: open bound below a non-extremal epoch unit');
    }
    total = addSafe(total, before);
    scope = bindParam(scope, param, value, dom);
  }
  total = addSafe(total, between);
  // … then from the target unit's boundary up to the end of prefix[j]'s unit.
  for (let k = j + 1; k < depth; k++) {
    const after = sumAfter(cal, k, prefix[k].scope, prefix[k].dom, prefix[k].value);
    if (after === null) {
      throw new CalendarError('internal: open bound below a non-tick-last unit');
    }
    total = addSafe(total, after);
  }
  if (side === 'end') return total === 0 ? 0 : -total;
  const w = widthOfUnit(cal, depth - 1, boundScope(prefix[depth - 1]));
  return w === null ? null : -addSafe(total, w);
}

/** Convert a rawComponents prefix to its tick interval [tickStart, tickEnd). */
export function dateToTicks(cal: CompiledCalendar, raw: Record<string, unknown>): Ticks {
  const prefix = readPrefix(cal, raw);
  return {
    tickStart: boundaryOffset(cal, prefix, 'start'),
    tickEnd: boundaryOffset(cal, prefix, 'end'),
  };
}

// ---------------------------------------------------------------------------
// tick → date
// ---------------------------------------------------------------------------

interface Located {
  value: number | string;
  start: number | null;
  end: number | null;
}

/**
 * Walk the units of `level` (in scope `parentB`) to find the one containing
 * `tick`, starting from an anchor unit with a known boundary.
 */
function locate(
  cal: CompiledCalendar,
  level: number,
  parentB: Bindings,
  dom: ResolvedDomain,
  anchor: Located,
  tick: number
): Located {
  const param = cal.params[level];
  const width = (value: number | string): number | null =>
    widthOfUnit(cal, level, bindParam(parentB, param, value, dom));

  const inAnchor =
    (anchor.start === null || tick >= anchor.start) && (anchor.end === null || tick < anchor.end);
  if (inAnchor) return anchor;

  if (anchor.end !== null && tick >= anchor.end) {
    return walkForward(cal, level, parentB, dom, anchor, tick, width);
  }
  if (anchor.start === null) {
    throw new CalendarError('internal: tick below an unbounded start');
  }
  return walkBackward(cal, level, parentB, dom, anchor, tick, width);
}

function nextValue(dom: ResolvedDomain, value: number | string, dir: 1 | -1): number | string | undefined {
  if (dom.kind === 'named') {
    const idx = dom.tickOrdered.indexOf(value as string) + dir;
    return dom.tickOrdered[idx];
  }
  const label = (value as number) + dom.step * dir;
  const limit = dir === 1 ? dom.to : dom.from;
  if (limit !== null && (label - limit) * dom.step * dir > 0) return undefined;
  return label;
}

function outOfRange(tick: number): never {
  throw new CalendarError(`tick ${tick} is outside this calendar's defined range`);
}

function walkForward(
  cal: CompiledCalendar,
  level: number,
  _parentB: Bindings,
  dom: ResolvedDomain,
  anchor: Located,
  tick: number,
  width: (v: number | string) => number | null
): Located {
  let cur = anchor.end!;
  let value = nextValue(dom, anchor.value, 1);

  // Closed-form jump for periodic/constant number levels.
  if (dom.kind === 'number' && value !== undefined) {
    const tier = classifyLevel(cal.params, level);
    if (tier.t === 0 || tier.t === 1) {
      const period = tier.t === 0 ? 1 : tier.period;
      let cycleSum = 0;
      const widths: number[] = [];
      let probe: number | string | undefined = value;
      for (let i = 0; i < period && probe !== undefined; i++) {
        const w = width(probe);
        if (w === null) break; // open unit ahead — fall through to the linear walk
        widths.push(w);
        cycleSum = addSafe(cycleSum, w);
        probe = nextValue(dom, probe, 1);
      }
      if (widths.length === period && tick - cur >= cycleSum) {
        let cycles = Math.floor((tick - cur) / cycleSum);
        // Never jump past the tick-order-last label (`to`).
        if (dom.to !== null) {
          const remainingUnits = Math.abs(dom.to - (value as number)) + 1;
          cycles = Math.min(cycles, Math.floor(remainingUnits / period));
        }
        if (cycles > 0) {
          cur = addSafe(cur, mulSafe(cycleSum, cycles));
          const jumped = (value as number) + dom.step * period * cycles;
          if (dom.to !== null && (jumped - dom.to) * dom.step > 0) outOfRange(tick);
          value = jumped;
        }
      }
    }
  }

  for (let steps = 0; ; steps++) {
    if (steps > SUM_ITERATION_CAP) {
      throw new CalendarError(`tick ${tick} is too far from the epoch to convert on demand`);
    }
    if (value === undefined) outOfRange(tick);
    const w = width(value);
    if (w === null) return { value, start: cur, end: null };
    const end = addSafe(cur, w);
    if (tick < end) return { value, start: cur, end };
    cur = end;
    value = nextValue(dom, value, 1);
  }
}

function walkBackward(
  cal: CompiledCalendar,
  level: number,
  _parentB: Bindings,
  dom: ResolvedDomain,
  anchor: Located,
  tick: number,
  width: (v: number | string) => number | null
): Located {
  let cur = anchor.start!;
  let value = nextValue(dom, anchor.value, -1);

  if (dom.kind === 'number' && value !== undefined) {
    const tier = classifyLevel(cal.params, level);
    if (tier.t === 0 || tier.t === 1) {
      const period = tier.t === 0 ? 1 : tier.period;
      let cycleSum = 0;
      const widths: number[] = [];
      let probe: number | string | undefined = value;
      for (let i = 0; i < period && probe !== undefined; i++) {
        const w = width(probe);
        if (w === null) break;
        widths.push(w);
        cycleSum = addSafe(cycleSum, w);
        probe = nextValue(dom, probe, -1);
      }
      if (widths.length === period && cur - tick > cycleSum) {
        let cycles = Math.floor((cur - tick - 1) / cycleSum);
        // Never jump past the tick-order-first label (`from`).
        if (dom.from !== null) {
          const remainingUnits = Math.abs((value as number) - dom.from) + 1;
          cycles = Math.min(cycles, Math.floor(remainingUnits / period));
        }
        if (cycles > 0) {
          cur = addSafe(cur, -mulSafe(cycleSum, cycles));
          const jumped = (value as number) - dom.step * period * cycles;
          if (dom.from !== null && (dom.from - jumped) * dom.step > 0) outOfRange(tick);
          value = jumped;
        }
      }
    }
  }

  for (let steps = 0; ; steps++) {
    if (steps > SUM_ITERATION_CAP) {
      throw new CalendarError(`tick ${tick} is too far from the epoch to convert on demand`);
    }
    if (value === undefined) outOfRange(tick);
    const w = width(value);
    if (w === null) return { value, start: null, end: cur };
    const start = addSafe(cur, -w);
    if (tick >= start) return { value, start, end: cur };
    cur = start;
    value = nextValue(dom, value, -1);
  }
}

/** Convert a tick to the full date tuple containing it. */
export function tickToDate(cal: CompiledCalendar, tick: number): DateTuple {
  if (!Number.isSafeInteger(tick)) {
    throw new CalendarError('tick must be an integer within ±2^53 − 1');
  }
  const last = cal.params.length - 1;

  // Boundaries of each epoch-path unit, bottom-up from tick 0.
  let scope = emptyScope(cal);
  const epochDoms: ResolvedDomain[] = [];
  const epochScopes: Bindings[] = [];
  for (let k = 0; k <= last; k++) {
    const dom = resolveParamDomain(cal.params[k], scope);
    epochDoms.push(dom);
    epochScopes.push(scope);
    scope = bindParam(scope, cal.params[k], epochValueAt(cal, k), dom);
  }
  const starts: (number | null)[] = new Array(last + 1);
  const ends: (number | null)[] = new Array(last + 1);
  starts[last] = 0;
  ends[last] = evalUnitTicks(cal.params[last], scope);
  for (let k = last - 1; k >= 0; k--) {
    const before = sumBefore(cal, k + 1, epochScopes[k + 1], epochDoms[k + 1], epochValueAt(cal, k + 1));
    const after = sumAfter(cal, k + 1, epochScopes[k + 1], epochDoms[k + 1], epochValueAt(cal, k + 1));
    starts[k] = starts[k + 1] === null || before === null ? null : addSafe(starts[k + 1]!, -before);
    ends[k] = ends[k + 1] === null || after === null ? null : addSafe(ends[k + 1]!, after);
  }

  const date: DateTuple = {};
  let b = emptyScope(cal);
  let aligned = true;
  let parentStart: number | null = null;
  let parentEnd: number | null = null;
  for (let k = 0; k <= last; k++) {
    const param = cal.params[k];
    const dom = aligned ? epochDoms[k] : resolveParamDomain(param, b);
    let found: Located;
    if (aligned) {
      const anchor: Located = { value: epochValueAt(cal, k), start: starts[k], end: ends[k] };
      found = locate(cal, k, b, dom, anchor, tick);
      aligned = sameValue(found.value, anchor.value);
    } else if (parentStart !== null) {
      const first = dom.kind === 'named' ? dom.tickOrdered[0] : dom.from;
      if (first === null) throw new CalendarError('internal: open start inside a located unit');
      const w = widthOfUnit(cal, k, bindParam(b, param, first, dom));
      const anchor: Located = {
        value: first,
        start: parentStart,
        end: w === null ? null : addSafe(parentStart, w),
      };
      found = locate(cal, k, b, dom, anchor, tick);
    } else {
      const lastValue = dom.kind === 'named' ? dom.tickOrdered[dom.tickOrdered.length - 1] : dom.to;
      if (lastValue === null || parentEnd === null) {
        throw new CalendarError('internal: no closed boundary to walk from');
      }
      const w = widthOfUnit(cal, k, bindParam(b, param, lastValue, dom));
      const anchor: Located = {
        value: lastValue,
        start: w === null ? null : addSafe(parentEnd, -w),
        end: parentEnd,
      };
      found = locate(cal, k, b, dom, anchor, tick);
    }
    date[param.name] = found.value;
    b = bindParam(b, param, found.value, dom);
    parentStart = found.start;
    parentEnd = found.end;
  }
  return date;
}
