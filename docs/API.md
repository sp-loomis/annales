# API Contract — v1

Single-user, no auth. JSON everywhere except file payloads (those go direct to
object storage via presigned URLs). All ids are UUIDs.

## Conventions

**Error envelope** — every non-2xx response:

```json
{ "error": { "code": "NOT_FOUND", "message": "entry 3f2a… not found", "details": {} } }
```

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION` | request body/params fail schema (Fastify JSON Schema) |
| 400 | `INVALID_PAYLOAD` | uploaded file fails semantic validation at finalize (bad GeoJSON, bad Excalidraw scene) |
| 400 | `CROSS_WORLD` | relation endpoints span two worlds |
| 404 | `NOT_FOUND` | resource or parent resource missing |
| 409 | `CONFLICT` | unique violation (duplicate name within a globe/timeline/world scope, duplicate relation) |
| 409 | `UPLOAD_MISSING` | finalize called but object not in storage |
| 409 | `IN_USE` | deleting a config row still referenced (CRS by geometries, calendar by date-ranges, globe by CRS, timeline by calendars) |

**Timestamps** ISO-8601 UTC. **Lists** return `{ "items": [...], "nextCursor": string | null }`; `?limit=` (default 50, max 200) + `?cursor=`.

---

## Worlds

| Method | Path | Body | 2xx | Errors |
|---|---|---|---|---|
| POST | `/worlds` | `{name}` | 201 `{id, name}` | 400 |
| GET | `/worlds` | — | 200 list | |
| GET | `/worlds/:worldId` | — | 200 `{id, name}` | 404 |
| PATCH | `/worlds/:worldId` | `{name}` | 200 | 400, 404 |
| DELETE | `/worlds/:worldId` | — | 204 | 404 |

DELETE cascades: entries, artifacts (rows + stored objects), relations, globes (→ CRS), timelines (→ calendars).

## Entries

| Method | Path | Body | 2xx | Errors |
|---|---|---|---|---|
| POST | `/worlds/:worldId/entries` | `{type, title, tags?: string[]}` | 201 | 400, 404 (world) |
| GET | `/worlds/:worldId/entries?type=&tag=` | — | 200 list (metadata only) | 404 |
| GET | `/entries/:entryId` | — | 200 full (below) | 404 |
| PATCH | `/entries/:entryId` | `{type?, title?}` | 200 | 400, 404 |
| PUT | `/entries/:entryId/tags` | `{tags: string[]}` | 200 `{tags}` — replaces set | 400, 404 |
| DELETE | `/entries/:entryId` | — | 204 | 404 |

`GET /entries/:entryId` — one call returns everything a detail view needs:

```json
{
  "id": "…", "worldId": "…", "type": "region", "title": "The Shattered Coast",
  "createdAt": "…", "updatedAt": "…",
  "tags": ["coastal", "ruined"],
  "documents":  [ { "id": "…", "role": "body", "label": null, "status": "ready" } ],
  "images":     [ { "id": "…", "label": "banner", "status": "ready" } ],
  "sketches":   [ { "id": "…", "label": null, "status": "pending" } ],
  "geometries": [ { "id": "…", "crsId": "…", "label": "territory", "status": "ready",
                    "bboxes": [ [minLng, minLat, maxLng, maxLat] ], "properties": {} } ],
  "dateRanges": [ { "id": "…", "calendarId": "…", "rawComponents": {},
                    "tickStart": 1042, "tickEnd": 1043, "precisionTier": "exact" } ]
}
```

`geometries[].bboxes` is canonical lng/lat (`[minLng, minLat, maxLng, maxLat]`), one or two boxes, `[]` while `pending`. `dateRanges[]` unchanged.

Entry DELETE cascades its artifacts (rows + objects) and any relations touching it.

## File-backed artifacts — shared lifecycle

Applies to **documents, images, sketches, geometries**. Three-step because
payload travels via presigned URL, not through the API:

1. **Create** — `POST /entries/:entryId/<kind>` with metadata. Returns
   `201 { id, status: "pending", upload: { url, method: "PUT", expiresAt } }`.
2. **Upload** — client PUTs the payload to `upload.url` (S3/LocalStack direct).
3. **Finalize** — `POST /<kind>/:id/finalize`. Server HEADs the object,
   validates payload semantically, derives cached fields (bbox, properties,
   tsvector rows), flips `status` to `"ready"`. Returns 200 full metadata.
   - 409 `UPLOAD_MISSING` if object absent.
   - 400 `INVALID_PAYLOAD` if validation fails (status stays `pending`, object retained so client can re-upload and finalize again).

Re-upload/edit content later: `POST /<kind>/:id/upload-url` → 200 fresh
presigned PUT for the **same** `filePath` (storage-level versioning keeps
history) → finalize again (re-derives cached fields).

Read: `GET /<kind>/:id` → 200 metadata + `download: { url, expiresAt }`
(presigned GET). Non-`ready` artifacts return metadata with `download: null`.
Images additionally return `thumbnail: { url, expiresAt } | null`.

Delete: `DELETE /<kind>/:id` → 204. Removes row + storage object (delete
marker under S3 versioning — history survives).

`status` is `"pending" | "ready" | "failed"`. `failed` is **derived, not stored**:
a `pending` artifact whose upload window (`upload.expiresAt`) has passed
reports `failed`. No sweep job — the row just displays as failed.
`POST /<kind>/:id/upload-url` on a failed artifact issues a fresh window and
it reports `pending` again. Search/index only ever sees `ready`.

### Per-kind create bodies + finalize validation

| Kind | Create body | Finalize validates / derives |
|---|---|---|
| Document | `{role, label?}` | UTF-8 text; derives tsvector |
| Image | `{label?, contentType}` (`image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`) | magic bytes match declared type; indexes label; generates thumbnail (sharp, max 512px long edge, webp) stored as a derived object next to the original — re-finalize regenerates it |
| Sketch | `{label?}` | parses as Excalidraw scene JSON; derives tsvector from scene text elements + label |
| Geometry | `{crsId, label?}` | parses as GeoJSON (Feature or FeatureCollection); reprojects the authored coords through the CRS's projection to the globe's canonical lng/lat and derives `bboxes` (1 box, or 2 across the antimeridian); caches `properties`; indexes label. Create-time crsId checks: **404** if crsId unknown, **400 `CROSS_WORLD`** if the CRS's globe belongs to a different world than the entry. **400 `INVALID_PAYLOAD`** at finalize if a coordinate falls outside the projection's domain |

## Date ranges (no file — plain sub-resource)

| Method | Path | Body | 2xx | Errors |
|---|---|---|---|---|
| POST | `/entries/:entryId/date-ranges` | `{calendarId, rawComponents, precisionTier}` | 201 | 400, 404 |
| PATCH | `/date-ranges/:id` | same fields, all optional | 200 | 400, 404 |
| DELETE | `/date-ranges/:id` | — | 204 | 404 |

Server computes `tickStart`/`tickEnd` from `rawComponents` + the calendar's
`definition` at write time. `rawComponents` is a **contiguous prefix** of the
calendar's parameter hierarchy (see appendix); 400 `VALIDATION` if a value is
outside its domain, a level is skipped, or a value has the wrong JSON type.
`tickStart`/`tickEnd` are integers; a side is `null` only when the denoted
unit is unbounded in that direction (an open-ended era).

## Relation types (per-world, user-defined edge vocabulary)

| Method | Path | Body | 2xx | Errors |
|---|---|---|---|---|
| POST | `/worlds/:worldId/relation-types` | `{name, inverseName?}` | 201 | 400, 404, 409 (name) |
| GET | `/worlds/:worldId/relation-types` | — | 200 list | 404 |
| PATCH | `/relation-types/:id` | `{name?, inverseName?}` | 200 | 400, 404, 409 |
| DELETE | `/relation-types/:id` | — | 204 | 404, 409 `IN_USE` if relations reference it |

`inverseName` is the label for reading an edge backwards ("located-in" →
"contains"); display-only, no semantics. Relations must reference a defined
type — strict FK, IN_USE-guarded on delete like globes/timelines.

## Relations

| Method | Path | Body | 2xx | Errors |
|---|---|---|---|---|
| POST | `/relations` | `{fromId, toId, typeId}` | 201 | 400 (`CROSS_WORLD` — entries or type in different worlds; self-loop), 404, 409 (exact duplicate) |
| GET | `/entries/:entryId/relations?direction=out\|in\|both&typeId=` | — | 200 `{items: [{id, fromId, toId, type: {id, name, inverseName}, otherEntry: {id, title, type}}]}` | 404 |
| DELETE | `/relations/:id` | — | 204 | 404 |
| GET | `/entries/:entryId/graph?depth=1..5&typeId=&direction=out\|in\|both` | — | 200 `{nodes: [{id, title, type, depth}], edges: [{id, fromId, toId, typeId}]}` — recursive CTE, breadth-limited; `direction` defaults to `both` | 400, 404 |

## Globes & timelines (per-world grouping)

A **globe** is a sphere that groups CRSs (its projections); a **timeline** is a
tick axis that groups calendars. Both are per-world config with a per-world
unique name and an `IN_USE` delete guard — same shape as relation types.

| Method | Path | Body | 2xx | Errors |
|---|---|---|---|---|
| POST | `/worlds/:worldId/globes` | `{name, params}` (`params.radius`) | 201 | 400, 404, 409 (name) |
| GET | `/worlds/:worldId/globes` | — | 200 list | 404 |
| GET / PATCH / DELETE | `/globes/:id` | `{name?, params?}` | 200 / 200 / 204 | 404, 409 (`IN_USE` if CRS reference it) |

Timelines identical at `/worlds/:worldId/timelines` + `/timelines/:id`, body
`{name, params?}`, DELETE 409 `IN_USE` if calendars reference it.

## CRS definitions & calendars (nested under globe / timeline)

A CRS belongs to a globe; a calendar belongs to a timeline. Its world is the
parent's world. Name is unique **per globe** (CRS) / **per timeline** (calendar).

| Method | Path | Body | 2xx | Errors |
|---|---|---|---|---|
| POST | `/globes/:globeId/crs` | `{name, params}` | 201 | 400, 404 (globe), 409 (name in globe) |
| GET | `/globes/:globeId/crs` | — | 200 list | 404 |
| GET | `/crs/:id` | — | 200 `{id, globeId, name, params}` | 404 |
| PATCH | `/crs/:id` | `{name?, params?}` | 200 | 400, 404, 409 |
| DELETE | `/crs/:id` | — | 204 | 404, 409 `IN_USE` if geometries reference it |

Calendars identical at `/timelines/:timelineId/calendars` + `/calendars/:id`,
body `{name, definition}`, serialized `{id, timelineId, name, definition}`,
DELETE 409 `IN_USE` if date-ranges reference it. The `definition` is compiled
and statically checked at save time (see appendix) — 400 `VALIDATION` with a
message naming the offending attachment point otherwise.

**PATCHing a `definition` recomputes the ticks of every dependent date range
in one transaction.** If any range's stored `rawComponents` no longer fit the
new definition, the whole PATCH fails 400 `VALIDATION`, naming the offending
date-range ids; nothing changes.

### Conversion

```
POST /calendars/:id/convert
Body: { "tick": 12345 }  XOR  { "date": { "era": "AD", "year": 2 } }
```

200 (both directions return the same shape):

```json
{
  "date": { "era": "AD", "year": 2, "month": "Frostwane", "day": 1 },
  "tickStart": 60, "tickEnd": 61,
  "pretty": "AD 2 Frostwane 1",
  "short": "2/2/1/1",
  "derived": { "weekday": "Monday" }
}
```

- `tick` → the full date tuple containing that tick, plus its one-unit interval.
- `date` (a contiguous prefix) → its `[tickStart, tickEnd)` interval; open
  sides are `null`.
- `pretty`/`short` render at the deepest bound level.
- `derived` (the calendar's derived fields) is present only for full tuples.
- Errors: 404 unknown calendar; 400 `VALIDATION` for both/neither of
  `tick`/`date`, a non-integer tick, a tick outside a bounded calendar's
  range, an invalid prefix, or a rule that is undefined at the queried point.

## Search

```
GET /worlds/:worldId/search
    ?q=              full text (tsquery over SearchIndex)
    &type=           entry type
    &tag=            repeatable, AND semantics
    &bbox=minLng,minLat,maxLng,maxLat   canonical lng/lat; geometry bbox overlap over the globe (stage 1) — with &exact=true, turf.js intersection pass (stage 2)
    &globeId=        required when bbox given — scopes the bbox search to one globe (compares all its CRSs in canonical frame)
    &tickStart=&tickEnd=        date-range overlap (integers)
    &timelineId=     required when tickStart/tickEnd given — scopes the date search to one timeline
    &limit=&cursor=
```

200:

```json
{
  "items": [
    { "entryId": "…", "title": "…", "type": "…", "rank": 0.61,
      "matches": [ { "sourceType": "document", "sourceId": "…", "snippet": "…the <b>shattered</b> coast…" } ] }
  ],
  "nextCursor": null
}
```

At least one filter required — bare search is 400. All filters compose (AND).
Rank present only when `q` given; otherwise items ordered by `updatedAt` desc.

## Misc

`GET /healthz` → 200 `{ok: true}` (checks DB + storage reachability, 503 otherwise).

---

## Appendix: calendar definitions & tick semantics

The authoritative design lives in `docs/sketch/calendar-schema.md` (schema +
engine) and `docs/sketch/calendar-dsl.md` (the rule DSL). This appendix pins
the API-visible contract.

### Ticks

A **tick** is a signed **integer** with no intrinsic duration — the timeline's
shared coordinate. All calendars in a **timeline** convert into that
timeline's tick line, which is what makes cross-calendar date-range overlap
queries meaningful (and why tick search is scoped by `timelineId`).
Granularity is user-managed: whatever a calendar's finest unit maps onto ticks
defines its resolution. Tick arithmetic is exact; values must stay within
±2^53 − 1 (400 `VALIDATION` beyond).

### Definition format (`version: 1`)

```jsonc
{
  "version": 1,
  "params": [ /* ordered, coarsest → finest */ ],
  "epoch": { "year": 1, "month": "Frostwane", "day": 1 },  // full tuple = tick 0
  "derivedFields": [ /* optional */ ],
  "format": { "pretty": { /* per-param overrides */ }, "short": { } }
}
```

Anywhere a value can be dynamic it is a JSON constant **or** `{"dsl": "<rule
body>"}` — a DSL program (assignments + one `return`) that may reference only
the param's **strict ancestors**. The top-level param must be fully static.

- **Number param** — `{ name, type: "number", range: { from, to }, step? }`.
  `from`/`to` are **tick-order anchors**: `from` labels the tick-first unit,
  `to` the tick-last. `step` (`1`/`-1`, default `1`, constant or DSL whose
  branches are literal ±1) maps labels onto the tick order — display only.
  A bound may be `null` = open-ended (see below).
- **Named param** — `{ name, type: "named", values: [...], count?, step? }`.
  Values are identifiers, or `{ "value": "Frostwane", "display": "The
  Frost's Wane" }` when the display name isn't identifier-shaped. `count`
  (constant or DSL) activates a prefix of `values` per scope (intercalary
  months).
- **Terminal param** additionally carries `unitTicks` (constant or DSL; must
  resolve to a positive integer): ticks per finest unit.
- **Derived fields** — `{ name, type: number|boolean|named, values?, expr:
  {dsl} }`; the expr may reference all params plus `tick`. Display-only.
- **Format overrides** — one DSL rule per level and style, returning a
  string template; a rule at level L may reference params at levels ≤ L and
  derived fields (tick-derived ones only at the terminal level). Defaults:
  pretty = space-separated with display names, short = slash-separated with
  1-based ordinals.

**Open-ended eras.** A `null` bound makes a branch unbounded (BC stretching
to −∞: `from: null, to: 1, step: -1`). Null is legal only when every ancestor
of the param is Named, the branch is tick-order-extremal at every ancestor
level, and never on `unitTicks`. Violations are 400 `VALIDATION` at save.

Example — BC/AD with open ends and countdown BC years:

```json
{
  "version": 1,
  "params": [
    { "name": "era", "type": "named", "values": ["BC", "AD"] },
    { "name": "year", "type": "number",
      "range": { "from": { "dsl": "return case era when BC then null when AD then 1" },
                 "to":   { "dsl": "return case era when BC then 1 when AD then null" } },
      "step":  { "dsl": "return case era when BC then -1 when AD then 1" } },
    { "name": "month", "type": "named", "values": ["Frostwane", "Sunreach"] },
    { "name": "day", "type": "number", "range": { "from": 1, "to": 30 }, "unitTicks": 1 }
  ],
  "epoch": { "era": "AD", "year": 1, "month": "Frostwane", "day": 1 }
}
```

Leap rules are plain DSL, detected as periodic and converted in closed form:

```json
{ "name": "day", "type": "number",
  "range": { "from": 1,
             "to": { "dsl": "leap := year % 4 = 0\nreturn case month when February then (if leap then 29 else 28) when April, June, September, November then 30 else 31" } },
  "unitTicks": 1 }
```

### `rawComponents`

An object binding a **contiguous prefix** of the params, coarsest-first. A
prefix bound down to unit U denotes U's whole interval `[tickStart, tickEnd)`
(`tickEnd` exclusive); a full tuple is one terminal unit and always finite.

- `{year: 2, month: "Frostwane", day: 1}` in 2×30-day years → `[60, 61)`
- `{year: 2}` → `[60, 120)` (whole year)
- `{era: "BC"}` in the era example → `tickStart: null, tickEnd: 0`

`precisionTier` (`exact` | `circa` | `ordinal`) is display semantics only —
it never changes the computed ticks.

### Errors

Structural problems, DSL type errors, non-exhaustive `case`s, scope
violations, illegal `null` bounds, and epoch violations are all rejected at
calendar save (400 `VALIDATION`, message naming the attachment). Rules that
are well-typed but undefined at a queried point (a width resolving
non-positive, a `count` out of range) fail the conversion with 400
`VALIDATION` naming the param and bound scope.
