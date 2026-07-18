// Structured editor for a CalendarDefinition. The date schema (params, epoch,
// derived fields, formatting) is edited as form controls; every DSL formula is
// a value that may be a plain constant or a { dsl } rule, edited in Monaco with
// scope-aware autocomplete + type-check linting. Draft state lives here; the
// parent owns save.

import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Plus, Trash, ArrowUp, ArrowDown } from "@phosphor-icons/react";
import type {
  Attach,
  CalendarDefinition,
  CalendarParam,
  DerivedFieldDef,
  DslAttachment,
  NamedValueDef,
} from "../../../api/types";
import { Button } from "../../../components/Button";
import { TextInput } from "../../../components/TextInput";
import { IconButton } from "../../../components/IconButton";
import { TID } from "../../../testids";
import { buildScope, type DslScope, type FieldRef } from "./dslScope";
import type { DslEditorProps } from "./DslEditor";
import styles from "./Calendars.module.css";

const DslEditorLazy = lazy(() => import("./DslEditor"));

function Dsl(props: DslEditorProps) {
  return (
    <Suspense fallback={<div className={styles.editorLoading}>Loading editor…</div>}>
      <DslEditorLazy {...props} />
    </Suspense>
  );
}

// ---- attachment (const | formula) helpers ----

function isDsl(v: unknown): v is DslAttachment {
  return typeof v === "object" && v !== null && "dsl" in v;
}

function parseConst(raw: string, allowNull: boolean): number | null | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  if (allowNull && t.toLowerCase() === "null") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function constToStr(v: Attach<number | null> | undefined): string {
  if (v === undefined || isDsl(v)) return "";
  return v === null ? "null" : String(v);
}

/** A field that is a constant number|null or a DSL rule. */
function AttachField({
  label,
  value,
  onChange,
  scope,
  allowNull = false,
  fieldId,
}: {
  label: string;
  value: Attach<number | null> | undefined;
  onChange: (v: Attach<number | null> | undefined) => void;
  scope: DslScope;
  allowNull?: boolean;
  fieldId: string;
}) {
  const formula = isDsl(value);
  return (
    <div className={styles.attach}>
      <div className={styles.attachHead}>
        <label className={styles.smallLabel}>{label}</label>
        <select
          className={styles.modeSelect}
          value={formula ? "formula" : "const"}
          onChange={(e) =>
            onChange(e.target.value === "formula" ? { dsl: "return 0" } : allowNull ? null : 0)
          }>
          <option value="const">constant</option>
          <option value="formula">formula</option>
        </select>
      </div>
      {formula ? (
        <Dsl
          value={(value as DslAttachment).dsl}
          onChange={(dsl) => onChange({ dsl })}
          scope={scope}
          testId={TID.dslField(fieldId)}
        />
      ) : (
        <TextInput
          value={constToStr(value)}
          placeholder={allowNull ? "number or null" : "number"}
          onChange={(e) => onChange(parseConst(e.target.value, allowNull))}
          data-testid={TID.dslField(fieldId)}
        />
      )}
    </div>
  );
}

/** DSL-only field (derived expr, format override). */
function DslOnlyField({
  label,
  value,
  onChange,
  scope,
  fieldId,
}: {
  label: string;
  value: DslAttachment;
  onChange: (v: DslAttachment) => void;
  scope: DslScope;
  fieldId: string;
}) {
  return (
    <div className={styles.attach}>
      <label className={styles.smallLabel}>{label}</label>
      <Dsl
        value={value.dsl}
        onChange={(dsl) => onChange({ dsl })}
        scope={scope}
        testId={TID.dslField(fieldId)}
      />
    </div>
  );
}

// ---- named-values (de)serialization: "Jan=January, Feb" ----

function parseValues(s: string): NamedValueDef[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const eq = t.indexOf("=");
      if (eq === -1) return t;
      return { value: t.slice(0, eq).trim(), display: t.slice(eq + 1).trim() };
    });
}

function serializeValues(vals: NamedValueDef[] | undefined): string {
  return (vals ?? [])
    .map((v) => (typeof v === "string" ? v : v.display ? `${v.value}=${v.display}` : v.value))
    .join(", ");
}

function valueIds(vals: NamedValueDef[] | undefined): string[] {
  return (vals ?? []).map((v) => (typeof v === "string" ? v : v.value));
}

/**
 * Free-text editor for a Named domain's values. Keeps the raw typed string local
 * so in-progress commas/spaces survive — reflecting the parsed-then-serialized
 * value back on every keystroke would strip a just-typed trailing comma. Reseeds
 * only when the values change from outside (template load, reorder).
 */
function ValuesInput({
  values,
  onChange,
}: {
  values: NamedValueDef[] | undefined;
  onChange: (v: NamedValueDef[]) => void;
}) {
  const [text, setText] = useState(() => serializeValues(values));
  const external = serializeValues(values);
  useEffect(() => {
    if (external !== serializeValues(parseValues(text))) setText(external);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external]);
  return (
    <TextInput
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseValues(e.target.value));
      }}
    />
  );
}

// ---- main form ----

export function DefinitionForm({
  def,
  onChange,
}: {
  def: CalendarDefinition;
  onChange: (next: CalendarDefinition) => void;
}) {
  const params = def.params;
  const lastLevel = params.length - 1;

  const scopeFor = useMemo(
    () => (ref: FieldRef): DslScope => buildScope(def, ref),
    [def]
  );

  const patchParam = (i: number, patch: Partial<CalendarParam>) => {
    const next = params.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    onChange({ ...def, params: next });
  };

  const setParamType = (i: number, type: "number" | "named") => {
    const base: CalendarParam = { name: params[i].name, type };
    if (type === "named") base.values = params[i].values ?? ["one", "two"];
    else base.range = { from: 1, to: 12 };
    if (i === lastLevel) base.unitTicks = params[i].unitTicks ?? 1;
    onChange({ ...def, params: params.map((p, idx) => (idx === i ? base : p)) });
  };

  const moveParam = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j > lastLevel) return;
    const next = [...params];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...def, params: next });
  };

  const addParam = () => {
    const name = `param${params.length + 1}`;
    const next: CalendarParam[] = [
      ...params,
      { name, type: "number", range: { from: 1, to: 10 }, unitTicks: 1 },
    ];
    // Only the finest param carries unitTicks — strip it from the previous last.
    if (params.length > 0) delete next[params.length - 1].unitTicks;
    onChange({ ...def, params: next });
  };

  const removeParam = (i: number) => {
    if (params.length <= 1) return;
    const next = params.filter((_, idx) => idx !== i);
    const removed = params[i].name;
    const epoch = { ...def.epoch };
    delete epoch[removed];
    // Ensure the new finest param has unitTicks.
    if (next.length && next[next.length - 1].unitTicks === undefined) {
      next[next.length - 1] = { ...next[next.length - 1], unitTicks: 1 };
    }
    onChange({ ...def, params: next, epoch });
  };

  const setEpoch = (name: string, raw: string, named: boolean) => {
    const value: number | string = named ? raw : Number(raw);
    onChange({ ...def, epoch: { ...def.epoch, [name]: value } });
  };

  const derived = def.derivedFields ?? [];
  const patchDerived = (i: number, patch: Partial<DerivedFieldDef>) =>
    onChange({
      ...def,
      derivedFields: derived.map((d, idx) => (idx === i ? { ...d, ...patch } : d)),
    });
  const addDerived = () =>
    onChange({
      ...def,
      derivedFields: [
        ...derived,
        { name: `derived${derived.length + 1}`, type: "number", expr: { dsl: "return tick" } },
      ],
    });
  const removeDerived = (i: number) =>
    onChange({ ...def, derivedFields: derived.filter((_, idx) => idx !== i) });

  const setFormat = (style: "pretty" | "short", param: string, rule: DslAttachment | null) => {
    const format = { ...(def.format ?? {}) };
    const styleMap = { ...(format[style] ?? {}) };
    if (rule === null) delete styleMap[param];
    else styleMap[param] = rule;
    format[style] = styleMap;
    onChange({ ...def, format });
  };

  return (
    <div className={styles.form}>
      {/* PARAMS */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Date parameters (coarsest → finest)</h3>
        {params.map((p, i) => {
          const isNamed = p.type === "named";
          const isLast = i === lastLevel;
          return (
            <div key={i} className={styles.paramCard}>
              <div className={styles.paramHead}>
                <TextInput
                  className={styles.nameInput}
                  value={p.name}
                  onChange={(e) => patchParam(i, { name: e.target.value })}
                />
                <select
                  className={styles.modeSelect}
                  value={p.type}
                  onChange={(e) => setParamType(i, e.target.value as "number" | "named")}>
                  <option value="number">number</option>
                  <option value="named">named</option>
                </select>
                <span className={styles.spacer} />
                <IconButton label="Move up" onClick={() => moveParam(i, -1)}>
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton label="Move down" onClick={() => moveParam(i, 1)}>
                  <ArrowDown size={14} />
                </IconButton>
                <IconButton label="Remove parameter" onClick={() => removeParam(i)}>
                  <Trash size={14} />
                </IconButton>
              </div>

              {isNamed ? (
                <>
                  <div className={styles.field}>
                    <label className={styles.smallLabel}>values (comma-separated, id=Display)</label>
                    <ValuesInput
                      values={p.values}
                      onChange={(v) => patchParam(i, { values: v })}
                    />
                  </div>
                  <AttachField
                    label="count (optional active-domain length)"
                    value={p.count}
                    onChange={(v) => patchParam(i, { count: v === undefined ? undefined : (v as Attach<number>) })}
                    scope={scopeFor({ kind: "param", paramIndex: i, field: "count" })}
                    fieldId={`${p.name}-count`}
                  />
                </>
              ) : (
                <div className={styles.attachRow}>
                  <AttachField
                    label="range from"
                    value={p.range?.from}
                    onChange={(v) =>
                      patchParam(i, { range: { from: v ?? 0, to: p.range?.to ?? 0 } })
                    }
                    scope={scopeFor({ kind: "param", paramIndex: i, field: "from" })}
                    allowNull
                    fieldId={`${p.name}-from`}
                  />
                  <AttachField
                    label="range to"
                    value={p.range?.to}
                    onChange={(v) =>
                      patchParam(i, { range: { from: p.range?.from ?? 0, to: v ?? 0 } })
                    }
                    scope={scopeFor({ kind: "param", paramIndex: i, field: "to" })}
                    allowNull
                    fieldId={`${p.name}-to`}
                  />
                </div>
              )}

              <div className={styles.attachRow}>
                <AttachField
                  label="step (1 or -1)"
                  value={p.step as Attach<number | null> | undefined}
                  onChange={(v) => patchParam(i, { step: v === undefined ? undefined : (v as Attach<1 | -1>) })}
                  scope={scopeFor({ kind: "param", paramIndex: i, field: "step" })}
                  fieldId={`${p.name}-step`}
                />
                {isLast && (
                  <AttachField
                    label="unitTicks (ticks per unit)"
                    value={p.unitTicks}
                    onChange={(v) => patchParam(i, { unitTicks: v === undefined ? undefined : (v as Attach<number>) })}
                    scope={scopeFor({ kind: "param", paramIndex: i, field: "unitTicks" })}
                    fieldId={`${p.name}-unitTicks`}
                  />
                )}
              </div>
            </div>
          );
        })}
        <Button onClick={addParam} data-testid={TID.calendarAddParam}>
          <Plus size={14} /> Add parameter
        </Button>
      </section>

      {/* EPOCH */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Epoch (full date tuple at tick 0)</h3>
        <div className={styles.epochGrid}>
          {params.map((p) => {
            const named = p.type === "named";
            return (
              <div key={p.name} className={styles.field}>
                <label className={styles.smallLabel}>{p.name}</label>
                {named ? (
                  <select
                    className={styles.modeSelect}
                    value={String(def.epoch[p.name] ?? "")}
                    onChange={(e) => setEpoch(p.name, e.target.value, true)}>
                    <option value="" disabled>
                      choose…
                    </option>
                    {valueIds(p.values).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <TextInput
                    type="number"
                    value={String(def.epoch[p.name] ?? "")}
                    onChange={(e) => setEpoch(p.name, e.target.value, false)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* DERIVED */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Derived fields (from full tuple + tick)</h3>
        {derived.map((d, i) => (
          <div key={i} className={styles.paramCard}>
            <div className={styles.paramHead}>
              <TextInput
                className={styles.nameInput}
                value={d.name}
                onChange={(e) => patchDerived(i, { name: e.target.value })}
              />
              <select
                className={styles.modeSelect}
                value={d.type}
                onChange={(e) =>
                  patchDerived(i, {
                    type: e.target.value as DerivedFieldDef["type"],
                    values:
                      e.target.value === "named" ? d.values ?? ["one", "two"] : undefined,
                  })
                }>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="named">named</option>
              </select>
              <span className={styles.spacer} />
              <IconButton label="Remove derived field" onClick={() => removeDerived(i)}>
                <Trash size={14} />
              </IconButton>
            </div>
            {d.type === "named" && (
              <div className={styles.field}>
                <label className={styles.smallLabel}>values (comma-separated, id=Display)</label>
                <ValuesInput values={d.values} onChange={(v) => patchDerived(i, { values: v })} />
              </div>
            )}
            <DslOnlyField
              label="expr"
              value={d.expr}
              onChange={(expr) => patchDerived(i, { expr })}
              scope={scopeFor({ kind: "derived", derivedIndex: i })}
              fieldId={`derived-${d.name}`}
            />
          </div>
        ))}
        <Button onClick={addDerived} data-testid={TID.calendarAddDerived}>
          <Plus size={14} /> Add derived field
        </Button>
      </section>

      {/* FORMAT */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Formatting (per level; defaults apply where absent)</h3>
        {params.map((p) => {
          const pretty = def.format?.pretty?.[p.name];
          const short = def.format?.short?.[p.name];
          return (
            <div key={p.name} className={styles.paramCard}>
              <div className={styles.paramHead}>
                <strong className={styles.smallLabel}>{p.name}</strong>
              </div>
              {(["pretty", "short"] as const).map((style) => {
                const rule = style === "pretty" ? pretty : short;
                return (
                  <div key={style} className={styles.field}>
                    {rule ? (
                      <>
                        <div className={styles.attachHead}>
                          <label className={styles.smallLabel}>{style}</label>
                          <IconButton
                            label={`Remove ${style} override`}
                            onClick={() => setFormat(style, p.name, null)}>
                            <Trash size={12} />
                          </IconButton>
                        </div>
                        <Dsl
                          value={rule.dsl}
                          onChange={(dsl) => setFormat(style, p.name, { dsl })}
                          scope={scopeFor({ kind: "format", style, paramName: p.name })}
                          testId={TID.dslField(`format-${style}-${p.name}`)}
                        />
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => setFormat(style, p.name, { dsl: 'return ""' })}>
                        <Plus size={12} /> add {style} override
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>
    </div>
  );
}
