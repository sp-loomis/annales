import {
  compileRule,
  DslError,
  type CompiledRule,
  type Env,
  type ExpectedType,
  type Expr,
  type NamedValue,
  type Value,
  type VarType,
} from '../dsl/index.js';
import { RESERVED } from '../dsl/token.js';
import {
  CalendarError,
  type Attachment,
  type CompiledCalendar,
  type CompiledDerived,
  type CompiledParam,
} from './types.js';
import {
  bindParam,
  emptyScope,
  numberInDomain,
  resolveParamDomain,
  scanNullLegality,
} from './order.js';

const IDENT_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const TICK = 'tick';

function fail(message: string): never {
  throw new CalendarError(message);
}

function isDslAttachment(raw: unknown): raw is { dsl: string } {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'dsl' in raw &&
    typeof (raw as { dsl: unknown }).dsl === 'string'
  );
}

function checkName(name: unknown, what: string): string {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) {
    fail(`${what} must be an identifier (letters, digits, underscore; leading letter), got ${JSON.stringify(name)}`);
  }
  if (RESERVED.has(name) || name === TICK) {
    fail(`${what} '${name}' collides with a reserved word`);
  }
  return name;
}

interface RawParamShape {
  name: string;
  type: 'number' | 'named';
  values: string[];
  displays: Map<string, string>;
  raw: Record<string, unknown>;
}

/** First structural pass: names, types, Named value lists. */
function readParamShapes(rawParams: unknown): RawParamShape[] {
  if (!Array.isArray(rawParams) || rawParams.length === 0) {
    fail('definition.params must be a non-empty array (coarsest → finest)');
  }
  const seen = new Set<string>();
  return rawParams.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) fail(`params[${i}] must be an object`);
    const p = raw as Record<string, unknown>;
    const name = checkName(p.name, `params[${i}].name`);
    if (seen.has(name)) fail(`duplicate param name '${name}'`);
    seen.add(name);
    if (p.type !== 'number' && p.type !== 'named') {
      fail(`param '${name}' must have type 'number' or 'named'`);
    }
    const values: string[] = [];
    const displays = new Map<string, string>();
    if (p.type === 'named') {
      if (!Array.isArray(p.values) || p.values.length === 0) {
        fail(`Named param '${name}' needs a non-empty values list`);
      }
      for (const v of p.values) {
        let id: unknown;
        let display: string | undefined;
        if (typeof v === 'object' && v !== null && 'value' in v) {
          id = (v as { value: unknown }).value;
          const d = (v as { display?: unknown }).display;
          if (d !== undefined && typeof d !== 'string') {
            fail(`display for a value of '${name}' must be a string`);
          }
          display = d as string | undefined;
        } else {
          id = v;
        }
        const checked = checkName(id, `a value of Named param '${name}'`);
        if (values.includes(checked)) fail(`duplicate value '${checked}' in Named param '${name}'`);
        values.push(checked);
        if (display !== undefined) displays.set(checked, display);
      }
    } else if (typeof p.range !== 'object' || p.range === null) {
      fail(`Number param '${name}' needs a range { from, to }`);
    }
    return { name, type: p.type, values, displays, raw: p };
  });
}

/** Env for a rule attached to the param at `level`: strict ancestors only. */
function paramEnv(shapes: RawParamShape[], level: number, namedDomains: Map<string, string[]>, allowNull: boolean): Env {
  const vars = new Map<string, VarType>();
  for (const shape of shapes.slice(0, level)) {
    vars.set(
      shape.name,
      shape.type === 'named' ? { kind: 'named', domain: shape.name } : { kind: 'number' }
    );
  }
  return { vars, namedDomains, allowNull };
}

function compileAttachment(
  raw: unknown,
  ctx: string,
  env: Env,
  expected: ExpectedType
): Attachment<unknown> {
  if (isDslAttachment(raw)) {
    try {
      return { kind: 'rule', rule: compileRule(raw.dsl, env, expected) };
    } catch (err) {
      if (err instanceof DslError) throw new CalendarError(`${ctx}: ${err.message}`);
      throw err;
    }
  }
  return { kind: 'const', value: raw };
}

/** Every leaf of a step rule's returned expression must be the literal 1 or -1. */
function stepLeavesAreUnit(e: Expr): boolean {
  switch (e.kind) {
    case 'number':
      return e.value === 1;
    case 'unary':
      return e.op === '-' && e.operand.kind === 'number' && e.operand.value === 1;
    case 'case':
      return (
        e.clauses.every((c) => stepLeavesAreUnit(c.expr)) &&
        (e.elseExpr === undefined || stepLeavesAreUnit(e.elseExpr))
      );
    case 'if':
      return stepLeavesAreUnit(e.then) && stepLeavesAreUnit(e.else);
    default:
      return false;
  }
}

function compileStep(raw: unknown, ctx: string, env: Env): Attachment<1 | -1> {
  if (raw === undefined) return { kind: 'const', value: 1 };
  const att = compileAttachment(raw, ctx, env, { kind: 'number' });
  if (att.kind === 'const') {
    if (att.value !== 1 && att.value !== -1) fail(`${ctx} must be 1 or -1`);
    return att as Attachment<1 | -1>;
  }
  if (!stepLeavesAreUnit(att.rule.program.ret)) {
    fail(`${ctx} must return the literal 1 or -1 in every branch`);
  }
  return att as Attachment<1 | -1>;
}

function compileBound(raw: unknown, ctx: string, env: Env): Attachment<number | null> {
  if (raw === undefined) fail(`${ctx} is required (a number, null, or a DSL rule)`);
  const att = compileAttachment(raw, ctx, env, { kind: 'numberOrNull' });
  if (att.kind === 'const' && att.value !== null && !Number.isInteger(att.value)) {
    fail(`${ctx} must be an integer, null, or a DSL rule`);
  }
  return att as Attachment<number | null>;
}

export function compileCalendar(definition: unknown): CompiledCalendar {
  if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
    fail('calendar definition must be an object');
  }
  const def = definition as Record<string, unknown>;
  if (def.version !== 1) fail('calendar definition requires version: 1');

  const shapes = readParamShapes(def.params);
  const last = shapes.length - 1;

  // Domains and displays for all Named params (and, later, Named derived fields).
  const namedDomains = new Map<string, string[]>();
  const displays = new Map<string, Map<string, string>>();
  for (const shape of shapes) {
    if (shape.type === 'named') {
      namedDomains.set(shape.name, shape.values);
      displays.set(shape.name, shape.displays);
    }
  }

  // The top-level param is the recursion base case: no ancestors → fully static.
  const top = shapes[0].raw;
  const topRange = (top.range ?? {}) as Record<string, unknown>;
  for (const [key, raw] of [
    ['range.from', topRange.from],
    ['range.to', topRange.to],
    ['step', top.step],
    ['count', top.count],
    ['unitTicks', top.unitTicks],
  ] as const) {
    if (isDslAttachment(raw)) {
      fail(
        `the top-level param '${shapes[0].name}' has no ancestors — ${key} must be a static declaration, not a DSL rule`
      );
    }
  }

  const params: CompiledParam[] = shapes.map((shape, level) => {
    const env = (allowNull: boolean) => paramEnv(shapes, level, namedDomains, allowNull);
    const p = shape.raw;
    const param: CompiledParam = {
      name: shape.name,
      level,
      type: shape.type,
      values: shape.values,
      displays: shape.displays,
      step: compileStep(p.step, `step for '${shape.name}'`, env(false)),
    };

    if (shape.type === 'named') {
      if (p.count !== undefined) {
        const att = compileAttachment(p.count, `count for '${shape.name}'`, env(false), {
          kind: 'number',
        });
        if (
          att.kind === 'const' &&
          (!Number.isInteger(att.value) ||
            (att.value as number) < 1 ||
            (att.value as number) > shape.values.length)
        ) {
          fail(`count for '${shape.name}' must be an integer in 1..${shape.values.length}`);
        }
        param.count = att as Attachment<number>;
      }
    } else {
      const range = p.range as Record<string, unknown>;
      param.from = compileBound(range.from, `range 'from' for '${shape.name}'`, env(true));
      param.to = compileBound(range.to, `range 'to' for '${shape.name}'`, env(true));
      // Constant ranges with constant steps are checked here; dynamic ones at resolution time.
      if (param.from.kind === 'const' && param.to.kind === 'const' && param.step.kind === 'const') {
        const { value: from } = param.from;
        const { value: to } = param.to;
        if (from !== null && to !== null && (to - from) * param.step.value < 0) {
          fail(
            `range for '${shape.name}' runs against its step (from=${from}, to=${to}, step=${param.step.value})`
          );
        }
      }
    }

    if (level === last) {
      if (p.unitTicks === undefined) {
        fail(`the terminal param '${shape.name}' requires unitTicks (ticks per unit)`);
      }
      const att = compileAttachment(p.unitTicks, `unitTicks for '${shape.name}'`, env(false), {
        kind: 'number',
      });
      if (
        att.kind === 'const' &&
        (!Number.isInteger(att.value) || (att.value as number) <= 0)
      ) {
        fail(`unitTicks for '${shape.name}' must be a positive integer`);
      }
      param.unitTicks = att as Attachment<number>;
    } else if (p.unitTicks !== undefined) {
      fail(`unitTicks is only legal on the terminal (finest) param, found on '${shape.name}'`);
    }

    return param;
  });

  scanNullLegality({ params, displays });

  // Derived fields: computed from the full tuple (+ tick), never part of the hierarchy.
  const derived: CompiledDerived[] = [];
  const rawDerived = def.derivedFields ?? [];
  if (!Array.isArray(rawDerived)) fail('derivedFields must be an array');
  const derivedShapes = rawDerived.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) fail(`derivedFields[${i}] must be an object`);
    const d = raw as Record<string, unknown>;
    const name = checkName(d.name, `derivedFields[${i}].name`);
    if (params.some((p) => p.name === name) || derived.some((x) => x.name === name)) {
      fail(`derived field '${name}' collides with another name`);
    }
    if (d.type !== 'number' && d.type !== 'boolean' && d.type !== 'named') {
      fail(`derived field '${name}' must have type 'number', 'boolean', or 'named'`);
    }
    const type = d.type as 'number' | 'boolean' | 'named';
    let values: string[] | undefined;
    const fieldDisplays = new Map<string, string>();
    if (type === 'named') {
      if (!Array.isArray(d.values) || d.values.length === 0) {
        fail(`Named derived field '${name}' needs a non-empty values list`);
      }
      values = d.values.map((v) => {
        if (typeof v === 'object' && v !== null && 'value' in v) {
          const id = checkName((v as { value: unknown }).value, `a value of derived field '${name}'`);
          const disp = (v as { display?: unknown }).display;
          if (typeof disp === 'string') fieldDisplays.set(id, disp);
          return id;
        }
        return checkName(v, `a value of derived field '${name}'`);
      });
      namedDomains.set(name, values);
      displays.set(name, fieldDisplays);
    }
    return { name, type, values, fieldDisplays, raw: d };
  });

  const allParamsEnvVars = new Map<string, VarType>();
  for (const p of params) {
    allParamsEnvVars.set(
      p.name,
      p.type === 'named' ? { kind: 'named', domain: p.name } : { kind: 'number' }
    );
  }

  for (const shape of derivedShapes) {
    if (!isDslAttachment(shape.raw.expr)) {
      fail(`derived field '${shape.name}' needs an expr: { dsl: ... }`);
    }
    const vars = new Map(allParamsEnvVars);
    vars.set(TICK, { kind: 'number' });
    const expected: ExpectedType =
      shape.type === 'named'
        ? { kind: 'namedOrNumber', domain: shape.name }
        : { kind: shape.type };
    const att = compileAttachment(
      shape.raw.expr,
      `derived field '${shape.name}'`,
      { vars, namedDomains, allowNull: false },
      expected
    ) as Attachment<unknown> & { kind: 'rule' };
    derived.push({
      name: shape.name,
      type: shape.type,
      values: shape.values,
      displays: shape.values ? shape.fieldDisplays : undefined,
      rule: att.rule,
      usesTick: att.rule.deps.perVar.has(TICK),
    });
  }

  // Format overrides: one rule per level; scope = params up to that level + derived fields.
  const formatPretty = new Map<number, CompiledRule>();
  const formatShort = new Map<number, CompiledRule>();
  const rawFormat = (def.format ?? {}) as Record<string, unknown>;
  if (typeof rawFormat !== 'object' || rawFormat === null) fail('format must be an object');
  for (const style of ['pretty', 'short'] as const) {
    const rules = rawFormat[style];
    if (rules === undefined) continue;
    if (typeof rules !== 'object' || rules === null) fail(`format.${style} must be an object`);
    for (const [key, raw] of Object.entries(rules)) {
      const level = params.findIndex((p) => p.name === key);
      if (level === -1) fail(`format.${style}.${key} does not name a param`);
      if (!isDslAttachment(raw)) fail(`format.${style}.${key} must be a { dsl: ... } rule`);
      const vars = new Map<string, VarType>();
      for (const p of params.slice(0, level + 1)) {
        vars.set(p.name, p.type === 'named' ? { kind: 'named', domain: p.name } : { kind: 'number' });
      }
      for (const d of derived) {
        vars.set(d.name, d.type === 'named' ? { kind: 'named', domain: d.name } : { kind: d.type });
      }
      const att = compileAttachment(
        raw,
        `format.${style}.${key}`,
        { vars, namedDomains, allowNull: false },
        { kind: 'string' }
      ) as Attachment<unknown> & { kind: 'rule' };
      // A rule at level L renders prefixes bound to L: derived fields that need
      // tick or finer params are only available at the terminal level.
      if (level < last) {
        for (const d of derived) {
          if (!att.rule.deps.perVar.has(d.name)) continue;
          if (d.usesTick) {
            fail(
              `format.${style}.${key} uses derived field '${d.name}', which depends on tick — only the terminal level may use it`
            );
          }
          const deeper = params.slice(level + 1).find((p) => d.rule.deps.perVar.has(p.name));
          if (deeper) {
            fail(
              `format.${style}.${key} uses derived field '${d.name}', which depends on the finer param '${deeper.name}'`
            );
          }
        }
      }
      (style === 'pretty' ? formatPretty : formatShort).set(level, att.rule);
    }
  }

  // Epoch: a full tuple, valid top-down under the actual domain rules.
  if (typeof def.epoch !== 'object' || def.epoch === null) {
    fail('calendar definition requires an epoch (the full date tuple at tick 0)');
  }
  const rawEpoch = def.epoch as Record<string, unknown>;
  for (const key of Object.keys(rawEpoch)) {
    if (!params.some((p) => p.name === key)) fail(`epoch binds unknown param '${key}'`);
  }
  const epoch = new Map<string, Value>();
  let scope = emptyScope({ displays });
  for (const param of params) {
    const raw = rawEpoch[param.name];
    if (raw === undefined) fail(`epoch is missing a value for '${param.name}'`);
    const dom = resolveParamDomain(param, scope);
    if (dom.kind === 'named') {
      if (typeof raw !== 'string' || !dom.active.includes(raw)) {
        fail(`epoch value for '${param.name}' (${JSON.stringify(raw)}) is not in its domain`);
      }
      epoch.set(param.name, { domain: param.name, value: raw } satisfies NamedValue);
      scope = bindParam(scope, param, raw, dom);
    } else {
      if (typeof raw !== 'number' || !numberInDomain(dom, raw)) {
        fail(`epoch value for '${param.name}' (${JSON.stringify(raw)}) is outside its domain`);
      }
      epoch.set(param.name, raw);
      scope = bindParam(scope, param, raw, dom);
    }
  }

  return { params, epoch, derived, formatPretty, formatShort, namedDomains, displays };
}
