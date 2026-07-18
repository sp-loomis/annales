import { lex } from './lexer.js';
import { parse } from './parser.js';
import { check, type Deps, type Env, type ExpectedType } from './check.js';
import { evaluate, type Bindings, type Value } from './eval.js';
import type { Program } from './ast.js';

export { DslError } from './errors.js';
export { KEYWORDS, FUNCTION_NAMES, RESERVED } from './token.js';
export type { Program, Expr } from './ast.js';
export type { Env, ExpectedType, Deps, VarType, DepInfo } from './check.js';
export type { Bindings, Value, NamedValue } from './eval.js';
export { euclideanMod } from './eval.js';

export interface CompiledRule {
  source: string;
  deps: Deps;
  warnings: string[];
  /** Parsed body — exposed for static analyses (step ±1 leaves, null-branch scan). */
  program: Program;
  evaluate(bindings: Bindings): Value;
}

/** Lex + parse + typecheck a rule body against its attachment point. Throws DslError. */
export function compileRule(source: string, env: Env, expected: ExpectedType): CompiledRule {
  const program: Program = parse(lex(source));
  const { deps, warnings } = check(program, env, expected);
  return {
    source,
    deps,
    warnings,
    program,
    evaluate: (bindings: Bindings) => evaluate(program, bindings),
  };
}
