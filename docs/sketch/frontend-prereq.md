# Backend Prerequisites

Schema migrations and API changes required before frontend work begins. Ordered by dependency; steps within a tier are independent of each other and can be parallelised.

---

## Tier 1 — Entry model foundations
*Required before any frontend work on entry lists, tabs, search results, or relation display.*

### 1a. `EntryType` table + `Entry.type` FK migration

**Schema:**
```prisma
model EntryType {
  id          String  @id @default(uuid())
  worldId     String
  name        String  // display label e.g. "Character"
  slug        String  // API/storage value e.g. "character"
  iconName    String? // Phosphor icon identifier e.g. "User", "Sword"
  iconWeight  String? // "thin"|"light"|"regular"|"bold"|"fill"|"duotone"
  world       World   @relation(fields: [worldId], references: [id], onDelete: Cascade)
  entries     Entry[]

  @@unique([worldId, slug])
}
```

`Entry.type` changes from `String` to a FK referencing `EntryType.id`. The stored value in API responses should remain the slug (human-readable), not the UUID — resolve at query time.

**Migration strategy — two phases:**

Phase 1: create `EntryType` table, seed defaults on every existing world, assign all existing `Entry.type` string values to the closest matching seeded type (or a catch-all "Entry" type if no match). Phase 2 (separate migration): add FK constraint. Two-phase approach allows rollback of the constraint without losing the seeded data.

**Default types seeded on world creation:** Character, Location, Faction, Event, Object. All deletable if unused.

**New endpoints:**
```
GET    /worlds/:worldId/entry-types
POST   /worlds/:worldId/entry-types     { name, slug, iconName?, iconWeight? }
GET    /entry-types/:id
PATCH  /entry-types/:id                 { name?, slug?, iconName?, iconWeight? }
DELETE /entry-types/:id                 → 409 IN_USE if any Entry references it
```

### 1b. Icon fields on `RelationType`

Add nullable columns to existing table — no FK, no migration complexity.

```prisma
// Add to RelationType:
iconName   String?
iconWeight String?
```

Existing `PATCH /relation-types/:id` absorbs the new fields. No new endpoints needed.

---

## Tier 2 — Content model changes
*Required before frontend work on the entry body / block compositor.*

### 2a. `Document` → `Section` + content model change

**What changes:**
- Table renamed `Document` → `Section`
- `role` column dropped
- `filePath`, `status`, `uploadExpiresAt` columns dropped (presigned upload lifecycle removed for sections)
- `contentJson Json` column added (stores ProseMirror JSON document)
- `order Float` column added

**Migration:** existing Document rows migrate to Section rows with `contentJson: null` and `order` assigned by `createdAt` ascending within each entry.

**New API surface** (replaces Document endpoints entirely):
```
POST   /entries/:entryId/sections       { label? }
       → 201 { id, entryId, label, order, contentJson: null }

GET    /sections/:id
       → 200 { id, entryId, label, order, contentJson }

PATCH  /sections/:id                    { label?, contentJson?, order? }
       → 200
       Side effect: if contentJson present, synchronously extracts plain text
       (walk ProseMirror JSON for text nodes) and upserts SearchIndex row.
       Full document replace — no diff format.

DELETE /sections/:id                    → 204
```

No finalize endpoint. No presigned URL. No pending/ready/failed lifecycle.

### 2b. `order Float` on `Image`, `Sketch`, `Geometry`

Add `order Float` to each table. Default assigned by `createdAt` ascending within each entry.

No API contract changes beyond these fields appearing in responses and being settable via the existing PATCH endpoints for each artifact type.

---

## Tier 3 — Entry detail response: inline relations
*Required before frontend work on the entry body relation block.*

`GET /entries/:entryId` currently returns artifact arrays but not relations. Add `relations` to the response so the full entry view loads in a single request.

**Updated response shape** (additions highlighted):

```json
{
  "id": "…",
  "worldId": "…",
  "type": "character",
  "title": "…",
  "createdAt": "…",
  "updatedAt": "…",
  "tags": ["…"],
  "sections":   [ { "id": "…", "label": null, "order": 1.0, "contentJson": {} } ],
  "images":     [ { "id": "…", "label": "…", "order": 2.0, "status": "ready" } ],
  "sketches":   [ { "id": "…", "label": null, "order": 3.0, "status": "ready" } ],
  "geometries": [ { "id": "…", "crsId": "…", "label": "…", "order": 4.0,
                    "status": "ready", "bboxes": [], "properties": {} } ],
  "dateRanges": [ { "id": "…", "calendarId": "…", "rawComponents": {},
                    "tickStart": 1042, "tickEnd": 1043, "precisionTier": "exact" } ],
  "relations":  [ { "id": "…", "direction": "out", "fromId": "…", "toId": "…",
                    "type": { "id": "…", "name": "…", "inverseName": "…",
                              "iconName": "…", "iconWeight": "…" },
                    "otherEntry": { "id": "…", "title": "…", "type": "character",
                                    "iconName": "…", "iconWeight": "…" } } ]
}
```

Notes:
- `documents` key renamed to `sections`.
- `direction` is `"out"` (this entry is `fromId`) or `"in"` (this entry is `toId`) — client can render directional labels without further queries.
- `otherEntry` includes the resolved EntryType `iconName`/`iconWeight` so the relation block renders type icons without secondary lookups.
- Relations are not paginated in the entry detail response. The standalone `GET /entries/:entryId/relations` endpoint remains available for entries with unusually large relation sets.

---

## Tier 4 — UI persistence tables
*Required before frontend work on world switching and workspace state restoration. Independent of Tiers 1–3.*

### 4a. `WorldTheme`

```prisma
model WorldTheme {
  worldId           String  @id
  fontFamily        String?  // key into frontend font catalogue e.g. "lora"
  accentColor       String?  // hex e.g. "#7C6A4E"
  surfaceColor      String?  // hex
  darkMode          Boolean  @default(true)
  defaultIconWeight String   @default("duotone")
  world             World    @relation(fields: [worldId], references: [id], onDelete: Cascade)
}
```

```
GET  /worlds/:worldId/theme    → 200 (returns column defaults if no row exists — never 404)
PUT  /worlds/:worldId/theme    → 200 (upsert, all fields nullable)
```

### 4b. `WorkspaceState`

```prisma
model WorkspaceState {
  worldId      String   @id
  openEntryIds String[]  // ordered tab list
  sidebarState Json?     // search layer state, density toggle, sort/group prefs
  updatedAt    DateTime  @updatedAt
  world        World     @relation(fields: [worldId], references: [id], onDelete: Cascade)
}
```

```
GET  /worlds/:worldId/workspace-state    → 200 (returns empty defaults if no row)
PUT  /worlds/:worldId/workspace-state    → 200 (upsert)
```

Client autosaves on tab open/close, density toggle change, filter state change. No explicit user action required.

---

## Tier 5 — Calendar support endpoints *(Calendars add-on prerequisite)*
*Required before frontend work on the Calendars add-on (`addon-calendars.md`). Not needed for the initial build. Independent of Tiers 1–4.*

### 5a. `POST /calendars/:id/param-options`

Supports the generated date range picker. Client posts a partial prefix of already-selected rawComponents; server evaluates the DSL and returns valid options or range for the next parameter in the hierarchy.

```
POST /calendars/:id/param-options
Body: { "prefix": { "era": "AD", "year": 2 } }

200 — named param:
{ "nextParam": "month", "type": "named", "values": ["Frostwane", "Sunreach"] }

200 — number param:
{ "nextParam": "day", "type": "number", "from": 1, "to": 30 }

200 — prefix is already a full tuple:
{ "nextParam": null }

400 VALIDATION — invalid prefix (unknown param value, wrong type, non-contiguous)
404 — unknown calendar
```

Reuses existing DSL evaluation engine — new endpoint surface only, no new engine work.

### 5b. `POST /worlds/:worldId/calendars/validate-definition`

Supports live diagnostics in the Monaco calendar definition editor. Accepts a complete or partial definition JSON; returns structured diagnostics with source positions for gutter marker rendering.

```
POST /worlds/:worldId/calendars/validate-definition
Body: { "definition": { … } }

200 — valid:
{ "valid": true }

200 — invalid (not a 4xx — client wants diagnostics, not an error):
{
  "valid": false,
  "diagnostics": [
    {
      "path": "params[1].range.to.dsl",
      "message": "identifier 'mont' is not in scope; did you mean 'month'?",
      "line": 4,
      "col": 12
    }
  ]
}
```

`line`/`col` require the DSL parser to track source positions. If position tracking is not available initially, omit them — path-only diagnostics still allow Monaco to surface the error with a message even without inline gutter placement.

---

## Migration sequence summary

```
1a  EntryType table + Entry.type FK (two-phase)
1b  iconName/iconWeight on RelationType

2a  Document → Section rename + content model
2b  order Float on Image, Sketch, Geometry

3   Inline relations on GET /entries/:entryId

4a  WorldTheme table + endpoints
4b  WorkspaceState table + endpoints

5a  POST /calendars/:id/param-options
5b  POST /worlds/:worldId/calendars/validate-definition
```

**Initial build:** Tiers 1–4 only. Tiers 1 and 2 must be completed before any frontend entry-list or body compositor work. Tiers 4a and 4b can proceed in parallel with frontend shell work.

**Calendars add-on:** Tier 5 is required before building the calendar definition editor and generated date picker. No schema changes needed — Tier 5 is new endpoint surface only.

**Geometry add-on:** No additional backend work required. Geometry endpoints, globe/CRS endpoints, and bbox search are already in the API contract.