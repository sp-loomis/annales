import type { Pos } from './errors.js';
import type { FormatSpec } from './token.js';

export type ArithOp = '+' | '-' | '*' | '/' | '%';
export type CompareOp = '=' | '!=' | '<' | '>' | '<=' | '>=';
export type LogicOp = 'and' | 'or';

export type Expr =
  | { kind: 'number'; value: number; pos: Pos }
  | { kind: 'bool'; value: boolean; pos: Pos }
  | { kind: 'null'; pos: Pos }
  /** Bound parameter, local, or Named literal — resolved by the checker. */
  | { kind: 'ident'; name: string; pos: Pos }
  | { kind: 'unary'; op: '-' | 'not'; operand: Expr; pos: Pos }
  | { kind: 'binary'; op: ArithOp; left: Expr; right: Expr; pos: Pos }
  | { kind: 'compare'; op: CompareOp; left: Expr; right: Expr; pos: Pos }
  | { kind: 'logic'; op: LogicOp; left: Expr; right: Expr; pos: Pos }
  | { kind: 'call'; name: string; args: Expr[]; base?: number; pos: Pos }
  | {
      kind: 'case';
      subject: string;
      subjectPos: Pos;
      clauses: { values: { name: string; pos: Pos }[]; expr: Expr }[];
      elseExpr?: Expr;
      pos: Pos;
    }
  | { kind: 'if'; cond: Expr; then: Expr; else: Expr; pos: Pos }
  | {
      kind: 'template';
      parts: ({ text: string } | { expr: Expr; spec?: FormatSpec })[];
      pos: Pos;
    };

export interface Assign {
  name: string;
  expr: Expr;
  pos: Pos;
}

export interface Program {
  statements: Assign[];
  ret: Expr;
  retPos: Pos;
}
