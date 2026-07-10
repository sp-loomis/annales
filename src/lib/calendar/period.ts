import type { Attachment, CompiledParam } from './types.js';

/**
 * Periodicity of unit widths at a level w.r.t. that level's own (Number) value,
 * derived from the dependency scans of every descendant width rule.
 *   Tier 0 — no descendant rule references the value: widths constant per scope.
 *   Tier 1 — every reference is `value % N` (literal N): widths periodic with
 *            period lcm(all N). Provable by substitution, never sampled.
 *   Tier 2 — anything else: no claim; widths summed on demand.
 */
export type Tier = { t: 0 } | { t: 1; period: number } | { t: 2 };

/** Cycle tables above this size cost more than direct summation saves. */
export const CYCLE_CAP = 10_000;

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** Width-relevant attachments of a param: everything except display-only step. */
function widthAttachments(p: CompiledParam): (Attachment<unknown> | undefined)[] {
  return [p.count, p.from, p.to, p.unitTicks];
}

export function classifyLevel(params: CompiledParam[], level: number): Tier {
  const name = params[level].name;
  let referenced = false;
  let bare = false;
  const moduli = new Set<number>();
  for (const p of params.slice(level + 1)) {
    for (const att of widthAttachments(p)) {
      if (!att || att.kind !== 'rule') continue;
      const info = att.rule.deps.perVar.get(name);
      if (!info) continue;
      referenced = true;
      if (info.bare) bare = true;
      for (const m of info.moduli) moduli.add(m);
    }
  }
  if (!referenced) return { t: 0 };
  if (bare || moduli.size === 0) return { t: 2 };
  if (![...moduli].every((m) => Number.isInteger(m) && m >= 1)) return { t: 2 };
  const period = [...moduli].reduce(lcm, 1);
  return period <= CYCLE_CAP ? { t: 1, period } : { t: 2 };
}
