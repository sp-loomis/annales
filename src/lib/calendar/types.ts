import type { CompiledRule, Value } from '../dsl/index.js';

export class CalendarError extends Error {}

/** A schema attachment point: a JSON constant or a compiled DSL rule. */
export type Attachment<T> = { kind: 'const'; value: T } | { kind: 'rule'; rule: CompiledRule };

export interface CompiledParam {
  name: string;
  level: number;
  type: 'number' | 'named';
  /** Named: declared value ids in declaration order. Empty for number params. */
  values: string[];
  /** Named: value id → display name (only ids with an explicit display). */
  displays: Map<string, string>;
  /** Named: active domain length (defaults to the full values list). */
  count?: Attachment<number>;
  /** Number: tick-order anchors — `from` labels the tick-first unit, `to` the tick-last. */
  from?: Attachment<number | null>;
  to?: Attachment<number | null>;
  /** Display direction: label(i) = from + step·i along the tick-order index. */
  step: Attachment<1 | -1>;
  /** Terminal param only: ticks per unit (must resolve to a positive integer). */
  unitTicks?: Attachment<number>;
}

export interface CompiledDerived {
  name: string;
  type: 'number' | 'boolean' | 'named';
  values?: string[];
  displays?: Map<string, string>;
  rule: CompiledRule;
  usesTick: boolean;
}

export interface CompiledCalendar {
  params: CompiledParam[];
  /** Full parameter tuple at tick 0 (start of that terminal unit). */
  epoch: Map<string, Value>;
  derived: CompiledDerived[];
  /** Level index → formatting rule override. Defaults apply where absent. */
  formatPretty: Map<number, CompiledRule>;
  formatShort: Map<number, CompiledRule>;
  /** Domain id (param or derived name) → full declared value list. */
  namedDomains: Map<string, string[]>;
  /** Domain id → value id → display name. */
  displays: Map<string, Map<string, string>>;
}
