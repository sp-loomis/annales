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

step "POST /worlds/:id/globes — a sphere (groups CRSs; radius 180/π makes projected units = degrees)"
GLOBE_JSON=$(curl -s -X POST "$BASE/worlds/$WORLD/globes" -H 'content-type: application/json' \
  -d '{"name":"terra","params":{"radius":57.29578}}')
show "$GLOBE_JSON"
GLOBE=$(jq -r .id <<<"$GLOBE_JSON")

step "POST /globes/:id/crs — a coordinate system (a projection of the globe; geometries require one)"
CRS_JSON=$(curl -s -X POST "$BASE/globes/$GLOBE/crs" -H 'content-type: application/json' \
  -d '{"name":"main","params":{"type":"equirectangular"}}')
show "$CRS_JSON"
CRS=$(jq -r .id <<<"$CRS_JSON")

step "POST /worlds/:id/timelines — a tick axis (groups calendars)"
TL_JSON=$(curl -s -X POST "$BASE/worlds/$WORLD/timelines" -H 'content-type: application/json' \
  -d '{"name":"the ages"}')
show "$TL_JSON"
TL=$(jq -r .id <<<"$TL_JSON")

step "POST /timelines/:id/calendars — a 2×30-day schema calendar"
CAL_JSON=$(curl -s -X POST "$BASE/timelines/$TL/calendars" -H 'content-type: application/json' \
  -d '{"name":"common reckoning","definition":{"version":1,"params":[{"name":"year","type":"number","range":{"from":null,"to":null}},{"name":"month","type":"named","values":["Frostwane","Sunreach"]},{"name":"day","type":"number","range":{"from":1,"to":30},"unitTicks":1}],"epoch":{"year":1,"month":"Frostwane","day":1}}}')
show "$CAL_JSON"
CAL=$(jq -r .id <<<"$CAL_JSON")

step "POST /timelines/:id/calendars — a full Gregorian calendar (DSL leap rule + derived weekday + BC/AD formatting)"
# Months carry names; the terminal 'day' length is a DSL rule (30/31, 29 in leap years),
# 'weekday' is derived straight off the tick, and 'day' formatting flips AD/BC on the year sign.
GREG_DEF=$(cat <<'JSON'
{
  "name": "Gregorian",
  "definition": {
    "version": 1,
    "params": [
      { "name": "year", "type": "number", "range": { "from": -9999, "to": 9999 }, "step": 1 },
      { "name": "month", "type": "named",
        "values": ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"] },
      { "name": "day", "type": "number", "unitTicks": 1,
        "range": {
          "from": 1,
          "to": { "dsl": "leap := year % 4 = 0\nreturn case month when February then (if leap then 29 else 28) when April, June, September, November then 30 else 31" }
        } }
    ],
    "epoch": { "year": 1, "month": "January", "day": 1 },
    "derivedFields": [
      { "name": "weekday", "type": "named",
        "values": ["Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday"],
        "expr": { "dsl": "return tick % 7" } }
    ],
    "format": {
      "pretty": { "day": { "dsl": "bcyear := 1 - year\nreturn if year >= 1 then \"{month} {day}, {year} AD\" else \"{month} {day}, {bcyear} BC\"" } },
      "short":  { "day": { "dsl": "return \"{year}/{ordinal(month):02d}/{day:02d}\"" } }
    }
  }
}
JSON
)
GREG_JSON=$(curl -s -X POST "$BASE/timelines/$TL/calendars" -H 'content-type: application/json' -d "$GREG_DEF")
jq '{id, name}' <<<"$GREG_JSON"
GREG=$(jq -r .id <<<"$GREG_JSON")

step "POST /calendars/:id/convert — tick 31 → date (leap-aware month width + derived weekday)"
# Tick 31 = day 32 from epoch → February 1 of year 1 (January has 31 days).
curl -s -X POST "$BASE/calendars/$GREG/convert" -H 'content-type: application/json' \
  -d '{"tick":31}' | jq .

step "POST /calendars/:id/convert — the Ides of March, 44 BC → ticks (BC/AD + ordinal formatting)"
# year -43 renders as '44 BC'; short form pads the month ordinal to 2 digits.
curl -s -X POST "$BASE/calendars/$GREG/convert" -H 'content-type: application/json' \
  -d '{"date":{"year":-43,"month":"March","day":15}}' | jq .

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

step "Same lifecycle for a geometry (territory polygon, canonical bboxes derived at finalize)"
GEO_JSON=$(curl -s -X POST "$BASE/entries/$COAST/geometries" -H 'content-type: application/json' \
  -d "{\"crsId\":\"$CRS\",\"label\":\"territory\"}")
GEO=$(jq -r .id <<<"$GEO_JSON")
curl -sf -X PUT "$(jq -r .upload.url <<<"$GEO_JSON")" -H 'content-type: application/geo+json' \
  --data-binary '{"type":"Feature","properties":{"climate":"temperate"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}}'
# authored [0..10]×[0..10] → canonical lng [0,10], lat [-10,0] (d3 y-axis is down)
curl -s -X POST "$BASE/geometries/$GEO/finalize" | jq '{id, status, bboxes, properties}'

step "POST /entries/:id/date-ranges — server converts calendar date → ticks"
curl -s -X POST "$BASE/entries/$COAST/date-ranges" -H 'content-type: application/json' \
  -d "{\"calendarId\":\"$CAL\",\"rawComponents\":{\"year\":2,\"month\":\"Frostwane\",\"day\":1},\"precisionTier\":\"exact\"}" \
  | jq '{rawComponents, tickStart, tickEnd}'

step "POST /relations — Shattered Coast located-in Old Kingdom"
curl -s -X POST "$BASE/relations" -H 'content-type: application/json' \
  -d "{\"fromId\":\"$COAST\",\"toId\":\"$KINGDOM\",\"typeId\":\"$RT\"}" | jq .

step "GET /entries/:id — detail aggregates every artifact"
curl -s "$BASE/entries/$COAST" | jq .

step "GET search?q=shattered — full text with rank + highlighted snippet"
curl -s "$BASE/worlds/$WORLD/search?q=shattered" | jq .

step "GET search?bbox=5,-9,15,-1&globeId=… — canonical geo overlap over the globe (GiST stage 1)"
curl -s "$BASE/worlds/$WORLD/search?bbox=5,-9,15,-1&globeId=$GLOBE" | jq '.items[].title'

step "GET search?tickStart=50&tickEnd=70&timelineId=… — date overlap within the timeline"
curl -s "$BASE/worlds/$WORLD/search?tickStart=50&tickEnd=70&timelineId=$TL" | jq '.items[].title'

step "GET /entries/:id/graph — traversal from the Old Kingdom, inbound"
curl -s "$BASE/entries/$KINGDOM/graph?depth=2&direction=in" | jq .

step "Errors always wear the envelope — finalize with nothing uploaded"
SKETCH=$(curl -s -X POST "$BASE/entries/$COAST/sketches" -H 'content-type: application/json' -d '{}' | jq -r .id)
curl -s -X POST "$BASE/sketches/$SKETCH/finalize" | jq .

step "Done"
cat <<EOF
World id: $WORLD

Peek at the stored objects (keys mirror worlds/<world>/entries/<entry>/<kind>/):
  podman exec sheaf_localstack_1 awslocal s3 ls s3://sheaf-dev --recursive
And the derived search index:
  podman exec sheaf_postgres_1 psql -U sheaf -d sheaf \\
    -c 'SELECT "sourceType", left(text, 50) FROM "SearchIndex";'
EOF
