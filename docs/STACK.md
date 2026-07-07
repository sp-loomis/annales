# Worldbuilding Platform — Cheat Sheet

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (frontend + backend) |
| Backend | Node (Express/Fastify) |
| ORM/migrations | Prisma |
| DB | Postgres (local Docker + RDS deployed — same engine, no mocking needed) |
| Frontend | React |
| Mapping — edit | Leaflet + Leaflet-Geoman, flat equirectangular canvas |
| Mapping — display | d3-geo + d3-geo-projection (custom azimuthal-equal-area, orthographic, others) |
| Mapping — exact ops | turf.js (point/polygon tests, simplify) |
| Sketching | Excalidraw |
| File storage | `ContentStore` interface — local disk (dev) / S3 (deployed) |
| Search | `ContentIndex` interface — Postgres tsvector+GIN now, pgvector later, same call signature |
| Graph traversal | Recursive CTEs over `Relation`; Apache AGE is a drop-in upgrade later if needed |
| Raster ingestion | Offline only — GDAL (`gdal_contour`/`gdal_polygonize`), never runtime |
| IaC | Terraform modules + Terragrunt per environment |

Core rule: files on disk (via `ContentStore`) are the source of truth for all creative payload — text, geometry, sketches, images. The DB never stores that payload inline, only metadata, cached/derived fields (bbox, tsvector), and a `filePath` pointer. This also gives file-level version history for free at the storage layer, rather than a version column/table in the DB: S3 native object versioning when deployed, git if the local dev directory is a repo. Rolling back a file just means re-deriving its cached DB fields on next index rebuild.

## Data structure

```prisma
model World {
  id   String @id @default(uuid())
  name String                                    // not null
}

model Entry {
  id        String   @id @default(uuid())
  type      String                              // not null
  title     String                              // not null
  worldId   String                              // not null, FK -> World
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // no canonicalPath — text is just another attachment now, see Document
}

model EntryTag {
  entryId String
  tag     String
  @@id([entryId, tag])                          // composite PK, dedupes naturally
}

// Body text is not special — it's one attachment type among several.
// An entry can have zero, one, or many (draft variants, notes, body, etc.).
model Document {
  id       String @id @default(uuid())
  entryId  String                               // not null, FK
  role     String                               // not null — 'body' | 'note' | 'draft', etc.
  label    String?                              // nullable — what this particular one is
  filePath String @unique                       // not null — S3-backed via ContentStore
}

model Image {
  id       String @id @default(uuid())
  entryId  String                               // not null, FK
  filePath String @unique                       // not null — S3-backed via ContentStore
  label    String?                              // nullable
}

// Graph edges. Versioning ("supersedes", "later-version-of") lives here
// too, as typed relations — no separate version table for now. [PIN: revisit
// if supersession chains need query performance beyond recursive CTEs.]
model Relation {
  id           String @id @default(uuid())
  fromId       String                            // not null
  toId         String                            // not null
  relationType String                            // not null — "causes", "located-in",
                                                   //   "member-of", "supersedes", etc.
}

// An entry may have zero, one, or many geometries (a region can have a
// territory polygon + a capital point — multiplicity is intentional).
// Payload lives in a file, not inline — same reasoning as Document: file
// versioning (S3 object versioning / git) gives edit history for free,
// no version column or history table needed here. A labeled point or
// small shape here also covers what used to be a separate Annotation
// model — dropped as redundant (see below).
model Geometry {
  id         String @id @default(uuid())
  entryId    String                              // not null, FK
  crsId      String                              // not null, FK — geometry is meaningless without it
  filePath   String @unique                      // not null — raw GeoJSON lives here
  label      String?                             // nullable — "territory outline", "capital marker", etc.
  properties Json?                               // nullable, cached from file — elevation, climate band, etc.
  bbox       Unsupported("box")                  // not null, derived from file at index time —
                                                   //   native Postgres box type + GiST index,
                                                   //   the real R-tree-equivalent (see indexing notes)
}

model CrsDefinition {
  id      String @id @default(uuid())
  worldId String                                 // not null, FK -> World
  name    String                                 // not null
  params  Json                                   // not null — rotation, projection type, clipAngle
  @@unique([worldId, name])
}

// Symmetric with Geometry: an entry may have zero, one, or many date
// ranges. Stores BOTH the canonical tick conversion AND the original
// as-authored calendar representation — never lossy, since "authored in
// calendar X" is worth preserving even after conversion.
model DateRange {
  id             String @id @default(uuid())
  entryId        String                          // not null, FK
  calendarId     String                          // not null, FK — range is meaningless without it
  rawComponents  Json                            // not null — as-authored (year/month/day, or
                                                   //   ordinal stage label)
  tickStart      Float?                          // nullable — null if unanchored ordinal
  tickEnd        Float?                          // nullable — null if open-ended/unknown
  precisionTier  String                          // not null — 'exact' | 'circa' | 'ordinal'
}

model Calendar {
  id         String @id @default(uuid())
  worldId    String                              // not null, FK -> World
  name       String                              // not null
  type       String                              // not null — 'arithmetic' | 'table' | 'ordinal'
  definition Json                                // not null — rule set specific to type
  @@unique([worldId, name])
}

// Payload lives in a file (same versioning-via-storage-backend reasoning
// as Geometry/Document) rather than inline JSON.
model Sketch {
  id       String @id @default(uuid())
  entryId  String                                // not null, FK
  label    String?                               // nullable
  filePath String @unique                        // not null — native Excalidraw/tldraw scene JSON
}

// No Annotation model — compositing a sketch-tool canvas onto a
// reprojectable Leaflet/d3-geo map is a real category mismatch (two
// independent camera systems, and straight lines don't survive
// reprojection). In-map markup is just a labeled Geometry (point or
// small shape), which reprojects through the same pipeline as
// everything else. A sketch that's genuinely about a place is a
// standalone Sketch linked via Relation, never drawn onto the live map.

// Unified text-search layer. One row per (artifact, extracted text),
// populated by a per-type extractor at index-build time — not stored
// text itself, a derived tsvector (see indexing notes below).
model SearchIndex {
  id         String @id @default(uuid())
  entryId    String                              // not null — for tag/world/date/geo filter joins
  sourceType String                              // not null — 'document' | 'geometry' | 'sketch' | 'image'
  sourceId   String                              // not null — id of the Document/Geometry/Sketch/Image row
  tsv        Unsupported("tsvector")             // not null, GIN-indexed
}
```

### Indexing — two stages: DB-level filter, then JS-level exact/relevance pass

**Stage 1 — Postgres, index-backed, always runs first, narrows candidates:**

| Query | Mechanism | Notes |
|---|---|---|
| Geo bbox overlap | Native `box` type + **GiST** index, `&&` operator | Core Postgres, no PostGIS/extension needed — this is the real R-tree-equivalent (jointly indexes both dimensions, not two separate axis scans) |
| Date range overlap | Plain btree on `tickStart`/`tickEnd` | 1D interval overlap doesn't need a special index type |
| Full text | `SearchIndex.tsv` column + **GIN** index, `@@` operator | Unified across artifact types via per-type extraction at index-build time: `Document` → strip markdown, tokenize; `Sketch`/`Image`/`Geometry` → index `label` if set, plus (for `Sketch`) the `text` fields pulled out of the scene JSON. `tsvector`/GIN = Postgres's built-in normalized/stemmed text representation + inverted index, the equivalent of SQLite FTS5. Never a live copy of raw body text — always derived at index time from the file/field |
| Tag / world_id / type | Plain btree / composite PK | Simple equality filters |

**Stage 2 — JS, runs only on Stage 1's narrowed candidate set:**

| Query | Mechanism |
|---|---|
| Exact polygon/point-in-polygon | turf.js |
| Relevance ranking | `ContentIndex.rank(query, candidateIds)` — tsvector rank today, swappable for embeddings/hybrid later |

Stage 1 never gets bypassed for Stage 2 work — turf.js and ranking only ever operate on whatever Postgres already narrowed down, never a full-table scan.