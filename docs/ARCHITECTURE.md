# Architecture

How the backend is put together. The contract itself (endpoints, shapes,
error codes) lives in [API.md](API.md); this document covers how the code
delivers it.

## Layers

```
HTTP (Fastify)
  │  JSON Schema validation per route → 400 VALIDATION before handlers run
  ▼
Route handlers (src/routes/)
  │  ownership/existence checks, world-boundary checks, orchestration
  ▼
Libraries (src/lib/)                      Prisma ──► Postgres  (metadata,
  │  calendar engine, payload parsers,                derived fields, indexes)
  │  search indexing, artifact helpers
  ▼
Storage (src/lib/storage.ts) ───────────► S3 / LocalStack  (all file payload,
                                           object versioning = edit history)
```

Core rule (from [STACK.md](STACK.md)): files are the source of truth for all
creative payload. The DB never stores payload inline — only metadata and
fields _derived from_ files at finalize time (bbox, tsvector, extracted
text, cached GeoJSON properties). Rebuilding those derived fields from files
is always legal.

## Repo layout

```
prisma/
  schema.prisma          data model; Unsupported("box") / Unsupported("tsvector")
  migrations/            one init migration; GiST/GIN index DDL appended by hand
docker/init-db.sql       creates the sheaf_test and sheaf_local databases in the postgres container
docker-compose.yml       postgres:16 (:5433) + LocalStack S3 (:4566)
src/
  server.ts              entry point — buildApp() + listen
  app.ts                 app assembly: Prisma/Storage decorators, error envelope,
                         route registration
  config.ts              AppConfig from env, overridable per-instance (tests use this)
  lib/
    errors.ts            AppError + helpers (notFound, conflict, crossWorld, …)
    storage.ts           S3 wrapper: presign PUT/GET, head/get/put/bulk-delete bytes
    dsl/                 calendar rule DSL: lexer, Pratt parser, typechecker +
                         dependency scan, evaluator (see docs/sketch/calendar-dsl.md)
    calendar/            calendar engine: definition compiler + static checks,
                         tick-order/Null-legality scans, period detection,
                         tick↔date conversion, formatting + derived fields
    payloads.ts          semantic validation of uploads: GeoJSON, Excalidraw,
                         image magic bytes
    geo.ts               d3-geo canonicalization: invert authored coords to the
                         globe's lng/lat, antimeridian split, pole handling
    artifact-util.ts     derived artifact status, filePath convention,
                         canonical bbox raw-SQL read/write (GeometryBox)
    search-index.ts      SearchIndex raw-SQL writes (tsvector column)
  routes/
    health.ts            GET /healthz (DB + storage probes)
    worlds.ts            world CRUD + cascading delete (incl. storage cleanup)
    entries.ts           entry CRUD, tags, cursor pagination, detail aggregation
    artifacts.ts         one lifecycle engine × 4 artifact kinds (see below)
    world-config.ts      one CRUD factory, two scopes: world-scoped (globes,
                         timelines, relation types) and parent-scoped (CRS under
                         a globe, calendars under a timeline)
    calendars.ts         POST /calendars/:id/convert (tick↔date + formatting)
    date-ranges.ts       date-range CRUD; delegates tick math to lib/calendar
    relations.ts         relation CRUD + graph traversal (recursive CTE)
    search.ts            two-stage search (see below)
tests/
  global-setup.ts        migrate test DB, create + version the test bucket
  helpers.ts             app factory, DB reset, API-level builders, upload helpers
  fixtures.ts            tiny PNG, GeoJSON builders, Excalidraw scene builder
  contract/              contract tests, one file per resource area
  unit/                  pure-logic unit tests (calendar DSL + engine) — no DB
scripts/demo.sh          end-to-end guided tour against a running server
requests.http            every endpoint as a REST-client scratchpad
```

## Request lifecycle

1. Fastify matches the route; the route's JSON Schema validates
   params/query/body. Failures never reach handlers — the global error
   handler converts them to `400 { error: { code: "VALIDATION" } }`.
2. The handler does existence checks itself (thrown `AppError`s carry status
   - code) — e.g. parent entry lookup, cross-world guards.
3. Data access goes through `app.prisma` (decorated `PrismaClient`); file
   operations through `app.store` (decorated `Storage`).
4. Any thrown `AppError` becomes the error envelope; unexpected errors log
   and return `500 INTERNAL`. Unknown routes get a `404 NOT_FOUND` envelope
   from the not-found handler.

Every app instance is self-contained (`buildApp(overrides)`) — tests build
apps with different config (e.g. `uploadTtlSeconds: 0`) side by side.

## The artifact lifecycle engine (`src/routes/artifacts.ts`)

Documents, images, sketches, and geometries share one presigned-upload
lifecycle, registered from a single `KindConfig` table. Each kind supplies
only what differs:

| Hook                  | documents          | images                          | sketches                 | geometries                                                        |
| --------------------- | ------------------ | ------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| create body           | `role`, `label?`   | `contentType`, `label?`         | `label?`                 | `crsId`, `label?`                                                 |
| `prepareCreate`       | —                  | —                               | —                        | CRS exists + its globe's world matches the entry                  |
| `finalize` validation | UTF-8              | magic bytes match declared type | Excalidraw scene shape   | GeoJSON Feature/FeatureCollection                                 |
| `finalize` derivation | tsvector from text | webp thumbnail (sharp, ≤512px)  | tsvector from scene text | canonical lng/lat bboxes via d3-geo (raw SQL) + cached properties |
| extra response fields | `role`             | `contentType`, `thumbnail`      | —                        | `crsId`, `bboxes`, `properties`                                   |

Status is **stored** as `pending`/`ready` but **served** as
`pending`/`ready`/`failed`: `failed` is computed at read time
(`pending` + upload window expired — `deriveStatus` in
`lib/artifact-util.ts`). There is no sweep job; a fresh
`POST /<kind>/:id/upload-url` revives a failed artifact.

Finalize is the only place derived fields are written, and the search index
only ever contains `ready` artifacts — an uploaded-but-unfinalized file is
invisible everywhere.

## Raw-SQL islands

Prisma cannot express two Postgres-native features we rely on, so these
columns are `Unsupported(...)` in the schema and all access is raw SQL,
concentrated in two small modules:

- **`GeometryBox.box`** (`box` + GiST): canonical lng/lat bbox(es) — a geometry
  has one, or two across the antimeridian. Written by `setBboxes`, read by
  `getBboxes` (corner-order agnostic via LEAST/GREATEST), overlap-queried with
  the `&&` operator in search. This is core Postgres — no PostGIS.
- **`SearchIndex.tsv`** (`tsvector` + GIN): written by `reindexArtifact`
  (which also stores the extracted plain text so `ts_headline` can build
  snippets without a storage round trip), queried with `@@` +
  `plainto_tsquery` in search.

The GiST/GIN index DDL lives in the migration file, hand-appended (Prisma
can't declare either). If you regenerate migrations, re-append it.

The graph traversal (`/entries/:id/graph`) is the third island: a recursive
CTE bounded by depth, deduped by `(id, depth)` so cycles terminate, reporting
`MIN(depth)` per node.

## Two-stage search (`src/routes/search.ts`)

Stage 1 is one SQL query over `Entry` composed of `EXISTS` sub-clauses — one
per active filter (tsvector match, tag equality, type equality, bbox `&&`
overlap, tick-interval overlap). Every clause is index-backed; this always
runs first and narrows the candidate set. The bbox clause joins `Geometry →
CrsDefinition` and scopes by `globeId` — canonical bboxes make one `&&` compare
every CRS under the globe; the query box (and each stored box) is split at the
antimeridian and the overlaps are OR'd. The tick clause joins `DateRange →
Calendar` and scopes by `timelineId`.

Stage 2 only ever touches candidates:

- `exact=true`: candidate geometries' files are fetched, reprojected to
  canonical lng/lat, then both they and the query box are projected into a
  query-local azimuthal frame (keeps turf's planar math valid across the
  antimeridian/poles) and tested with turf (`booleanIntersects`). bbox overlap
  is necessary but not sufficient.
  - That planar frame is only trustworthy within ~a hemisphere of the query
    centre; a polygon enclosing the frame's singularity would tear (turf is
    planar — spherical topology has no faithful single chart). So the exact pass
    is guarded by an angular horizon (90°): a **near-global query** skips the
    exact pass entirely (falls back to tier-1), and a **candidate reaching past
    the horizon** is conservatively **kept**, never dropped. The exact pass thus
    only ever removes candidates it can confidently reject — singularity-
    enclosing / near-global geometry is out of scope for exact refinement for
    now (a future spherical predicate, e.g. s2, would lift this).
- `q` present: one more SQL pass computes `ts_rank` + `ts_headline` snippets
  for candidate index rows; entries are ordered by max rank.

Stage 1 is never bypassed — turf and ranking never see a full table.

## Calendar engine (`src/lib/calendar/`, `src/lib/dsl/`)

Pure functions, no I/O; the authoritative spec is `docs/sketch/calendar-schema.md`
and `docs/sketch/calendar-dsl.md`, with the API-visible contract pinned in the
[API.md appendix](API.md#appendix-calendar-definitions--tick-semantics).

- `lib/dsl/` — the rule language: lexer (string templates lex their
  interpolations recursively), Pratt parser, typechecker (SSA locals, `case`
  exhaustiveness against declared Named domains, the Null carve-out), and
  evaluator (real-valued arithmetic with Euclidean `%`). The typechecker also
  emits a per-rule **dependency scan** — which ancestors a rule references,
  and whether every reference is `param % literal`.
- `lib/calendar/` — the engine. `compileCalendar` runs every static check at
  save time (scope gating, step ±1 in every branch, Null legality's three
  conditions with a step-derived tick-order extremality scan, epoch
  validation). Conversion runs over the **tick-order index**; `step` is a
  display-only label map, so countdown and alternating-step params need no
  special handling. The dependency scans feed **period detection**: widths
  with no ancestor deps are constant (Tier 0), mod-pattern deps are provably
  periodic with period lcm(moduli) and convert in closed form (Tier 1),
  anything else is summed on demand (Tier 2). No caching — closed forms are
  recomputed per query (spec §2); every accumulation is safe-integer-guarded.

Routes import only `lib/calendar/index.js` and map thrown `CalendarError`s to
400 `VALIDATION`. Calendars are compiled from their stored JSON per request.

## Testing approach

Contract tests exercise the HTTP surface with a real Postgres and a real
(LocalStack) S3, including real presigned PUT/GET round trips over HTTP. No
mocks anywhere. Pure logic (the calendar DSL and engine) is additionally
unit-tested in `tests/unit/` — no DB or S3, shared fixtures in
`tests/unit/calendar/fixtures.ts` (a leap-rule Gregorian and an open-ended
BC/AD calendar) that the contract tests reuse.

- Setup goes **through the API** (`tests/helpers.ts` builders), never the DB,
  so tests keep working across schema refactors.
- `tests/global-setup.ts` migrates `sheaf_test` and creates the versioned
  `sheaf-test` bucket once per run.
- `docker/localstack-init.sh` recreates versioned `sheaf-dev`, `sheaf-test`,
  and `sheaf-local` buckets on container startup.
- Files run serially (`fileParallelism: false`) because they share the DB;
  each file truncates all tables per test.
- The upload-expiry ("failed") path is tested with a second app instance
  built with `uploadTtlSeconds: 0` — no sleeps, no clock mocking.

## Migrations

`prisma migrate dev --create-only`, then hand-append any index DDL Prisma
can't express, then `prisma migrate deploy`. (Plain `migrate dev` also works
but has hung post-apply in this environment — deploy is deterministic.)
