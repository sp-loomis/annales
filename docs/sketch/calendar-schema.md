# Calendar Schema — Summary as Settled

## World-level

- **Tick**: the world's single shared timeline coordinate. A signed **integer**, unbounded, with smallest resolvable step = 1.
- A tick has **no intrinsic duration**. On its own it is a meaningless counter; it exists only to relate calendars to one another. All meaning is attached by the calendars a user defines on top of it.
- No world-level unit or granularity is chosen up front. Granularity is an emergent, **user-managed** consequence of how each calendar maps its finest parameter onto ticks. A day-resolution calendar might make one day = 1 tick. If the user later wants an hour-resolution calendar in the same world, they choose mappings that make both expressible (e.g. redefine the first calendar's day as 24 ticks so an hour = 1 tick). This bookkeeping is the user's responsibility — the platform does not auto-rescale.
- Because ticks are integers, all tick arithmetic (accumulation, comparison, `%`) is exact — no floating-point drift, no epsilon comparisons.

## Per-calendar definition

### Schema
Ordered list of parameters, coarsest → finest. Each parameter is typed:
- **Number**: has a step value (may be negative, enabling countdown-style params).
- **Named** (renamed from "String"): has a declared ordered list of accepted values. Distinct type from display `String` — only casts *to* String for rendering, never compared/arithmetic'd as one.

### Epoch
A single date (full parameter tuple) corresponding to tick = 0.

### Per-parameter range/duration rules
- For every parameter except the last: how many units of the *next* (finer) parameter fit in one unit of the current parameter. May be a constant (list for Named, ascending/descending range for Number per its step sign) or a DSL function.
- For the last (finest) parameter: how many ticks fit in one unit, constant or DSL function.
- **Governing rule (hard, no exceptions)**: any such function may reference all *ancestor* parameters (already bound, coarser than or equal to the parameter being defined — equal in the sense of "value not yet assigned, but scope is at this level") but never the parameter's own value or any descendant. The **top-level parameter has no ancestor**, so its domain must always be a static schema declaration, never a DSL function — this is the recursion base case.
- No period/periodicity declaration required from the user. The engine derives regularity itself (constant / mod-cycle detection — see Calendar Engine below) and otherwise computes on demand; the user never declares cycle hints.
- No explicit domain bound is declared. A calendar's valid range is exactly where its range/duration functions are total: a query that lands where a function has no defined result (an unmatched `case`, an undefined branch) fails with a natural "undefined here" error. Deliberately proleptic/unbounded ranges are expressed with open-ended eras (`from: Null` / `to: Null`, below).

### Derived fields
Named DSL expressions (Number/Named/Boolean-typed) computed from bound ancestor parameters **and/or raw tick** (e.g. `tick % 7` for weekday), not part of the parameter hierarchy itself. Used to support things like weekday names, Metonic golden numbers, or other display-only values without polluting the canonical schema.

### Formatting
- **Pretty** and **Short** rules, one per parameter level (each level's rule implicitly includes everything coarser — "no skipped levels," full ancestor prefix always bound before that level can be rendered; this is a hard rule for the same reason range functions require full ancestor binding).
- Defaults exist if unspecified (pretty: space-separated, names for Named; short: slash-separated, ordinals for Named) but any rule may be overridden by a full DSL rule body (statements + `return` of a `String` template).
- Same ancestor-chain-bound-scope rule applies: a level's formatting expression may reference any bound parameter up to and including itself, plus derived fields, but not descendants.

### Roman-style countdown dates (Kalends/Nones/Ides)
Resolved as: **encode as an extra Named layer in the schema if you need to do arithmetic in "countdown space"** (e.g. `Month → Segment(Named) → Countdown(Number, negative step, range dynamic per segment+month)`), but the **recommended default** is to keep the canonical schema simple (plain Number day-of-month) and generate the countdown purely as a formatting-layer `case`/`Named` computation — no duplicated logic needed since segment boundaries can be computed once via `case` and reused across the pretty/short rule bodies.

### Eras / BC-AD / negative years
Two patterns, chosen per calendar based on one test — **does the reset change the rules, or just the label?**
- **Label only** (BC/AD): keep year as a plain signed `Number` parameter; era name is purely a formatting-layer `case`/`if` transform. Must handle the "no year 0" off-by-one explicitly in the formatting expression (1 BC → AD 1 directly).
- **Structural reset** (regnal eras, etc.): era becomes a top-level `Named` parameter, with year's range/step declared dynamically as a function of era (already supported mechanically by the general range-function mechanism).

## `ordinal()` / categorical-numeric bridge

- Bare `Named` param reference is *never* numeric — no implicit cast, ever.
- `ordinal(param)` is the sole, explicit bridge `Named -> Number`, 1-indexed by default, optional `base=` kwarg (literal only).
- The list `ordinal()` counts against is always "this parameter's actual declared/computed domain in the current bound ancestor scope" (e.g. 12 or 13 months depending on the bound year, for a Metonic calendar).
- Once cast via `ordinal()`, the result is a plain `Number` — arithmetic on it may legitimately go "out of range" (e.g. 0-indexing, skip-intercalary counting schemes) with zero validation; that's explicitly the user's intent, not an error.
- `ordinal()` on an already-`Number`-typed parameter is a static type error (no redundant spelling for the same value).
- `Named = Named` (and `!=`) is legal directly (no need to route through `ordinal()`) provided both
  operands share the same declared domain; cross-domain `Named` comparison is a static error.

# Calendar Engine: Tick↔Date Conversion Spec

## 1. Dependency scan (shared foundation)

Identifier resolution is already a mandatory static pass (DSL §6.1). Retain its output per rule body instead of discarding it: for every range/duration function, record the set of ancestor parameters it actually references, and (for Tier 1 below) the syntactic form of each reference.

This artifact feeds period detection (§3), which decides whether a parameter's offsets have a closed form or must be summed on demand (§4).

## 2. No caching in v1

There is no persistent cache layer. Constant and mod-cyclic parameters (§3) reduce to closed-form arithmetic that is cheap to recompute on every query; everything else is summed on demand (§4). At worldbuilding scales (multi-thousand-year spans, integer ticks) on-demand summation is microseconds.

Caching is a later, purely **additive** optimization — introduce it only if profiling on real calendars demands it. It changes no results, only latency, so it can be bolted on without touching the schema or the conversion contract. Deferring it removes an entire class of cache-invalidation and memory-bound concerns from v1.

## 3. Period detection (derived, never asserted)

Run per range/duration function, using the dependency scan's syntactic detail:

- **Tier 0 — no dependency.** Function references no ancestor → provably constant. Multiplication/division only; no cache structure needed.
- **Tier 1 — mod-pattern periodicity.** Every occurrence of some ancestor `A` in the function appears only as `A % N` (directly, or as the subject of a `case`/`==` keyed on that residue), for one consistent literal `N`, and `A` never appears bare elsewhere in Number arithmetic. Then the function is provably invariant under `A → A + N` by substitution — not by sampling. Precompute one cycle's cumulative offsets (O(N) entries), answer all queries via `div`/`mod` against epoch, forever. This is the common case: leap-year rules, Metonic cycles, and most regnal arithmetic are naturally written this way since the DSL has no loops.
- **Tier 2 — fallback.** Dependency exists but doesn't match the Tier 1 syntactic pattern → no periodicity claim made. Offsets are computed on demand by direct summation (§4).

Run Tier 1's pattern match before any sampling-based validation; it's cheaper and, where it applies, exact rather than probabilistic. Sampling-based fuzz validation (already planned at save-time) remains as a *completeness* check against calendar-authoring bugs, not as the periodicity-detection mechanism itself.

## 4. On-demand conversion (Tier 2)

Where a parameter is neither constant nor mod-cyclic, its cumulative tick-offset is computed by **direct summation** — no galloping search, no checkpoint ladder, no cache. In practice at most one parameter per calendar is Tier 2 (the effectively-unbounded top-level counter), by construction of typical calendars. At worldbuilding spans this sum is trivial; galloping/checkpointing is a future optimization to add only if a real calendar is queried far enough from epoch to matter.

### Tick-order index (direction-agnostic core)

All offset math runs over a **tick-order index** `i = 0, 1, 2, …` within each parent scope — the i-th child unit in increasing-tick order — never over the parameter's displayed value. `step` is applied only at the display boundary, mapping index ↔ label (`step +1`: `label = from + i`; `step −1`: `label = to − i`). Consequences:

- Offsets accumulate positive magnitudes in tick order, so they are monotonic **by construction**, regardless of any parameter's step direction.
- Countdown parameters, and parameters whose step alternates across scopes (e.g. `step` keyed on a Number ancestor), need **no special handling** in the engine — the flip is purely a label mapping applied at the end, local to each parent instance.

### date → tick

Recursive descent. At each level, convert the label to its tick-order index (via `step`), then add `Σ width(j)` for `j` in `[0, i)` at that level, where `width` is the range/duration magnitude. Apply Tier 0/1 closed forms where available; only a Tier 2 level sums term-by-term.

### tick → date

Walk outward from epoch in tick order at the Tier 2 level, accumulating widths until the target tick falls inside one unit's `[start, start + width)`; that gives the tick-order index, which maps back to the label via `step`. Then descend into finer levels (cheap, bounded). Tier 0/1 levels are closed-form.

**Monotonicity invariant:** cumulative tick-offset must strictly increase with tick-order index. Because widths are always positive magnitudes (§5), this holds by construction. The save-time fuzz test (DSL §6.7) remains as a completeness check against authoring bugs — e.g. a range function that returns zero or a non-positive width.

## 5. Schema rules: `step`, `from`/`to`, and Null

**`step` is an attachment point**, parallel to range/duration and formatting — same rules (constant or DSL function, gated by the same ancestor-scope governing rule: may reference coarser ancestors, never itself or descendants). Must evaluate to a nonzero literal (`+1`/`-1`). No DSL grammar change required.

- **Magnitude and direction are separate.** Range/duration functions always return a positive magnitude — unconditionally, since the monotonicity invariant (§4) depends on cumulative tick-offset only ever increasing.
- **`step` governs how a parameter's own displayed value moves relative to the positive tick flow** — e.g. BC counting up as tick decreases. It does not affect unit width or offsets. It is a **display-only** map between tick-order index and label (§4), evaluated per parent instance at conversion time.
- **Step direction may vary freely across scopes** — including alternating on a Number ancestor, e.g. `step := if year % 2 == 0 then 1 else -1`. This does **not** threaten consistent tick↔date conversion: within any single parent instance all ancestors are bound, so `step` is a single value there and the label↔index bijection holds locally; offsets never depend on `step`. No runtime oscillation check is needed or performed. (Users may go as wild here as their imagination allows.)
- **Tick order vs. declaration order**: once `step` is dynamic, the order in which Named values are *declared* (schema list order) can diverge from the order in which they occur along the tick axis. Every rule below that says "tick-order" means *derived from step direction*, never declaration order.

**Null is a new base type**, legal *only* as a return value at the range/duration and `from`/`to` attachment points (never elsewhere — derived fields, formatting, step all reject it). Requires a narrow carve-out to branch-type-uniformity (§4.5/4.6 in the DSL spec): `Number`/`Null` may coexist in branches *only* at this attachment point. Null expresses an open-ended (unbounded) parameter range — a deliberately proleptic era stretching to ±∞ in tick.

**Legality condition:**

Null is legal on a parameter's `from` (open-backward) or `to` (open-forward) bound if and only if:

1. **Every ancestor from the schema's top down to and including the Null-bearing parameter is Named.** A single Number-typed link anywhere in that chain disqualifies Null at this branch — even if locally "terminal" — because a finer descendant still needs to resolve for every value of that Number ancestor, including its last one. (Canonical trap: Null day-count on December silently un-terminates Year and everything above it, even though December looks locally terminal.) This all-Named requirement is also what makes the branch's tick-order **statically computable**: with no Number ancestor in the chain, `step` depends only on finitely-many Named values, so the induced tick-order is a finite object computed once as a static pass. (Where a chain *does* contain a Number ancestor, Null is simply unavailable, and step's direction there is resolved per-instance at runtime instead — §4 — which is fine because no static extremality claim is being made.)
2. **The branch is tick-order-extremal at that end, simultaneously at every level in the chain** — first-in-tick-order for an open `from`, last-in-tick-order for an open `to` — using the derived tick order from `step`, not declaration order.
3. **The finest (terminal) parameter's tick-width stays positive and finite; Null is never legal there.** The terminal parameter's only declaration is "how many ticks = one unit of this," which must always resolve to a positive number (it may be a formula, but the result must be positive), or nothing advances. Countdown at the finest level (Roman-style day counting) is expressed by a negative `step` and/or a descending `from`/`to` range — never by a non-positive width.

Both ends of a chain may independently be open (BC: `from: Null, to: 1, step: -1`; AD: `from: 1, to: Null, step: 1`) — check each bound separately against condition 2.

**Static checks, all at save time, no runtime fallback:**
- Null under any `if`/Number-comparison is rejected outright — no exhaustiveness concept exists for Number domains, so there's no sound way to verify a Null branch there is genuinely extremal. Null is legal only under a `case` on Named.
- Ancestor-chain-all-Named scan (condition 1).
- Tick-order-extremality scan using the step-derived order, applied recursively up the chain (condition 2).