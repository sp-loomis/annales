import type { Pos } from './errors.js';

export type TokenKind =
  | 'number'
  | 'ident'
  | 'template'
  | 'case'
  | 'when'
  | 'then'
  | 'else'
  | 'if'
  | 'and'
  | 'or'
  | 'not'
  | 'true'
  | 'false'
  | 'null'
  | 'return'
  | ':='
  | '='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '('
  | ')'
  | ','
  | ':'
  | '}'
  | 'eof';

export type FormatSpec = { kind: 'int'; width: number } | { kind: 'fixed'; places: number };

/** A template is a sequence of literal text runs and interpolation sites. */
export type TemplatePart =
  | { text: string }
  | { tokens: Token[]; spec?: FormatSpec; pos: Pos };

export interface Token {
  kind: TokenKind;
  text: string;
  /** Numeric value, for 'number' tokens. */
  value?: number;
  /** Template parts, for 'template' tokens. */
  parts?: TemplatePart[];
  pos: Pos;
}

export const KEYWORDS: ReadonlyMap<string, TokenKind> = new Map<string, TokenKind>([
  ['case', 'case'],
  ['when', 'when'],
  ['then', 'then'],
  ['else', 'else'],
  ['if', 'if'],
  ['and', 'and'],
  ['or', 'or'],
  ['not', 'not'],
  ['true', 'true'],
  ['false', 'false'],
  ['null', 'null'],
  ['return', 'return'],
]);

export const FUNCTION_NAMES: ReadonlySet<string> = new Set([
  'ordinal',
  'ceil',
  'floor',
  'min',
  'max',
]);

/** Names that may never be bound with `:=`. */
export const RESERVED: ReadonlySet<string> = new Set([...KEYWORDS.keys(), ...FUNCTION_NAMES]);
