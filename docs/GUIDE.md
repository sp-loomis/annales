# User Guide

Running the backend and frontend, talking to the API, and looking inside it
all while it runs.

## Prerequisites

- Node 20+ (`node --version`)
- Podman (all local container commands use `podman` directly; with real
  Docker, substitute `docker` — everything below works the same)
- `jq` (for `scripts/demo.sh` and pleasant curl output)

## First-time setup

```sh
podman machine start                              # once per boot
npm run compose:up                                # postgres :5433, LocalStack :4566
npm install --cache /tmp/npm-cache-sheaf          # see Troubleshooting for why --cache
npx prisma migrate deploy                         # apply schema to the dev DB
npx prisma generate
cp .env.example .env                              # npm run dev loads this automatically
```

Buckets (`sheaf-dev`, `sheaf-test`, `sheaf-local`) are created — versioning enabled — by a
LocalStack boot hook (`docker/localstack-init.sh`) on every container start;
community LocalStack keeps S3 state in memory, so they'd otherwise vanish on
restart. Postgres data survives restarts via the `sheaf-pgdata` volume.

## Local Mode (Isolated Data)

Use local mode when you want to use the app as a real user without touching
your normal dev data.

```sh
npm run local
```

This starts both servers and keeps data isolated:

- API: `http://localhost:3001`
- Frontend: `http://localhost:5174`
- Database: `sheaf_local`
- Bucket: `sheaf-local`

Notes:

- `npm run dev` and `npm run dev:web` remain unchanged (`:3000`/`:5173`,
  `sheaf`, `sheaf-dev`).
- `npm run local` ensures `sheaf_local` and `sheaf-local` exist, applies
  migrations to `sheaf_local`, then starts both dev servers.
- If Podman containers are not running, start them first with
  `npm run compose:up`.

## Everyday commands

```sh
npm run dev          # API on http://localhost:3000, restarts on save
npm run dev:web      # frontend on http://localhost:5173 (needs the API up too)
npm run local        # isolated API+frontend on :3001 + :5174
npm test             # 360 contract + unit tests (containers must be up)
npm run typecheck    # backend; `npm run typecheck -w web` for the frontend
npm run compose:down # stop containers (data volumes persist)
```

Readiness after `compose:up` (podman-compose has no `--wait`):

```sh
podman exec sheaf_postgres_1 pg_isready -U sheaf
curl -s localhost:4566/_localstack/health | jq .services.s3
```

## Frontend dev mode

The React app lives in `web/` (an npm workspace — the root `npm install`
covers it; there is no separate install step). Run it alongside the API:

```sh
npm run dev        # terminal 1 — API on :3000
npm run dev:web    # terminal 2 — Vite dev server on http://localhost:5173
```

Open http://localhost:5173. First run shows a "create your first world" card;
after that the header's world switcher, the sidebar search, and the tabbed
entry workspace are the whole surface. State worth knowing about:

- **How requests flow** — the frontend always calls `/api/...`; the Vite dev
  server proxies that to `http://localhost:3000` and strips the prefix
  (`web/vite.config.ts`). So the browser only ever talks to :5173 — except
  image/sketch payloads, which PUT/GET **directly against LocalStack :4566**
  via presigned URLs. If images upload but never display, check LocalStack,
  not the API.
- **CORS** — the API also allows `http://localhost:5173` directly
  (`CORS_ORIGINS` env, comma-separated, in `src/app.ts`). Only needed when
  bypassing the proxy, e.g. tools hitting :3000 from a browser context.
- **Where UI state lives** — open tabs and sidebar filters persist per world
  in the backend (`WorkspaceState`), theme in `WorldTheme` (both instant-save;
  no save button). Panel widths persist in `localStorage` (`sheaf-layout`),
  last active world in `localStorage` (`sheaf:lastWorldId`). "Reset the UI" =
  clear those two localStorage keys and PUT empty workspace-state.
- **Playwright hooks** — every interactive control carries a `data-testid`
  from the central registry `web/src/testids.ts`. Add new ids there, never
  inline.
- **Browser smoke checks** — with both servers up:

  ```sh
  node scripts/frontend-smoke.mjs   # renders? console errors? screenshot to /tmp
  node scripts/frontend-e2e.mjs     # search → edit → save → persist round-trip
  ```

- **Production build** — `npm run build -w web` → static bundle in
  `web/dist/` (no server config yet; any static host + a reverse proxy
  mapping `/api` → the API port works).

Frontend architecture notes (stack, state model, save orchestration, theming)
live in `web/README.md`.

Dev-mode gotchas:

| Symptom | Cause / fix |
|---|---|
| Blank page + `504 Outdated Optimize Dep` in console | Vite's dep cache went stale after `node_modules` changed. Restart `npm run dev:web` |
| "Invalid hook call" / two Reacts | React is pinned to 18 (Excalidraw's peer range); a stray `web/node_modules/react` from an old install can shadow it. `rm -rf node_modules web/node_modules package-lock.json && npm install --cache /tmp/npm-cache-sheaf` |
| Images stuck "pending" | Presigned PUT goes browser→LocalStack directly; confirm :4566 is up and the bucket exists (`curl -s localhost:4566/_localstack/health`) |

## Throwing requests at it

Three options, pick your poison:

1. **`./scripts/demo.sh`** — guided tour. Seeds a world with entries,
   uploads a document and a geometry through the real presigned-URL flow,
   creates relations and date ranges, then runs searches and a graph
   traversal, narrating every call. Safe to run repeatedly (fresh world each
   time). `BASE=http://localhost:3123 ./scripts/demo.sh` to point elsewhere.
2. **`requests.http`** — every endpoint as an editable scratchpad for the VS
   Code REST Client extension (or IntelliJ's HTTP client). Variables at the
   top; responses show inline.
3. **Raw curl** — the walkthrough below.

### curl walkthrough: the full artifact lifecycle

```sh
BASE=http://localhost:3000

# 1. A world, a globe (sphere), and a CRS (a projection of it) to draw in
WORLD=$(curl -s -X POST $BASE/worlds -H 'content-type: application/json' \
  -d '{"name":"Aldervane"}' | jq -r .id)
GLOBE=$(curl -s -X POST $BASE/worlds/$WORLD/globes -H 'content-type: application/json' \
  -d '{"name":"terra","params":{"radius":57.29578}}' | jq -r .id)
CRS=$(curl -s -X POST $BASE/globes/$GLOBE/crs -H 'content-type: application/json' \
  -d '{"name":"main","params":{"type":"equirectangular"}}' | jq -r .id)

# 2. An entry (type must be one of the world's EntryType slugs — defaults:
#    character, location, faction, event, object)
ENTRY=$(curl -s -X POST $BASE/worlds/$WORLD/entries -H 'content-type: application/json' \
  -d '{"type":"location","title":"The Shattered Coast","tags":["coastal"]}' | jq -r .id)

# 3. Attach a section — prose lives in the DB as ProseMirror JSON, no upload
SECTION=$(curl -s -X POST $BASE/entries/$ENTRY/sections -H 'content-type: application/json' \
  -d '{"label":"Overview"}' | jq -r .id)
curl -s -X PATCH $BASE/sections/$SECTION -H 'content-type: application/json' \
  -d '{"contentJson":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Salt and ruin, west of the old kingdom."}]}]}}' \
  | jq '{id, label}'

# 4. Attach a sketch — THREE steps because payload travels by presigned URL
#    (a) create: metadata + a presigned PUT slot
SKETCH=$(curl -s -X POST $BASE/entries/$ENTRY/sketches -H 'content-type: application/json' \
  -d '{"label":"coastline"}')
SKETCH_ID=$(echo "$SKETCH" | jq -r .id)
UPLOAD_URL=$(echo "$SKETCH" | jq -r .upload.url)

#    (b) upload: PUT the payload straight to (LocalStack) S3 — not the API
curl -s -X PUT "$UPLOAD_URL" -H 'content-type: application/json' \
  --data-binary '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}'

#    (c) finalize: server validates, derives cached fields, flips to ready
curl -s -X POST $BASE/sketches/$SKETCH_ID/finalize | jq '{id, status}'

#    Read it back — download is a presigned GET
curl -s $BASE/sketches/$SKETCH_ID | jq .download.url

# 5. Search (section text is indexed on PATCH; artifact text at finalize.
#    NOTE: entry TITLES are not in the FTS index — the frontend matches them
#    client-side; over the raw API search for body text)
curl -s "$BASE/worlds/$WORLD/search?q=ruin" | jq .

# 6. Entry detail aggregates everything — sections, artifacts AND relations inline
curl -s $BASE/entries/$ENTRY | jq .
```

Geometries are the same lifecycle with `{"crsId":"$CRS"}` in the create body
and a GeoJSON Feature/FeatureCollection as the payload; images add
`{"contentType":"image/png"}` and get a `thumbnail` presigned URL after
finalize.

Error responses always look like:

```json
{ "error": { "code": "UPLOAD_MISSING", "message": "…", "details": {} } }
```

Codes and when they fire: [API.md → Conventions](API.md#conventions).

## Investigating the live S3 bucket

LocalStack ships `awslocal` (aws CLI pre-pointed at itself) inside the
container — no local AWS CLI needed:

```sh
# What's in the bucket? Keys mirror the DB's filePath convention:
# worlds/<worldId>/entries/<entryId>/<kind>/<artifactId>.<ext>
podman exec sheaf_localstack_1 awslocal s3 ls s3://sheaf-dev --recursive --human-readable

# Read an object
podman exec sheaf_localstack_1 awslocal s3 cp \
  "s3://sheaf-dev/worlds/<…>/documents/<…>.md" -

# Edit history (needs bucket versioning enabled — re-upload + finalize an
# artifact and you'll see multiple versions of the same key)
podman exec sheaf_localstack_1 awslocal s3api list-object-versions \
  --bucket sheaf-dev --prefix "worlds/" \
  | jq '.Versions[] | {Key, VersionId, LastModified, IsLatest}'

# Fetch a specific old version
podman exec sheaf_localstack_1 awslocal s3api get-object \
  --bucket sheaf-dev --key "<key>" --version-id "<versionId>" /tmp/old.md
```

If you have the AWS CLI installed locally, the same works from the host:
`aws --endpoint-url http://localhost:4566 s3 ls s3://sheaf-dev --recursive`
(credentials `test`/`test`, region `us-east-1`).

Handy correlation: presigned URLs in API responses contain the object key in
the path — you can eyeball which DB row maps to which object.

## Investigating the database

```sh
podman exec -it sheaf_postgres_1 psql -U sheaf -d sheaf
```

Useful looks:

```sql
-- what's indexed for search (text is the derived extract, tsv the vector)
SELECT "entryId", "sourceType", left(text, 60) AS text FROM "SearchIndex";

-- geometry bboxes (native box type — this is what the GiST index serves)
SELECT id, label, bbox FROM "Geometry";

-- artifact lifecycle state (failed = pending + expired window, derived at read)
SELECT id, status, "uploadExpiresAt", "filePath" FROM "Sketch";

-- the relation graph
SELECT rt.name, ef.title AS from_title, et.title AS to_title
FROM "Relation" r
JOIN "RelationType" rt ON rt.id = r."typeId"
JOIN "Entry" ef ON ef.id = r."fromId"
JOIN "Entry" et ON et.id = r."toId";
```

The test database is `sheaf_test` on the same container — same queries work
mid-test-debugging.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cannot connect to Podman` | `podman machine start` (needed once per boot) |
| `npm install` fails EACCES/EEXIST in `~/.npm/_cacache` | Root-owned entries from an old `sudo npm`. Either `sudo chown -R 501:20 ~/.npm` once, or keep using `--cache /tmp/npm-cache-sheaf` |
| Presigned PUT returns 400 `x-amz-checksum-crc32 header is invalid` | AWS SDK ≥3.729 flexible-checksum default. Already disabled in `src/lib/storage.ts` (`requestChecksumCalculation: 'WHEN_REQUIRED'`) — if you build another S3 client, do the same |
| `prisma migrate dev` hangs after applying | Environment quirk. Use `--create-only` + `prisma migrate deploy` instead |
| Port 5433/4566 already bound | Another compose project; `podman ps` and stop it, or change ports in `docker-compose.yml` + `.env` |
| `docker: command not found` in npm scripts | `docker` is only a zsh alias here — non-interactive shells don't see it. Local scripts/docs use `podman` directly for this reason |
| `/healthz` returns 503 | Body says which probe failed (`db` / `storage`). `db: false` usually means `.env` wasn't loaded (run via `npm run dev`, not bare `tsx`) or containers are down; `storage: false` means LocalStack is down or the bucket is missing |
| Artifact stuck `failed` | Upload window expired before upload. `POST /<kind>/:id/upload-url` for a fresh window, PUT, finalize |
