#!/usr/bin/env bash
# Guided tour of the sheaf API. Seeds a fresh demo world end-to-end,
# exercising the full artifact lifecycle (presigned upload → finalize),
# relations, date ranges, search, and graph traversal.
#
# Usage:  ./scripts/demo.sh            (server on :3000)
#         BASE=http://localhost:3123 ./scripts/demo.sh
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"

step() { printf '\n\033[1;36m== %s\033[0m\n' "$1"; }
show() { jq . <<<"$1"; }

command -v jq >/dev/null || { echo "demo.sh needs jq"; exit 1; }
curl -sf "$BASE/healthz" >/dev/null || {
  echo "no healthy server at $BASE — run 'npm run dev' first (see docs/GUIDE.md)"; exit 1; }

step "POST /worlds — create a world"
WORLD_JSON=$(curl -s -X POST "$BASE/worlds" -H 'content-type: application/json' \
  -d '{"name":"Demo — Aldervane"}')
show "$WORLD_JSON"
WORLD=$(jq -r .id <<<"$WORLD_JSON")

step "POST /worlds/:id/crs — a coordinate system (geometries require one)"
CRS_JSON=$(curl -s -X POST "$BASE/worlds/$WORLD/crs" -H 'content-type: application/json' \
  -d '{"name":"main","params":{"projection":"equirectangular"}}')
show "$CRS_JSON"
CRS=$(jq -r .id <<<"$CRS_JSON")

step "POST /worlds/:id/calendars — a 2×30-day arithmetic calendar"
CAL_JSON=$(curl -s -X POST "$BASE/worlds/$WORLD/calendars" -H 'content-type: application/json' \
  -d '{"name":"common reckoning","type":"arithmetic","definition":{"months":[{"name":"Frostwane","days":30},{"name":"Sunreach","days":30}]}}')
show "$CAL_JSON"
CAL=$(jq -r .id <<<"$CAL_JSON")

step "POST /worlds/:id/relation-types — edge vocabulary"
RT_JSON=$(curl -s -X POST "$BASE/worlds/$WORLD/relation-types" -H 'content-type: application/json' \
  -d '{"name":"located-in","inverseName":"contains"}')
show "$RT_JSON"
RT=$(jq -r .id <<<"$RT_JSON")

step "POST /worlds/:id/entries — two entries"
COAST_JSON=$(curl -s -X POST "$BASE/worlds/$WORLD/entries" -H 'content-type: application/json' \
  -d '{"type":"region","title":"The Shattered Coast","tags":["coastal","ruined"]}')
show "$COAST_JSON"
COAST=$(jq -r .id <<<"$COAST_JSON")
KINGDOM=$(curl -s -X POST "$BASE/worlds/$WORLD/entries" -H 'content-type: application/json' \
  -d '{"type":"polity","title":"The Old Kingdom"}' | jq -r .id)
echo "second entry: The Old Kingdom ($KINGDOM)"

step "Artifact lifecycle 1/3 — create document (returns presigned PUT slot)"
DOC_JSON=$(curl -s -X POST "$BASE/entries/$COAST/documents" -H 'content-type: application/json' \
  -d '{"role":"body"}')
jq '{id, status, upload: {method: .upload.method, expiresAt: .upload.expiresAt}}' <<<"$DOC_JSON"
DOC=$(jq -r .id <<<"$DOC_JSON")
DOC_URL=$(jq -r .upload.url <<<"$DOC_JSON")

step "Artifact lifecycle 2/3 — PUT payload straight to S3 (bypasses the API)"
curl -sf -X PUT "$DOC_URL" -H 'content-type: text/markdown' --data-binary \
'# The Shattered Coast

Salt and ruin. The shattered coast lies west of the old kingdom.'
echo "uploaded."

step "Artifact lifecycle 3/3 — finalize (validate, derive, index)"
curl -s -X POST "$BASE/documents/$DOC/finalize" | jq '{id, status}'

step "Same lifecycle for a geometry (territory polygon, bbox derived at finalize)"
GEO_JSON=$(curl -s -X POST "$BASE/entries/$COAST/geometries" -H 'content-type: application/json' \
  -d "{\"crsId\":\"$CRS\",\"label\":\"territory\"}")
GEO=$(jq -r .id <<<"$GEO_JSON")
curl -sf -X PUT "$(jq -r .upload.url <<<"$GEO_JSON")" -H 'content-type: application/geo+json' \
  --data-binary '{"type":"Feature","properties":{"climate":"temperate"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}}'
curl -s -X POST "$BASE/geometries/$GEO/finalize" | jq '{id, status, bbox, properties}'

step "POST /entries/:id/date-ranges — server converts calendar date → ticks"
curl -s -X POST "$BASE/entries/$COAST/date-ranges" -H 'content-type: application/json' \
  -d "{\"calendarId\":\"$CAL\",\"rawComponents\":{\"year\":2,\"month\":1,\"day\":1},\"precisionTier\":\"exact\"}" \
  | jq '{rawComponents, tickStart, tickEnd}'

step "POST /relations — Shattered Coast located-in Old Kingdom"
curl -s -X POST "$BASE/relations" -H 'content-type: application/json' \
  -d "{\"fromId\":\"$COAST\",\"toId\":\"$KINGDOM\",\"typeId\":\"$RT\"}" | jq .

step "GET /entries/:id — detail aggregates every artifact"
curl -s "$BASE/entries/$COAST" | jq .

step "GET search?q=shattered — full text with rank + highlighted snippet"
curl -s "$BASE/worlds/$WORLD/search?q=shattered" | jq .

step "GET search?bbox=5,5,15,15&crsId=… — geo overlap (GiST stage 1)"
curl -s "$BASE/worlds/$WORLD/search?bbox=5,5,15,15&crsId=$CRS" | jq '.items[].title'

step "GET search?tickStart=50&tickEnd=70 — date overlap"
curl -s "$BASE/worlds/$WORLD/search?tickStart=50&tickEnd=70" | jq '.items[].title'

step "GET /entries/:id/graph — traversal from the Old Kingdom, inbound"
curl -s "$BASE/entries/$KINGDOM/graph?depth=2&direction=in" | jq .

step "Errors always wear the envelope — finalize with nothing uploaded"
SKETCH=$(curl -s -X POST "$BASE/entries/$COAST/sketches" -H 'content-type: application/json' -d '{}' | jq -r .id)
curl -s -X POST "$BASE/sketches/$SKETCH/finalize" | jq .

step "Done"
cat <<EOF
World id: $WORLD

Peek at the stored objects (keys mirror worlds/<world>/entries/<entry>/<kind>/):
  docker exec sheaf_localstack_1 awslocal s3 ls s3://sheaf-dev --recursive
And the derived search index:
  docker exec sheaf_postgres_1 psql -U sheaf -d sheaf \\
    -c 'SELECT "sourceType", left(text, 50) FROM "SearchIndex";'
EOF
