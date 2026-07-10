import { DslError, type Pos } from './errors.js';
import type { Expr, Program } from './ast.js';
import type { FormatSpec } from './token.js';

/** Runtime Named values carry their domain so ordinal()/displays resolve. */
export interface NamedValue {
  domain: string;
  value: string;
}

export type Value = number | boolean | string | NamedValue | null;

export interface Bindings {
  /** Bound parameter (and `tick`) values. Named params as NamedValue. */
  values: Map<string, Value>;
  /** Domain id → active value list in tick-order-agnostic declaration order. */
  activeDomains: Map<string, string[]>;
  /** Domain id → value id → display name; value id used when absent. */
  displays?: Map<string, Map<string, string>>;
}

const isNamed = (v: Value): v is NamedValue =>
  typeof v === 'object' && v !== null && 'value' in v;

/** Floored (Euclidean) modulo — result takes the sign of the divisor. */
export function euclideanMod(a: number, b: number): number {
  return a - b * Math.floor(a / b);
}

class Evaluator {
  private locals = new Map<string, Value>();

  constructor(private readonly bindings: Bindings) {}

  run(program: Program): Value {
    for (const stmt of program.statements) {
      this.locals.set(stmt.name, this.eval(stmt.expr));
    }
    return this.eval(program.ret);
  }

  private num(expr: Expr): number {
    const v = this.eval(expr);
    if (typeof v !== 'number') {
      throw new DslError('expected a Number value', expr.pos);
    }
    return v;
  }

  private eval(expr: Expr): Value {
    switch (expr.kind) {
      case 'number':
        return expr.value;
      case 'bool':
        return expr.value;
      case 'null':
        return null;
      case 'ident': {
        const local = this.locals.get(expr.name);
        if (local !== undefined) return local;
        const bound = this.bindings.values.get(expr.name);
        if (bound !== undefined) return bound;
        // Statically verified Named literal; domain irrelevant for value equality.
        return { domain: '', value: expr.name };
      }
      case 'unary': {
        if (expr.op === '-') return -this.num(expr.operand);
        return !(this.eval(expr.operand) as boolean);
      }
      case 'binary': {
        const l = this.num(expr.left);
        const r = this.num(expr.right);
        switch (expr.op) {
          case '+':
            return l + r;
          case '-':
            return l - r;
          case '*':
            return l * r;
          case '/':
            if (r === 0) throw new DslError('division by zero', expr.pos);
            return l / r;
          case '%':
            if (r === 0) throw new DslError('modulo by zero', expr.pos);
            return euclideanMod(l, r);
        }
        break;
      }
      case 'compare': {
        const l = this.eval(expr.left);
        const r = this.eval(expr.right);
        if (expr.op === '=' || expr.op === '!=') {
          const eq = isNamed(l) && isNamed(r) ? l.value === r.value : l === r;
          return expr.op === '=' ? eq : !eq;
        }
        const ln = l as number;
        const rn = r as number;
        switch (expr.op) {
          case '<':
            return ln < rn;
          case '>':
            return ln > rn;
          case '<=':
            return ln <= rn;
          case '>=':
            return ln >= rn;
        }
        break;
      }
      case 'logic': {
        const l = this.eval(expr.left) as boolean;
        if (expr.op === 'and') return l ? (this.eval(expr.right) as boolean) : false;
        return l ? true : (this.eval(expr.right) as boolean);
      }
      case 'call':
        return this.evalCall(expr);
      case 'case': {
        const subject = this.eval({ kind: 'ident', name: expr.subject, pos: expr.subjectPos });
        if (!isNamed(subject)) {
          throw new DslError(`'case' subject '${expr.subject}' is not a Named value`, expr.subjectPos);
        }
        for (const clause of expr.clauses) {
          if (clause.values.some((v) => v.name === subject.value)) {
            return this.eval(clause.expr);
          }
        }
        if (expr.elseExpr) return this.eval(expr.elseExpr);
        throw new DslError(
          `'case ${expr.subject}' has no clause for '${subject.value}'`,
          expr.pos
        );
      }
      case 'if':
        return this.eval(this.eval(expr.cond) ? expr.then : expr.else);
      case 'template':
        return this.evalTemplate(expr);
    }
    throw new DslError('unreachable expression kind', expr.pos);
  }

  private evalCall(expr: Extract<Expr, { kind: 'call' }>): Value {
    if (expr.name === 'ordinal') {
      const arg = this.eval(expr.args[0]);
      if (!isNamed(arg)) throw new DslError("'ordinal' requires a Named value", expr.pos);
      const active = this.bindings.activeDomains.get(arg.domain);
      if (!active) {
        throw new DslError(`no active domain available for '${arg.domain}'`, expr.pos);
      }
      const index = active.indexOf(arg.value);
      if (index === -1) {
        throw new DslError(
          `'${arg.value}' is not in the active domain of '${arg.domain}'`,
          expr.pos
        );
      }
      return (expr.base ?? 1) + index;
    }
    const args = expr.args.map((a) => this.num(a));
    switch (expr.name) {
      case 'ceil':
        return Math.ceil(args[0]);
      case 'floor':
        return Math.floor(args[0]);
      case 'min':
        return Math.min(...args);
      case 'max':
        return Math.max(...args);
      default:
        throw new DslError(`unknown function '${expr.name}'`, expr.pos);
    }
  }

  private evalTemplate(expr: Extract<Expr, { kind: 'template' }>): string {
    let out = '';
    for (const part of expr.parts) {
      if ('text' in part) {
        out += part.text;
        continue;
      }
      out += this.render(this.eval(part.expr), part.spec, expr.pos);
    }
    return out;
  }

  private render(value: Value, spec: FormatSpec | undefined, pos: Pos): string {
    if (spec) {
      if (typeof value !== 'number') {
        throw new DslError('format specs apply to Number values only', pos);
      }
      if (spec.kind === 'fixed') return value.toFixed(spec.places);
      if (!Number.isInteger(value)) {
        throw new DslError(`'d' format spec requires an integer, got ${value}`, pos);
      }
      const sign = value < 0 ? '-' : '';
      const digits = Math.abs(value).toString();
      return sign + digits.padStart(spec.width - sign.length, '0');
    }
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (isNamed(value)) {
      return this.bindings.displays?.get(value.domain)?.get(value.value) ?? value.value;
    }
    throw new DslError('cannot render this value in a template', pos);
  }
}

export function evaluate(program: Program, bindings: Bindings): Value {
  return new Evaluator(bindings).run(program);
}
