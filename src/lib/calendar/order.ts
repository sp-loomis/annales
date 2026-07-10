import {
  DslError,
  type Bindings,
  type Expr,
  type NamedValue,
  type Value,
} from '../dsl/index.js';
import {
  CalendarError,
  type Attachment,
  type CompiledCalendar,
  type CompiledParam,
} from './types.js';

export interface ResolvedNamed {
  kind: 'named';
  /** Active domain: declaration-order prefix of length `count`. */
  active: string[];
  /** Active domain in increasing-tick order (reversed when step = -1). */
  tickOrdered: string[];
  step: 1 | -1;
}

export interface ResolvedNumber {
  kind: 'number';
  /** Label of the tick-order-first unit; null = open toward -∞ tick. */
  from: number | null;
  /** Label of the tick-order-last unit; null = open toward +∞ tick. */
  to: number | null;
  step: 1 | -1;
  /** Unit count when both bounds are finite. */
  count: number | null;
}

export type ResolvedDomain = ResolvedNamed | ResolvedNumber;

export function emptyScope(cal: Pick<CompiledCalendar, 'displays'>): Bindings {
  return { values: new Map(), activeDomains: new Map(), displays: cal.displays };
}

/** Extend a scope with one more bound parameter (maps copied — scopes are immutable). */
export function bindParam(
  b: Bindings,
  param: CompiledParam,
  value: number | string,
  dom: ResolvedDomain
): Bindings {
  const values = new Map(b.values);
  const activeDomains = new Map(b.activeDomains);
  if (param.type === 'named') {
    values.set(param.name, { domain: param.name, value: value as string });
    activeDomains.set(param.name, (dom as ResolvedNamed).active);
  } else {
    values.set(param.name, value as number);
  }
  return { values, activeDomains, displays: b.displays };
}

export function describeScope(b: Bindings): string {
  if (b.values.size === 0) return 'the top level';
  return [...b.values.entries()]
    .map(([k, v]) => `${k}=${typeof v === 'object' && v !== null ? (v as NamedValue).value : v}`)
    .join(', ');
}

function evalAttachment<T>(att: Attachment<T>, b: Bindings, ctx: string): Value {
  if (att.kind === 'const') return att.value as Value;
  try {
    return att.rule.evaluate(b);
  } catch (err) {
    if (err instanceof DslError) {
      throw new CalendarError(`${ctx} is undefined at ${describeScope(b)}: ${err.message}`);
    }
    throw err;
  }
}

export function evalStep(param: CompiledParam, b: Bindings): 1 | -1 {
  const v = evalAttachment(param.step, b, `step for '${param.name}'`);
  if (v !== 1 && v !== -1) {
    throw new CalendarError(
      `step for '${param.name}' must be 1 or -1, got ${String(v)} at ${describeScope(b)}`
    );
  }
  return v;
}

function evalBound(
  att: Attachment<number | null> | undefined,
  b: Bindings,
  ctx: string
): number | null {
  if (att === undefined) return null;
  const v = evalAttachment(att, b, ctx);
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new CalendarError(`${ctx} must be an integer or null, got ${String(v)} at ${describeScope(b)}`);
  }
  return v;
}

/** Resolve a param's domain within a scope binding all of its ancestors. */
export function resolveParamDomain(param: CompiledParam, b: Bindings): ResolvedDomain {
  const step = evalStep(param, b);
  if (param.type === 'named') {
    let n = param.values.length;
    if (param.count) {
      const v = evalAttachment(param.count, b, `count for '${param.name}'`);
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > param.values.length) {
        throw new CalendarError(
          `count for '${param.name}' must be an integer in 1..${param.values.length}, got ${String(v)} at ${describeScope(b)}`
        );
      }
      n = v;
    }
    const active = param.values.slice(0, n);
    return {
      kind: 'named',
      active,
      tickOrdered: step === 1 ? active : [...active].reverse(),
      step,
    };
  }
  const from = evalBound(param.from, b, `range 'from' for '${param.name}'`);
  const to = evalBound(param.to, b, `range 'to' for '${param.name}'`);
  let count: number | null = null;
  if (from !== null && to !== null) {
    const diff = (to - from) * step;
    if (diff < 0) {
      throw new CalendarError(
        `range for '${param.name}' runs against its step at ${describeScope(b)} (from=${from}, to=${to}, step=${step})`
      );
    }
    count = diff + 1;
  }
  return { kind: 'number', from, to, step, count };
}

export function numberInDomain(dom: ResolvedNumber, v: number): boolean {
  if (!Number.isInteger(v)) return false;
  const lo = dom.step === 1 ? dom.from : dom.to;
  const hi = dom.step === 1 ? dom.to : dom.from;
  return (lo === null || v >= lo) && (hi === null || v <= hi);
}

/** Ticks per unit of the terminal param — always a positive safe integer. */
export function evalUnitTicks(param: CompiledParam, b: Bindings): number {
  const v = evalAttachment(param.unitTicks!, b, `unitTicks for '${param.name}'`);
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || !Number.isSafeInteger(v)) {
    throw new CalendarError(
      `unitTicks for '${param.name}' must be a positive integer, got ${String(v)} at ${describeScope(b)}`
    );
  }
  return v;
}

// ---------------------------------------------------------------------------
// Null (open-ended bound) legality — static, at compile time.
// ---------------------------------------------------------------------------

function exprHasNull(e: Expr): boolean {
  switch (e.kind) {
    case 'null':
      return true;
    case 'number':
    case 'bool':
    case 'ident':
      return false;
    case 'unary':
      return exprHasNull(e.operand);
    case 'binary':
    case 'compare':
    case 'logic':
      return exprHasNull(e.left) || exprHasNull(e.right);
    case 'call':
      return e.args.some(exprHasNull);
    case 'case':
      return (
        e.clauses.some((c) => exprHasNull(c.expr)) ||
        (e.elseExpr !== undefined && exprHasNull(e.elseExpr))
      );
    case 'if':
      return exprHasNull(e.cond) || exprHasNull(e.then) || exprHasNull(e.else);
    case 'template':
      return e.parts.some((p) => 'expr' in p && exprHasNull(p.expr));
  }
}

function attachmentMayBeNull(att: Attachment<number | null> | undefined): boolean {
  if (att === undefined) return true; // missing bound = open
  if (att.kind === 'const') return att.value === null;
  return (
    exprHasNull(att.rule.program.ret) ||
    att.rule.program.statements.some((s) => exprHasNull(s.expr))
  );
}

const SCOPE_ENUMERATION_CAP = 10_000;

interface PathEntry {
  param: CompiledParam;
  value: string;
  dom: ResolvedNamed;
}

/**
 * Verify every possibly-null bound in the schema:
 *   1. all strict ancestors of the null-bearing param are Named;
 *   2. every scope where the bound resolves to null sits at the matching
 *      tick-order extreme of every ancestor level (step-derived order).
 * Terminal unitTicks nullability is excluded by its attachment type upstream.
 */
export function scanNullLegality(cal: Pick<CompiledCalendar, 'params' | 'displays'>): void {
  for (const param of cal.params) {
    if (param.type !== 'number') continue;
    const fromMayNull = attachmentMayBeNull(param.from);
    const toMayNull = attachmentMayBeNull(param.to);
    if (!fromMayNull && !toMayNull) continue;

    const ancestors = cal.params.slice(0, param.level);
    const numberAncestor = ancestors.find((a) => a.type === 'number');
    if (numberAncestor) {
      throw new CalendarError(
        `open-ended (null) bound on '${param.name}' requires an all-Named ancestor chain — ` +
          `'${numberAncestor.name}' is a Number parameter`
      );
    }

    let scopes = 0;
    const enumerate = (b: Bindings, path: PathEntry[], k: number): void => {
      if (k === param.level) {
        if (++scopes > SCOPE_ENUMERATION_CAP) {
          throw new CalendarError(
            `too many ancestor scope combinations to verify null legality for '${param.name}'`
          );
        }
        const dom = resolveParamDomain(param, b) as ResolvedNumber;
        if (dom.from === null) checkExtremal(param, path, b, 'first');
        if (dom.to === null) checkExtremal(param, path, b, 'last');
        return;
      }
      const ancestor = ancestors[k];
      const dom = resolveParamDomain(ancestor, b) as ResolvedNamed;
      for (const value of dom.active) {
        enumerate(bindParam(b, ancestor, value, dom), [...path, { param: ancestor, value, dom }], k + 1);
      }
    };
    enumerate(emptyScope(cal), [], 0);
  }
}

function checkExtremal(
  param: CompiledParam,
  path: PathEntry[],
  b: Bindings,
  end: 'first' | 'last'
): void {
  for (const entry of path) {
    const ordered = entry.dom.tickOrdered;
    const expected = end === 'first' ? ordered[0] : ordered[ordered.length - 1];
    if (entry.value !== expected) {
      throw new CalendarError(
        `open '${end === 'first' ? 'from' : 'to'}' on '${param.name}' at ${describeScope(b)} is illegal: ` +
          `'${entry.param.name}=${entry.value}' is not tick-order-${end} ` +
          `(the branch must be extremal at every ancestor level)`
      );
    }
  }
}
