# Calendar DSL — open issues (engine handoff)

Two semantic issues found while using the calendar-definition web UI. Both live in the shared
DSL engine (`src/lib/dsl`), **not** the frontend. The web app only builds the type environment
(`web/src/features/settings/calendar/dslScope.ts`, mirroring `src/lib/calendar/validate.ts`) and
surfaces the engine's errors; the same inputs fail identically on the server via
`compileCalendar`. All line references below verified against current code.

This doc is a spec for whoever owns the DSL engine. No engine code has been changed.

---

## Issue 1 — expected Named domain is not pushed into `if` / `case` branches

### Symptom
A Named-typed result built with `if` fails to type-check:

```
return if year >= 1 then AD else BC        # error: cannot infer the domain of
                                            # Named literal 'AD' — compare or return
                                            # it where a domain is known
return AD                                   # OK
```

`case` with all-literal clauses fails the same way.

### Current behavior / root cause
- `typeExpr(expr, nullOk)` (`check.ts:163`) threads only `nullOk` — never an expected/target
  type. The `ExpectedType` (from `validate.ts`) is consulted in exactly one place, `checkReturn`,
  on the final result (`check.ts:86-87`).
- `if` types both branches bottom-up (`check.ts:208-217`). `case` likewise
  (`check.ts:339`, `:342`, `:355`); the subject's domain is used **only** to validate the `when`
  match keys (`check.ts:331-337`), never the clause result expressions.
- A bare identifier that is neither a local nor a bound var becomes `{kind:'namedLit'}`
  (`varType`, `check.ts:154`). A `namedLit` is resolved to a real domain in only three places:
  1. comparison against a concrete Named — `typeCompare` (`check.ts:258-265`)
  2. top-level return vs expected — `checkReturn` `namedOrNumber` (`check.ts:113-116`)
  3. a concrete **sibling** branch inside `unifyBranches` (`check.ts:373-381`)
- When *every* branch is a bare literal, `unifyBranches` finds no concrete sibling and throws at
  `check.ts:383-387`. Critically, this throw happens inside `typeExpr(program.ret, …)`
  (`check.ts:86`) **before** `checkReturn` (`check.ts:87`) — so the `namedOrNumber` resolution
  that would have supplied the domain (`check.ts:113-116`) never runs. That is why `return AD`
  works but `return if c then AD else BC` does not.
- `case` is affected identically. The reason `case` "works" in the fixtures is not that clauses
  get domain context — it is that at least one clause is independently concrete (a bound Named
  param/field, or Numbers), which lets `unifyBranches:373-381` resolve the sibling literals. A
  `case` whose clauses are all bare literals of the field's own domain fails with the same error.

### Proposed semantics
Thread the expected/target type (at minimum, a target Named domain) down into branch typing —
or have `unifyBranches` accept an optional expected-domain hint and resolve a trailing
all-`namedLit` branch set against it. The hint is supplied from the return context, and passed
through `if`/`case` when they are nested under a known domain. Net effect: bare literals in
branches resolve exactly as a direct `return <literal>` does today.

### Tests to add (`tests/unit/dsl`)
- Named-typed field: `return if cond then <litA> else <litB>` compiles and evaluates.
- `case` whose clauses are all bare literals of the field's own domain.
- Nested `if` inside a `case` clause.
- Negative: a genuinely wrong-domain literal (e.g. `return if c then January else BC` where the
  field domain is an era) still errors.

---

## Issue 2 — a computed String cannot be interpolated into a template

### Symptom
```
msg := "{month} {day}"
return "Date: {msg}"        # error: cannot interpolate a String inside
                            # a template (no nesting)
```

### Current behavior / root cause
- `typeTemplate` rejects any interpolated expression whose inferred type is `string`
  (`check.ts:397-399`). A `msg := "…"` local types to `{kind:'string'}` (a template expr types to
  string, `check.ts:413`; stored as a local at `check.ts:82`), so interpolating it hits line 397.
- Allowed interpolations today: Number, Named, Boolean (`check.ts:403`); a format spec is allowed
  only on Number (`check.ts:406-411`).
- The guard is purely type-based (`ty.kind === 'string'`) and cannot distinguish a *literal
  nested template* `"{ "x" }"` (the thing it meant to forbid) from a String-typed
  identifier/local. The parser already prevents nested template **syntax**, so this type-level
  guard is redundant for its stated intent and over-broad.

### Evaluator gap (must be fixed together)
`render` (`eval.ts:185-204`) handles number/boolean/named but has **no** `string` branch — a
string value falls through to `throw 'cannot render this value in a template'` (`eval.ts:203`).
So even if the checker allowed a String interpolation, evaluation would fail.

### Proposed semantics
- Checker: allow String-typed expressions (identifiers/locals) in interpolation slots; keep
  rejecting a format spec on a String (as for Named/Boolean). Retain any parser-level guard
  against literal nested-template syntax.
- Evaluator: add `if (typeof value === 'string') return value;` in `render` (`eval.ts` ~198).

### Tests to add
- `m := "{month} {day}"` then `return "Date: {m}"` renders the composed string.
- A format spec applied to a String interpolation still errors.

---

## Non-issue (documented as intended, no change)

A Named-typed derived field returning a plain **String** is intentionally rejected. The expected
type is `{kind:'namedOrNumber', domain}` (`validate.ts:331-334`); `checkReturn` accepts a Number
(index), a Named of the domain, or a resolvable literal (`check.ts:110-118`), and fails a String
with `rule must return Named(<domain>) or Number, got String`.

Rationale: a Named field's value must be a member of its declared domain so it can be displayed
(via the domain's display map) and used with `ordinal`. Arbitrary strings belong in `format`
rules, not Named fields. Keep as-is.

---

## Frontend note

No web change is needed for any of the above. `dslScope.ts` already builds the correct
`Env`/`ExpectedType`, and DSL errors already surface both inline (message under each formula box)
and as Monaco markers. The web app imports the same engine (`@dsl` / `@calendar` aliases), so once
the engine relaxes these rules the editor picks it up with no rebuild. After a fix, re-run the
`scripts/frontend-*` smoke checks with both dev servers up to confirm the now-valid formulae lint
clean.
