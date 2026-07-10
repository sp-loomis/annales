# Formal DSL Specification

## 1. Lexical Grammar

```ebnf
identifier     = letter , { letter | digit | "_" } ;
number_lit     = digit , { digit } , [ "." , digit , { digit } ] ;
named_lit      = identifier ;                 (* resolved against schema domain at type-check time *)
string_lit     = '"' , { string_char } , '"' ;
boolean_lit    = "true" | "false" ;

string_char    = ? any char except '"' and '{' '}' unescaped ? | escape_seq | interpolation ;
escape_seq     = "\\" , ( '"' | "\\" | "n" | "t" ) ;
interpolation  = "{" , expr , [ ":" , format_spec ] , "}" ;
format_spec    = ( digit , "d" )              (* zero-padded int width, e.g. 02d *)
               | ( "0." , digit , "f" ) ;      (* fixed decimal places, e.g. 0.2f *)

comment        = "#" , { any_char_except_newline } ;
```

Reserved words: `case when then else if and or not true false` , plus function names `ordinal ceil floor min max` , plus `return`.

Identifiers are case-sensitive. Bound variables (params) and function names share one namespace; shadowing a bound variable name with a local `:=` is a static error.

## 2. High-Level Syntax (EBNF)

```ebnf
program        = { statement } , return_stmt ;

statement       = assignment ;
assignment      = identifier , ":=" , expr ;

return_stmt     = "return" , expr ;

expr            = case_expr
                | if_expr
                | binary_expr ;

case_expr       = "case" , identifier ,
                   when_clause , { when_clause } ,
                   [ "else" , expr ] ;
when_clause     = "when" , named_lit , { "," , named_lit } , "then" , expr ;

if_expr         = "if" , expr , "then" , expr , "else" , expr ;

binary_expr     = ? Pratt-parsed; see §3 ? ;

primary         = number_lit
                | named_lit
                | boolean_lit
                | string_template
                | identifier
                | func_call
                | "(" , expr , ")" ;

string_template = '"' , { string_char } , '"' ;

func_call       = func_name , "(" , [ arg_list ] , ")" ;
func_name       = "ordinal" | "ceil" | "floor" | "min" | "max" ;
arg_list        = expr , { "," , expr }
                | expr , "," , "base" , "=" , number_lit ;   (* ordinal-only kwarg *)
```

**Program structure**: a rule body is zero or more `assignment` statements followed by exactly one `return_stmt`. `case`/`if` bodies (as `then`/`else` branches) are single `expr`, not sub-programs — they cannot contain their own `:=` statements. This keeps local binding at one flat scope level per rule body; no block-scoping complexity.

**Greedy branch consumption** (formalized): `when ... then <expr>`, `else <expr>`, and `if ... then <expr> else <expr>` all parse `<expr>` via the same entry point as top-level `binary_expr`, which recurses maximally — consumption stops only at a token that cannot extend the current expression (unmatched `)`, end of statement, or a keyword that only occurs at branch/statement boundaries: `when`, `else`, next `assignment`, or `return`). Parenthesization is the only way to terminate a branch expression early relative to this default.

## 3. Operator Grammar — Pratt Parsing Table

Binding powers, low → high. Higher binds tighter.

| Level | Operators | Assoc | Notes |
|---|---|---|---|
| 1 | `or` | left | boolean |
| 2 | `and` | left | boolean |
| 3 | `not` | prefix | boolean, unary |
| 4 | `= != < > <= >=` | non-assoc | numeric or Named; see §4.3 |
| 5 | `+ -` | left | numeric infix |
| 6 | `* / %` | left | numeric infix |
| 7 | unary `-` | prefix | numeric |
| — | `case`, `if` | n/a | not part of the binary table; parsed via `case_expr`/`if_expr` production, treated as a single `primary`-equivalent atom once fully parsed, embeddable only via explicit `(...)` per §2 |

Non-assoc on level 4 means `a = b = c` is a parse error — comparisons don't chain. (Prevents an ambiguity between "chained comparison" and "boolean of a comparison" semantics that the language never needed to support.)

`func_call` and `(expr)` and literals bind at maximum tightness (primary/nud position in Pratt terms).

## 4. Type System

### 4.1 Base types
`Number`, `Named`, `Boolean`, `String`. No compound/collection types.

### 4.2 Variable typing
Each identifier's type is fixed by the schema at the scope in which the rule body executes (bound parameters), or inferred from its `:=` at first assignment (locals). A local's type is fixed at its first assignment; re-assignment to a different type is a static error. No re-assignment to same name at all, actually — recommend **single static assignment**: each local name may be `:=`'d exactly once per rule body. Simplifies reasoning, costs nothing (bodies are short).

### 4.3 Operator typing rules

| Operator | Operand types | Result |
|---|---|---|
| `+ - * / %` | `Number, Number` | `Number` |
| unary `-` | `Number` | `Number` |
| `= !=` | `Number, Number` **or** `Named, Named` (same declared domain) | `Boolean` |
| `< > <= >=` | `Number, Number` only | `Boolean` |
| `and or` | `Boolean, Boolean` | `Boolean` |
| `not` | `Boolean` | `Boolean` |

`= !=` between two `Named` operands is legal only if both operands' declared domains are identical (i.e., same schema parameter, or two parameters explicitly declared over the same domain) — cross-domain `Named` comparison (e.g. comparing a month name to a segment name) is a static type error, not a runtime `false`.

`Named = Number`, `Named < Number`, any `Boolean`/`String` arithmetic, etc. are all static type errors.

`String` has no operators at all — it is produced only by `string_template` evaluation (interpolation) and consumed only by `return`. This is deliberate: string concatenation, comparison, etc. are all out of scope, matching the "String is a terminal display type, not a manipulable type" decision made earlier in this thread.

**Numeric domain and `%`.** `Number` values are real-valued *within* a rule body (so `year / 4` is `3.25`, and `floor`/`ceil` are meaningful). `%` is **floored (Euclidean)**: the result takes the sign of the divisor, so `-2 % 4 = 2` and `-1 % 7 = 6`. This makes residue-keyed rules (weekday, leap cycles, Metonic cycles) correct for pre-epoch (negative) ticks with no special-casing. Ticks and all bound parameter values are integers (schema, World-level); intermediate values produced inside a body may be fractional — it is the *returned* value that is constrained by its attachment point (§4.7).

### 4.4 Function signatures

| Function | Signature |
|---|---|
| `ordinal(p)` | `Named -> Number`; static error if `p` is not `Named`-typed |
| `ordinal(p, base=n)` | `Named, Number(literal) -> Number`; `base` must be an integer literal (0 or 1 typically), not an arbitrary expression |
| `ceil(x)`, `floor(x)` | `Number -> Number` |
| `min(x1, ..., xn)`, `max(x1, ..., xn)` | `Number, ..., Number -> Number`, n ≥ 2 |

`ordinal(p)` additionally requires (checked by the API's scope resolution, not DSL syntax): `p`'s full ancestor chain is bound at this point in the hierarchy. Violating this is reported as an unresolved-identifier-class error, since an ancestor-unbound `Named` param is, from the DSL's point of view, simply not in scope yet.

### 4.5 `case` typing

- Subject (the `identifier` after `case`) must be `Named`-typed.
- Each `named_lit` in each `when` clause must belong to the subject's declared domain. A literal outside that domain is a static error (typo-catching).
- **Exhaustiveness** (with no `else`): the union of all `when` clause literals, across all clauses, must equal the subject's full declared domain exactly. Static error listing missing values if not.
- **Reachability** (with `else` present): if the `when` clauses already cover the full domain, `else` is unreachable — static **warning** (not error), since it may be intentional defensive style.
- **Type uniformity**: every branch's `<expr>` (all `then` branches, plus `else` if present) must have the same result type. Mismatch is a static error. This result type becomes the type of the whole `case_expr`.

### 4.6 `if` typing

- Condition must be `Boolean`.
- `then` and `else` branches must have identical result type; that becomes the type of the `if_expr`.
- `else` is always mandatory (no exhaustiveness check needed or possible — binary by construction).

### 4.7 `return` typing

- The rule body's declared purpose fixes the expected return type: range-definition/duration functions return `Number`; format expressions return `String`; boolean-valued helper rules (if you choose to support them) return `Boolean`. The final `return_stmt`'s expression type must match. Mismatch is a static error at the point the rule is attached to its schema slot, not a generic DSL-level error — the DSL itself is type-agnostic about *what* return type is expected; the API supplies that constraint per attachment point.
- Beyond the base type, some attachment points constrain the *value*: a range/duration function must return a **positive integer** (a whole count of ticks or finer-units; magnitude only — never zero or negative, see Calendar Engine §4/§5), and a `step` function must return `+1` or `−1`. These value constraints are verified by the save-time fuzz test (§6.7) over the sampled domain, since they cannot always be proven statically from the function form.

## 5. String templates

- `"..."` with `{expr}` interpolation sites, `{expr:spec}` for format specs.
- `expr` inside `{}` may be any of `Number`, `Named`, `Boolean` typed (not `String` — no nested interpolation of a template inside a template in v1). `Named` auto-converts to its declared display name (no explicit cast syntax needed, unlike `ordinal()` which must be explicit for the reverse direction: `Named -> Number`).
- `format_spec` legal only when `expr` is `Number`-typed; applying a `format_spec` to `Named`/`Boolean` is a static error.
- `{expr}` uses default `str()` rendering per type when no spec given: `Named` → declared display name, `Boolean` → not expected to appear un-specced in practice but define as `"true"`/`"false"` for completeness, `Number` → plain decimal, no padding.

## 6. Static validation summary (all compile-time, before any rule is saved)

1. All identifiers resolved: bound params (ancestor-chain-gated), locals (SSA, one `:=` each), function names.
2. All operator operand types per §4.3.
3. All function call arities/types per §4.4, including `ordinal()`'s Named-only restriction and literal-only `base=`.
4. `case` subject is `Named`; all `when` literals in-domain; exhaustiveness or explicit `else`; branch type uniformity.
5. `if` branch type uniformity; `else` always present (grammar-enforced, not even a check — the EBNF makes it structurally impossible to omit).
6. Final `return` type matches the schema's expected type for that attachment point.
7. (Separate from static typing, done at save-time per earlier discussion): round-trip fuzz test over a sampled tick range, for calendar-completeness bugs the type system can't catch by construction.