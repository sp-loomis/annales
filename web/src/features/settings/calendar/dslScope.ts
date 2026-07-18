// Reconstructs the DSL Env + expected return type for any formula field of a
// calendar definition, mirroring the per-attachment scoping in the backend
// compiler (src/lib/calendar/validate.ts). One source feeds both Monaco
// autocomplete and the client-side type-check lint.

import type { Env, ExpectedType, VarType } from "@dsl";
import type { CalendarDefinition, NamedValueDef } from "../../../api/types";

export type FieldRef =
  | { kind: "param"; paramIndex: number; field: "from" | "to" | "step" | "count" | "unitTicks" }
  | { kind: "derived"; derivedIndex: number }
  | { kind: "format"; style: "pretty" | "short"; paramName: string };

export interface DslScope {
  env: Env;
  expected: ExpectedType;
}

function valueIds(values: NamedValueDef[] | undefined): string[] {
  return (values ?? []).map((v) => (typeof v === "string" ? v : v.value));
}

function varTypeOf(type: "number" | "named" | "boolean", domain: string): VarType {
  if (type === "named") return { kind: "named", domain };
  return { kind: type };
}

/** Every Named domain declared anywhere in the definition (params + derived). */
function namedDomainsOf(def: CalendarDefinition): Map<string, string[]> {
  const domains = new Map<string, string[]>();
  for (const p of def.params) {
    if (p.type === "named") domains.set(p.name, valueIds(p.values));
  }
  for (const d of def.derivedFields ?? []) {
    if (d.type === "named") domains.set(d.name, valueIds(d.values));
  }
  return domains;
}

export function buildScope(def: CalendarDefinition, ref: FieldRef): DslScope {
  const namedDomains = namedDomainsOf(def);

  if (ref.kind === "param") {
    // Strict ancestors only (levels 0..paramIndex-1); null admitted for bounds.
    const vars = new Map<string, VarType>();
    for (const anc of def.params.slice(0, ref.paramIndex)) {
      vars.set(anc.name, varTypeOf(anc.type, anc.name));
    }
    const allowNull = ref.field === "from" || ref.field === "to";
    const expected: ExpectedType = allowNull ? { kind: "numberOrNull" } : { kind: "number" };
    return { env: { vars, namedDomains, allowNull }, expected };
  }

  if (ref.kind === "derived") {
    // All params + `tick`.
    const vars = new Map<string, VarType>();
    for (const p of def.params) vars.set(p.name, varTypeOf(p.type, p.name));
    vars.set("tick", { kind: "number" });
    const d = (def.derivedFields ?? [])[ref.derivedIndex];
    const expected: ExpectedType =
      d?.type === "named"
        ? { kind: "namedOrNumber", domain: d.name }
        : d?.type === "boolean"
          ? { kind: "boolean" }
          : { kind: "number" };
    return { env: { vars, namedDomains, allowNull: false }, expected };
  }

  // format: params up to (and including) the named level + all derived fields.
  const level = def.params.findIndex((p) => p.name === ref.paramName);
  const upTo = level === -1 ? def.params.length : level + 1;
  const vars = new Map<string, VarType>();
  for (const p of def.params.slice(0, upTo)) vars.set(p.name, varTypeOf(p.type, p.name));
  for (const d of def.derivedFields ?? []) vars.set(d.name, varTypeOf(d.type, d.name));
  return { env: { vars, namedDomains, allowNull: false }, expected: { kind: "string" } };
}

/** Identifiers Monaco should offer at the cursor for a given scope. */
export function scopeIdentifiers(scope: DslScope): { vars: string[]; domainValues: string[] } {
  const vars = [...scope.env.vars.keys()];
  const domainValues = [...new Set([...scope.env.namedDomains.values()].flat())];
  return { vars, domainValues };
}
