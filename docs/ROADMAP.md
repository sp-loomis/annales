# Roadmap

Where this goes next: frontend, then deploy. Plus known gaps in the backend
worth remembering.

## Frontend

Stack (per [STACK.md](STACK.md)): React + TypeScript, Leaflet + Leaflet-Geoman
for map *editing* on the flat equirectangular canvas, d3-geo(-projection) for
map *display* in custom projections, Excalidraw embedded for sketches.

### Open design question first

The main working surface is undecided — worth settling before scaffolding:

- **Notebook-centric**: entry list/detail is home; map is one artifact viewer
  among several. Cheapest to build, matches the data model 1:1.
- **Map-centric**: the world map is home; entries surface via markers/regions.
  Strong for spatial worldbuilding, but demands geometry coverage early.
- **Split canvas**: persistent map pane + entry pane, selection synced both
  ways. Most powerful, most layout work.

A reasonable v1: notebook-centric shell with a map *panel* that can grow into
the split view — postpones the hard commitment without blocking either end
state.

### Suggested incremental milestones

1. **Scaffold** — Vite + React + TS in `web/`; typed API client (hand-rolled
   `fetch` wrapper mirroring `docs/API.md`, or generate one later if the API
   grows an OpenAPI spec). Dev proxy to `:3000`.
2. **Worlds + entries CRUD** — world switcher, entry list with type/tag
   filters + cursor pagination, entry detail rendering all artifact metadata.
3. **Documents** — markdown editor; the three-step upload flow
   (create → presigned PUT → finalize) wrapped in one client function with
   optimistic pending/ready/failed status display. This client uploader is
   the template for all four artifact kinds.
4. **Images + sketches** — image dropzone (thumbnail grid from the
   `thumbnail` URLs), Excalidraw modal saving scene JSON through the same
   uploader.
5. **Map editing** — Leaflet + Geoman on the equirectangular canvas; draw /
   edit polygons and markers per entry; save as GeoJSON geometry artifacts;
   CRS picker.
6. **Map display** — d3-geo projected views (azimuthal, orthographic);
   bbox-driven loading via `search?bbox=`; `exact=true` for precise picking.
7. **Relations + graph** — relation editor on entry detail; graph view
   (`/entries/:id/graph`) rendered with something light (d3-force or
   cytoscape); `inverseName` for backward-edge labels.
8. **Search + timeline** — global search box (snippets come highlighted from
   the API); calendar/date-range editor; later a timeline view over ticks.

### Frontend-facing backend TODOs

- **CORS** — browser clients need it both on the API (Fastify `@fastify/cors`)
  *and* on the bucket (S3 CORS config allowing `PUT`/`GET` from the app
  origin) or presigned uploads will fail in-browser. Nothing needed for curl,
  everything needed for React.
- Consider `GET /worlds/:id/entries?bbox=` convenience or rely on `search`.

## Deploy

Target shape (per STACK.md): Terraform modules + Terragrunt per environment.

1. **State & skeleton** — remote state (S3 + lock table), `modules/` +
   `envs/dev|prod` Terragrunt tree.
2. **Data stores** — RDS Postgres (same engine as dev, no code changes);
   S3 bucket with **versioning enabled** (that's the file-history feature)
   + lifecycle rules for old versions; CORS config on the bucket.
3. **Compute** — the API is a stateless container: ECS Fargate (or App
   Runner / Fly.io if you want less Terraform) behind an ALB. `Dockerfile`
   not yet written — plain Node 20 image + `prisma migrate deploy` on boot
   (or as a release phase) then `node dist/server.js`.
4. **Config** — everything already flows through env vars
   (`src/config.ts`): `DATABASE_URL`, `S3_*`, `UPLOAD_TTL_SECONDS`, `PORT`.
   In AWS, drop the custom `S3_ENDPOINT` and the client falls through to
   real S3; IAM task role replaces the static test credentials (make the
   credentials block conditional — one small change in `storage.ts`).
5. **Auth** — v1 is single-user/no-auth by decision. Before exposing
   publicly: simplest is a shared bearer token or Cloudflare Access /
   Tailscale in front; the code was scoped so auth middleware can bolt on
   later without contract changes.
6. **Observability** — Fastify logger is currently off; enable pino JSON
   logs in production (`buildApp` flag) → CloudWatch. `/healthz` is already
   ALB-ready.
7. **CI** — GitHub Actions: typecheck + contract suite against service
   containers (postgres + localstack), then image build/push. The test suite
   needs no cloud resources — that's the point of LocalStack.

## Known gaps / deliberate v1 debt

- `GET /worlds` and world-config lists don't paginate (entries do); search
  `nextCursor` is always `null` (limit works, no cursor yet).
- Orphaned `pending`/`failed` artifact rows accumulate (display-only
  `failed`, no sweep) — fine until it isn't; a cleanup endpoint or TTL sweep
  is the fix.
- `table` calendar type is reserved but unimplemented; arithmetic calendars
  have no leap rules (by design — `table` will cover irregular years).
- Entry titles are not in the search index (only artifact text/labels) —
  probably wanted before the frontend search box ships.
- Raster ingestion (GDAL contour/polygonize) is offline-only by design and
  has no tooling in-repo yet.
- No rate limiting, no request body size tuning beyond Fastify defaults
  (uploads bypass the API, so this mostly doesn't matter).
