import { DslError, type Pos } from './errors.js';
import type { Expr, Program } from './ast.js';

export type VarType =
  | { kind: 'number' }
  | { kind: 'named'; domain: string }
  | { kind: 'boolean' };

export interface Env {
  /** Bound parameters (and `tick`, where the attachment point provides it). */
  vars: Map<string, VarType>;
  /** Named domain id → full declared value list (value ids, not display names). */
  namedDomains: Map<string, string[]>;
  /** Whether this attachment point admits Null returns (range from/to only). */
  allowNull: boolean;
}

export type ExpectedType =
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'string' }
  | { kind: 'numberOrNull' }
  /** Named-typed derived fields: an own-domain literal or a 0-based Number index. */
  | { kind: 'namedOrNumber'; domain: string };

export interface DepInfo {
  /** True if the var appears anywhere other than as the subject of `var % <literal>`. */
  bare: boolean;
  /** Literal moduli from `var % N` occurrences. */
  moduli: Set<number>;
}

export interface Deps {
  perVar: Map<string, DepInfo>;
}

export interface CheckResult {
  deps: Deps;
  warnings: string[];
}

/** Internal inferred type; `namedLit` is an identifier awaiting domain context. */
type Ty =
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'string' }
  | { kind: 'named'; domain: string }
  | { kind: 'namedLit'; name: string }
  | { kind: 'null' }
  | { kind: 'numberOrNull' };

function tyName(t: Ty): string {
  if (t.kind === 'named') return `Named(${t.domain})`;
  if (t.kind === 'namedLit') return `Named literal '${t.name}'`;
  if (t.kind === 'numberOrNull') return 'Number/Null';
  return t.kind === 'null' ? 'Null' : t.kind[0].toUpperCase() + t.kind.slice(1);
}

const NULL_CONTEXT_MSG =
  "'null' is only legal as a range-bound result, either returned directly or under a 'case' on a " +
  "Named parameter — never under 'if' or inside another expression";

class Checker {
  private locals = new Map<string, Ty>();
  readonly deps: Deps = { perVar: new Map() };
  readonly warnings: string[] = [];

  constructor(private readonly env: Env) {}

  checkProgram(program: Program, expected: ExpectedType): void {
    for (const stmt of program.statements) {
      if (this.env.vars.has(stmt.name)) {
        throw new DslError(`'${stmt.name}' shadows a bound parameter`, stmt.pos);
      }
      if (this.locals.has(stmt.name)) {
        throw new DslError(`'${stmt.name}' is already assigned — each local may be assigned once`, stmt.pos);
      }
      const ty = this.typeExpr(stmt.expr, false);
      if (ty.kind === 'namedLit') {
        throw new DslError(`unresolved identifier '${ty.name}'`, stmt.pos);
      }
      this.locals.set(stmt.name, ty);
    }

    const nullOk = this.env.allowNull && expected.kind === 'numberOrNull';
    const retTy = this.typeExpr(program.ret, nullOk);
    this.checkReturn(retTy, expected, program.retPos);
  }

  private checkReturn(ty: Ty, expected: ExpectedType, pos: Pos): void {
    const fail = () => {
      throw new DslError(
        `rule must return ${expected.kind === 'namedOrNumber' ? `Named(${expected.domain}) or Number` : tyName({ kind: expected.kind } as Ty)}, got ${tyName(ty)}`,
        pos
      );
    };
    switch (expected.kind) {
      case 'number':
        if (ty.kind !== 'number') fail();
        return;
      case 'boolean':
        if (ty.kind !== 'boolean') fail();
        return;
      case 'string':
        if (ty.kind !== 'string') fail();
        return;
      case 'numberOrNull':
        if (ty.kind !== 'number' && ty.kind !== 'null' && ty.kind !== 'numberOrNull') fail();
        return;
      case 'namedOrNumber': {
        if (ty.kind === 'number') return;
        if (ty.kind === 'named' && ty.domain === expected.domain) return;
        if (ty.kind === 'namedLit') {
          this.resolveLiteral(ty.name, expected.domain, pos);
          return;
        }
        fail();
      }
    }
  }

  private domainValues(domain: string, pos: Pos): string[] {
    const values = this.env.namedDomains.get(domain);
    if (!values) throw new DslError(`unknown Named domain '${domain}'`, pos);
    return values;
  }

  private resolveLiteral(name: string, domain: string, pos: Pos): void {
    if (!this.domainValues(domain, pos).includes(name)) {
      throw new DslError(`'${name}' is not a value of ${domain}'s domain`, pos);
    }
  }

  private recordDep(name: string, opts: { bare: boolean; modulus?: number }): void {
    if (!this.env.vars.has(name)) return;
    let info = this.deps.perVar.get(name);
    if (!info) {
      info = { bare: false, moduli: new Set() };
      this.deps.perVar.set(name, info);
    }
    if (opts.bare) info.bare = true;
    if (opts.modulus !== undefined) info.moduli.add(opts.modulus);
  }

  /** Type of a variable reference, recording the dependency. */
  private varType(name: string, pos: Pos, opts: { bare: boolean; modulus?: number }): Ty {
    const local = this.locals.get(name);
    if (local) return local;
    const bound = this.env.vars.get(name);
    if (bound) {
      this.recordDep(name, opts);
      return bound;
    }
    return { kind: 'namedLit', name };
  }

  /** Reject an unresolved identifier reaching a context that cannot give it a domain. */
  private noLit(ty: Ty, pos: Pos): Ty {
    if (ty.kind === 'namedLit') throw new DslError(`unresolved identifier '${ty.name}'`, pos);
    return ty;
  }

  private typeExpr(expr: Expr, nullOk: boolean): Ty {
    switch (expr.kind) {
      case 'number':
        return { kind: 'number' };
      case 'bool':
        return { kind: 'boolean' };
      case 'null':
        if (!nullOk) throw new DslError(NULL_CONTEXT_MSG, expr.pos);
        return { kind: 'null' };
      case 'ident':
        return this.varType(expr.name, expr.pos, { bare: true });
      case 'template':
        return this.typeTemplate(expr);
      case 'unary': {
        const ty = this.typeExpr(expr.operand, false);
        if (expr.op === '-') {
          if (ty.kind !== 'number') {
            throw new DslError(`unary '-' requires a Number, got ${tyName(ty)}`, expr.pos);
          }
          return { kind: 'number' };
        }
        if (ty.kind !== 'boolean') {
          throw new DslError(`'not' requires a Boolean, got ${tyName(ty)}`, expr.pos);
        }
        return { kind: 'boolean' };
      }
      case 'binary':
        return this.typeBinary(expr);
      case 'compare':
        return this.typeCompare(expr);
      case 'logic': {
        const l = this.typeExpr(expr.left, false);
        const r = this.typeExpr(expr.right, false);
        if (l.kind !== 'boolean' || r.kind !== 'boolean') {
          throw new DslError(
            `'${expr.op}' requires Boolean operands, got ${tyName(l)} and ${tyName(r)}`,
            expr.pos
          );
        }
        return { kind: 'boolean' };
      }
      case 'call':
        return this.typeCall(expr);
      case 'case':
        return this.typeCase(expr, nullOk);
      case 'if': {
        const cond = this.typeExpr(expr.cond, false);
        if (cond.kind !== 'boolean') {
          throw new DslError(`'if' condition must be Boolean, got ${tyName(cond)}`, expr.pos);
        }
        // Null is rejected under `if` outright (spec: no exhaustiveness for Number domains).
        const thenTy = this.typeExpr(expr.then, false);
        const elseTy = this.typeExpr(expr.else, false);
        return this.unifyBranches([thenTy, elseTy], expr.pos, false);
      }
    }
  }

  private typeBinary(expr: Extract<Expr, { kind: 'binary' }>): Ty {
    // Mod-pattern dependency: `param % <literal>` — recorded as periodic, not bare.
    if (
      expr.op === '%' &&
      expr.left.kind === 'ident' &&
      !this.locals.has(expr.left.name) &&
      this.env.vars.get(expr.left.name)?.kind === 'number' &&
      expr.right.kind === 'number'
    ) {
      this.varType(expr.left.name, expr.left.pos, { bare: false, modulus: expr.right.value });
      return { kind: 'number' };
    }
    const l = this.noLit(this.typeExpr(expr.left, false), expr.left.pos);
    const r = this.noLit(this.typeExpr(expr.right, false), expr.right.pos);
    if (l.kind !== 'number' || r.kind !== 'number') {
      throw new DslError(
        `'${expr.op}' requires Number operands, got ${tyName(l)} and ${tyName(r)}`,
        expr.pos
      );
    }
    return { kind: 'number' };
  }

  private typeCompare(expr: Extract<Expr, { kind: 'compare' }>): Ty {
    const l = this.typeExpr(expr.left, false);
    const r = this.typeExpr(expr.right, false);
    if (expr.op === '=' || expr.op === '!=') {
      if (l.kind === 'number' && r.kind === 'number') return { kind: 'boolean' };
      if (l.kind === 'named' && r.kind === 'named') {
        if (l.domain !== r.domain) {
          throw new DslError(
            `cannot compare Named values from different domains ('${l.domain}' vs '${r.domain}')`,
            expr.pos
          );
        }
        return { kind: 'boolean' };
      }
      if (l.kind === 'named' && r.kind === 'namedLit') {
        this.resolveLiteral(r.name, l.domain, expr.pos);
        return { kind: 'boolean' };
      }
      if (l.kind === 'namedLit' && r.kind === 'named') {
        this.resolveLiteral(l.name, r.domain, expr.pos);
        return { kind: 'boolean' };
      }
      throw new DslError(
        `'${expr.op}' requires two Numbers or two same-domain Named values, got ${tyName(l)} and ${tyName(r)}`,
        expr.pos
      );
    }
    if (l.kind !== 'number' || r.kind !== 'number') {
      throw new DslError(
        `'${expr.op}' requires Number operands, got ${tyName(l)} and ${tyName(r)}`,
        expr.pos
      );
    }
    return { kind: 'boolean' };
  }

  private typeCall(expr: Extract<Expr, { kind: 'call' }>): Ty {
    const argTypes = expr.args.map((a) => this.typeExpr(a, false));
    if (expr.name === 'ordinal') {
      if (expr.args.length !== 1) {
        throw new DslError("'ordinal' takes exactly one Named argument", expr.pos);
      }
      const arg = argTypes[0];
      if (arg.kind !== 'named') {
        throw new DslError(
          arg.kind === 'number'
            ? "'ordinal' on a Number-typed value is a static type error — it is already a Number"
            : `'ordinal' requires a Named argument, got ${tyName(arg)}`,
          expr.pos
        );
      }
      if (expr.base !== undefined && !Number.isInteger(expr.base)) {
        throw new DslError("'base=' must be an integer literal", expr.pos);
      }
      return { kind: 'number' };
    }
    if (expr.base !== undefined) {
      throw new DslError(`'base=' is only legal on 'ordinal'`, expr.pos);
    }
    if (expr.name === 'ceil' || expr.name === 'floor') {
      if (expr.args.length !== 1 || argTypes[0].kind !== 'number') {
        throw new DslError(`'${expr.name}' takes exactly one Number argument`, expr.pos);
      }
      return { kind: 'number' };
    }
    // min/max
    if (expr.args.length < 2 || argTypes.some((t) => t.kind !== 'number')) {
      throw new DslError(`'${expr.name}' takes two or more Number arguments`, expr.pos);
    }
    return { kind: 'number' };
  }

  private typeCase(expr: Extract<Expr, { kind: 'case' }>, nullOk: boolean): Ty {
    const subjectTy = this.varType(expr.subject, expr.subjectPos, { bare: true });
    if (subjectTy.kind !== 'named') {
      throw new DslError(
        subjectTy.kind === 'namedLit'
          ? `unresolved identifier '${expr.subject}'`
          : `'case' subject must be Named-typed, got ${tyName(subjectTy)}`,
        expr.subjectPos
      );
    }
    const domain = this.domainValues(subjectTy.domain, expr.subjectPos);
    const covered = new Set<string>();
    const branchTypes: Ty[] = [];
    for (const clause of expr.clauses) {
      for (const v of clause.values) {
        if (!domain.includes(v.name)) {
          throw new DslError(
            `'${v.name}' is not a value of ${subjectTy.domain}'s domain`,
            v.pos
          );
        }
        covered.add(v.name);
      }
      branchTypes.push(this.typeExpr(clause.expr, nullOk));
    }
    if (expr.elseExpr) {
      branchTypes.push(this.typeExpr(expr.elseExpr, nullOk));
      if (covered.size === domain.length) {
        this.warnings.push(
          `'case ${expr.subject}' covers the full domain — the 'else' branch is unreachable`
        );
      }
    } else if (covered.size !== domain.length) {
      const missing = domain.filter((v) => !covered.has(v));
      throw new DslError(
        `'case ${expr.subject}' is not exhaustive — missing: ${missing.join(', ')} (add clauses or an 'else')`,
        expr.pos
      );
    }
    return this.unifyBranches(branchTypes, expr.pos, nullOk);
  }

  private unifyBranches(types: Ty[], pos: Pos, nullOk: boolean): Ty {
    const mismatch = () => {
      throw new DslError(
        `branches have mismatched types: ${types.map(tyName).join(', ')}`,
        pos
      );
    };
    if (types.some((t) => t.kind === 'null' || t.kind === 'numberOrNull')) {
      if (!nullOk) mismatch(); // null types cannot be constructed when !nullOk, but keep the guard
      if (types.every((t) => t.kind === 'null')) return { kind: 'null' };
      if (types.some((t) => t.kind !== 'number' && t.kind !== 'null' && t.kind !== 'numberOrNull')) {
        mismatch();
      }
      return { kind: 'numberOrNull' };
    }
    // Resolve named literals against any concrete named branch.
    const concrete = types.find((t): t is Extract<Ty, { kind: 'named' }> => t.kind === 'named');
    if (concrete) {
      for (const t of types) {
        if (t.kind === 'namedLit') this.resolveLiteral(t.name, concrete.domain, pos);
        else if (t.kind !== 'named' || t.domain !== concrete.domain) mismatch();
      }
      return concrete;
    }
    const first = types[0];
    if (first.kind === 'namedLit') {
      throw new DslError(
        `cannot infer the domain of Named literal '${first.name}' — compare or return it where a domain is known`,
        pos
      );
    }
    for (const t of types) if (t.kind !== first.kind) mismatch();
    return first;
  }

  private typeTemplate(expr: Extract<Expr, { kind: 'template' }>): Ty {
    for (const part of expr.parts) {
      if ('text' in part) continue;
      const ty = this.typeExpr(part.expr, false);
      if (ty.kind === 'string') {
        throw new DslError('cannot interpolate a String inside a template (no nesting)', expr.pos);
      }
      if (ty.kind === 'namedLit') {
        throw new DslError(`unresolved identifier '${ty.name}'`, expr.pos);
      }
      if (ty.kind !== 'number' && ty.kind !== 'named' && ty.kind !== 'boolean') {
        throw new DslError(`cannot interpolate a ${tyName(ty)} value`, expr.pos);
      }
      if (part.spec && ty.kind !== 'number') {
        throw new DslError(
          `format specs apply to Number values only, got ${tyName(ty)}`,
          expr.pos
        );
      }
    }
    return { kind: 'string' };
  }
}

export function check(program: Program, env: Env, expected: ExpectedType): CheckResult {
  const checker = new Checker(env);
  checker.checkProgram(program, expected);
  return { deps: checker.deps, warnings: checker.warnings };
}
