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
fields *derived from* files at finalize time (bbox, tsvector, extracted
text, cached GeoJSON properties). Rebuilding those derived fields from files
is always legal.

## Repo layout

```
prisma/
  schema.prisma          data model; Unsupported("box") / Unsupported("tsvector")
  migrations/            one init migration; GiST/GIN index DDL appended by hand
docker/init-db.sql       creates the sheaf_test database in the postgres container
docker-compose.yml       postgres:16 (:5433) + LocalStack S3 (:4566)
src/
  server.ts              entry point — buildApp() + listen
  app.ts                 app assembly: Prisma/Storage decorators, error envelope,
                         route registration
  config.ts              AppConfig from env, overridable per-instance (tests use this)
  lib/
    errors.ts            AppError + helpers (notFound, conflict, crossWorld, …)
    storage.ts           S3 wrapper: presign PUT/GET, head/get/put/bulk-delete bytes
    calendar.ts          tick conversion engine (arithmetic + ordinal)
    payloads.ts          semantic validation of uploads: GeoJSON, Excalidraw,
                         image magic bytes
    artifact-util.ts     derived artifact status, filePath convention,
                         bbox raw-SQL read/write
    search-index.ts      SearchIndex raw-SQL writes (tsvector column)
  routes/
    health.ts            GET /healthz (DB + storage probes)
    worlds.ts            world CRUD + cascading delete (incl. storage cleanup)
    entries.ts           entry CRUD, tags, cursor pagination, detail aggregation
    artifacts.ts         one lifecycle engine × 4 artifact kinds (see below)
    world-config.ts      one CRUD factory × 3 config resources (CRS, calendars,
                         relation types)
    date-ranges.ts       date-range CRUD; delegates tick math to lib/calendar
    relations.ts         relation CRUD + graph traversal (recursive CTE)
    search.ts            two-stage search (see below)
tests/
  global-setup.ts        migrate test DB, create + version the test bucket
  helpers.ts             app factory, DB reset, API-level builders, upload helpers
  fixtures.ts            tiny PNG, GeoJSON builders, Excalidraw scene builder
  contract/              105 contract tests, one file per resource area
scripts/demo.sh          end-to-end guided tour against a running server
requests.http            every endpoint as a REST-client scratchpad
```

## Request lifecycle

1. Fastify matches the route; the route's JSON Schema validates
   params/query/body. Failures never reach handlers — the global error
   handler converts them to `400 { error: { code: "VALIDATION" } }`.
2. The handler does existence checks itself (thrown `AppError`s carry status
   + code) — e.g. parent entry lookup, cross-world guards.
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

| Hook | documents | images | sketches | geometries |
|---|---|---|---|---|
| create body | `role`, `label?` | `contentType`, `label?` | `label?` | `crsId`, `label?` |
| `prepareCreate` | — | — | — | CRS exists + same world |
| `finalize` validation | UTF-8 | magic bytes match declared type | Excalidraw scene shape | GeoJSON Feature/FeatureCollection |
| `finalize` derivation | tsvector from text | webp thumbnail (sharp, ≤512px) | tsvector from scene text | bbox (raw SQL) + cached properties |
| extra response fields | `role` | `contentType`, `thumbnail` | — | `crsId`, `bbox`, `properties` |

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

- **`Geometry.bbox`** (`box` + GiST): written by `setBbox`, read by
  `getBboxes` (corner-order agnostic via LEAST/GREATEST), overlap-queried
  with the `&&` operator in search. This is core Postgres — no PostGIS.
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
runs first and narrows the candidate set.

Stage 2 only ever touches candidates:

- `exact=true`: candidate geometries' files are fetched from storage and
  tested with turf (`booleanIntersects`) against the query box — bbox
  overlap is necessary but not sufficient.
- `q` present: one more SQL pass computes `ts_rank` + `ts_headline` snippets
  for candidate index rows; entries are ordered by max rank.

Stage 1 is never bypassed — turf and ranking never see a full table.

## Calendar engine (`src/lib/calendar.ts`)

Pure functions, no I/O. `validateCalendarDefinition` gates calendar writes;
`computeTicks` converts as-authored `rawComponents` to the world tick line at
date-range write time (both stored — conversion is never lossy). Semantics
are pinned in the [API.md appendix](API.md#appendix-calendar-definitions--tick-semantics),
and the contract tests assert exact tick numbers.

## Testing approach

Contract tests only — they exercise the HTTP surface with a real Postgres
and a real (LocalStack) S3, including real presigned PUT/GET round trips
over HTTP. No mocks anywhere.

- Setup goes **through the API** (`tests/helpers.ts` builders), never the DB,
  so tests keep working across schema refactors.
- `tests/global-setup.ts` migrates `sheaf_test` and creates the versioned
  `sheaf-test` bucket once per run.
- Files run serially (`fileParallelism: false`) because they share the DB;
  each file truncates all tables per test.
- The upload-expiry ("failed") path is tested with a second app instance
  built with `uploadTtlSeconds: 0` — no sleeps, no clock mocking.

## Migrations

`prisma migrate dev --create-only`, then hand-append any index DDL Prisma
can't express, then `prisma migrate deploy`. (Plain `migrate dev` also works
but has hung post-apply in this environment — deploy is deterministic.)
