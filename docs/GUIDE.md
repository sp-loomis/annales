# User Guide

Running the backend, talking to it, and looking inside it while it runs.

## Prerequisites

- Node 20+ (`node --version`)
- Podman with the docker shim (this machine's `docker` *is* podman) — or real
  Docker; everything below works the same
- `jq` (for `scripts/demo.sh` and pleasant curl output)

## First-time setup

```sh
podman machine start                              # once per boot
npm run compose:up                                # postgres :5433, LocalStack :4566
npm install --cache /tmp/npm-cache-sheaf          # see Troubleshooting for why --cache
npx prisma migrate deploy                         # apply schema to the dev DB
npx prisma generate
docker exec sheaf_localstack_1 awslocal s3 mb s3://sheaf-dev
docker exec sheaf_localstack_1 awslocal s3api put-bucket-versioning \
  --bucket sheaf-dev --versioning-configuration Status=Enabled
cp .env.example .env
```

Versioning on the dev bucket is optional but recommended — it's what gives
you file-level edit history for free.

## Everyday commands

```sh
npm run dev          # API on http://localhost:3000, restarts on save
npm test             # 105 contract tests (containers must be up)
npm run typecheck
npm run compose:down # stop containers (data volumes persist)
```

Readiness after `compose:up` (podman-compose has no `--wait`):

```sh
docker exec sheaf_postgres_1 pg_isready -U sheaf
curl -s localhost:4566/_localstack/health | jq .services.s3
```

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

# 1. A world and a CRS to draw in
WORLD=$(curl -s -X POST $BASE/worlds -H 'content-type: application/json' \
  -d '{"name":"Aldervane"}' | jq -r .id)
CRS=$(curl -s -X POST $BASE/worlds/$WORLD/crs -H 'content-type: application/json' \
  -d '{"name":"main","params":{"projection":"equirectangular"}}' | jq -r .id)

# 2. An entry
ENTRY=$(curl -s -X POST $BASE/worlds/$WORLD/entries -H 'content-type: application/json' \
  -d '{"type":"region","title":"The Shattered Coast","tags":["coastal"]}' | jq -r .id)

# 3. Attach a document — THREE steps because payload travels by presigned URL
#    (a) create: metadata + a presigned PUT slot
DOC=$(curl -s -X POST $BASE/entries/$ENTRY/documents -H 'content-type: application/json' \
  -d '{"role":"body"}')
DOC_ID=$(echo "$DOC" | jq -r .id)
UPLOAD_URL=$(echo "$DOC" | jq -r .upload.url)

#    (b) upload: PUT the payload straight to (LocalStack) S3 — not the API
curl -s -X PUT "$UPLOAD_URL" -H 'content-type: text/markdown' \
  --data-binary '# The Shattered Coast

Salt and ruin, west of the old kingdom.'

#    (c) finalize: server validates, derives cached fields, flips to ready
curl -s -X POST $BASE/documents/$DOC_ID/finalize | jq '{id, status}'

# 4. Read it back — download is a presigned GET
curl -s $BASE/documents/$DOC_ID | jq .download.url
curl -s "$(curl -s $BASE/documents/$DOC_ID | jq -r .download.url)"

# 5. Search (document text is indexed at finalize)
curl -s "$BASE/worlds/$WORLD/search?q=shattered" | jq .

# 6. Entry detail aggregates everything
curl -s $BASE/entries/$ENTRY | jq .
```

Geometries are the same lifecycle with `{"crsId":"$CRS"}` in the create body
and a GeoJSON Feature/FeatureCollection as the payload; images add
`{"contentType":"image/png"}` and get a `thumbnail` presigned URL after
finalize; sketches take Excalidraw scene JSON.

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
docker exec sheaf_localstack_1 awslocal s3 ls s3://sheaf-dev --recursive --human-readable

# Read an object
docker exec sheaf_localstack_1 awslocal s3 cp \
  "s3://sheaf-dev/worlds/<…>/documents/<…>.md" -

# Edit history (needs bucket versioning enabled — re-upload + finalize an
# artifact and you'll see multiple versions of the same key)
docker exec sheaf_localstack_1 awslocal s3api list-object-versions \
  --bucket sheaf-dev --prefix "worlds/" \
  | jq '.Versions[] | {Key, VersionId, LastModified, IsLatest}'

# Fetch a specific old version
docker exec sheaf_localstack_1 awslocal s3api get-object \
  --bucket sheaf-dev --key "<key>" --version-id "<versionId>" /tmp/old.md
```

If you have the AWS CLI installed locally, the same works from the host:
`aws --endpoint-url http://localhost:4566 s3 ls s3://sheaf-dev --recursive`
(credentials `test`/`test`, region `us-east-1`).

Handy correlation: presigned URLs in API responses contain the object key in
the path — you can eyeball which DB row maps to which object.

## Investigating the database

```sh
docker exec -it sheaf_postgres_1 psql -U sheaf -d sheaf
```

Useful looks:

```sql
-- what's indexed for search (text is the derived extract, tsv the vector)
SELECT "entryId", "sourceType", left(text, 60) AS text FROM "SearchIndex";

-- geometry bboxes (native box type — this is what the GiST index serves)
SELECT id, label, bbox FROM "Geometry";

-- artifact lifecycle state (failed = pending + expired window, derived at read)
SELECT id, status, "uploadExpiresAt", "filePath" FROM "Document";

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
| Port 5433/4566 already bound | Another compose project; `docker ps` and stop it, or change ports in `docker-compose.yml` + `.env` |
| `/healthz` returns 503 | DB or bucket unreachable — check containers, and that `sheaf-dev` bucket exists |
| Artifact stuck `failed` | Upload window expired before upload. `POST /<kind>/:id/upload-url` for a fresh window, PUT, finalize |
