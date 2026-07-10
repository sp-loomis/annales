import { DslError, type Bindings, type NamedValue, type Value } from '../dsl/index.js';
import { CalendarError, type CompiledCalendar, type CompiledDerived } from './types.js';
import { bindParam, describeScope, emptyScope, resolveParamDomain } from './order.js';
import type { DateTuple } from './engine.js';

export type DerivedValues = Record<string, number | boolean | string>;

interface BoundDate {
  bindings: Bindings;
  /** Deepest bound level. */
  level: number;
  /** Active domain per bound Named param, for default short ordinals. */
  actives: Map<string, string[]>;
}

/** Bind a validated contiguous prefix, resolving each level's domain. */
function bindDate(cal: CompiledCalendar, date: DateTuple): BoundDate {
  let b = emptyScope(cal);
  const actives = new Map<string, string[]>();
  let level = -1;
  for (const param of cal.params) {
    const value = date[param.name];
    if (value === undefined) break;
    const dom = resolveParamDomain(param, b);
    if (dom.kind === 'named') {
      if (typeof value !== 'string' || !dom.active.includes(value)) {
        throw new CalendarError(
          `'${param.name}' value ${JSON.stringify(value)} is not in its domain at ${describeScope(b)}`
        );
      }
      actives.set(param.name, dom.active);
    } else if (typeof value !== 'number') {
      throw new CalendarError(`'${param.name}' value must be a number`);
    }
    b = bindParam(b, param, value, dom);
    level = param.level;
  }
  if (level === -1) throw new CalendarError('cannot format an empty date');
  return { bindings: b, level, actives };
}

function evalDerivedField(
  cal: CompiledCalendar,
  field: CompiledDerived,
  b: Bindings
): Value {
  let result: Value;
  try {
    result = field.rule.evaluate(b);
  } catch (err) {
    if (err instanceof DslError) {
      throw new CalendarError(`derived field '${field.name}' is undefined here: ${err.message}`);
    }
    throw err;
  }
  if (field.type !== 'named') return result;
  if (typeof result === 'number') {
    // A Number result indexes the declared values, 0-based.
    const value = field.values![result];
    if (value === undefined) {
      throw new CalendarError(
        `derived field '${field.name}' evaluated to index ${result}, outside its ${field.values!.length} declared values`
      );
    }
    return { domain: field.name, value } satisfies NamedValue;
  }
  return { domain: field.name, value: (result as NamedValue).value } satisfies NamedValue;
}

/**
 * Derived field values for a full date tuple. `tick` is the date's tickStart
 * (full tuples are always finite).
 */
export function computeDerived(
  cal: CompiledCalendar,
  date: DateTuple,
  tick: number
): DerivedValues {
  const bound = bindDate(cal, date);
  if (bound.level !== cal.params.length - 1) {
    throw new CalendarError('derived fields are only defined for full date tuples');
  }
  const b: Bindings = {
    values: new Map(bound.bindings.values),
    activeDomains: bound.bindings.activeDomains,
    displays: bound.bindings.displays,
  };
  b.values.set('tick', tick);
  const out: DerivedValues = {};
  for (const field of cal.derived) {
    const v = evalDerivedField(cal, field, b);
    out[field.name] = typeof v === 'object' && v !== null ? (v as NamedValue).value : (v as number | boolean | string);
  }
  return out;
}

/**
 * Render a date prefix in a style. `tick` (the date's tickStart) is required
 * only when a terminal-level rule uses a tick-derived field.
 */
export function formatDate(
  cal: CompiledCalendar,
  date: DateTuple,
  style: 'pretty' | 'short',
  tick?: number | null
): string {
  const bound = bindDate(cal, date);
  const rules = style === 'pretty' ? cal.formatPretty : cal.formatShort;
  const rule = rules.get(bound.level);

  if (!rule) {
    // Defaults: pretty = space-separated display names; short = slash-separated
    // ordinals (1-based, against the active domain).
    const parts: string[] = [];
    for (const param of cal.params.slice(0, bound.level + 1)) {
      const value = date[param.name];
      if (param.type === 'named') {
        if (style === 'pretty') {
          parts.push(cal.displays.get(param.name)?.get(value as string) ?? (value as string));
        } else {
          parts.push(String(bound.actives.get(param.name)!.indexOf(value as string) + 1));
        }
      } else {
        parts.push(String(value));
      }
    }
    return parts.join(style === 'pretty' ? ' ' : '/');
  }

  const b: Bindings = {
    values: new Map(bound.bindings.values),
    activeDomains: new Map(bound.bindings.activeDomains),
    displays: bound.bindings.displays,
  };
  // Materialize just the derived fields this rule references.
  for (const field of cal.derived) {
    if (!rule.deps.perVar.has(field.name)) continue;
    const db: Bindings = { values: new Map(b.values), activeDomains: b.activeDomains, displays: b.displays };
    if (field.usesTick) {
      if (typeof tick !== 'number') {
        throw new CalendarError(
          `formatting this date needs its tick to compute derived field '${field.name}'`
        );
      }
      db.values.set('tick', tick);
    }
    b.values.set(field.name, evalDerivedField(cal, field, db));
    if (field.type === 'named') b.activeDomains.set(field.name, field.values!);
  }
  try {
    const result = rule.evaluate(b);
    if (typeof result !== 'string') {
      throw new CalendarError(`format rule did not produce a string`);
    }
    return result;
  } catch (err) {
    if (err instanceof DslError) {
      throw new CalendarError(`format rule is undefined here: ${err.message}`);
    }
    throw err;
  }
}
