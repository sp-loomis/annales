#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-5174}"
LOCAL_DB_URL="${LOCAL_DATABASE_URL:-postgresql://sheaf:sheaf@localhost:5433/sheaf_local}"
LOCAL_BUCKET="${LOCAL_S3_BUCKET:-sheaf-local}"

log() {
  printf '\033[1;32m[local]\033[0m %s\n' "$1"
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    log "Killing listeners on port $port: $pids"
    kill $pids 2>/dev/null || true
  fi
}

cleanup_children() {
  if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  if [[ -n "${WEB_PID:-}" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
}

trap cleanup_children EXIT INT TERM

cd "$ROOT_DIR"

log "Preparing local database and bucket"
kill_port "$API_PORT"
kill_port "$WEB_PORT"

if ! podman exec sheaf_postgres_1 psql -U sheaf -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='sheaf_local'" | grep -q 1; then
  log "Creating database sheaf_local"
  podman exec sheaf_postgres_1 psql -U sheaf -d postgres -c "CREATE DATABASE sheaf_local;"
fi

podman exec sheaf_localstack_1 awslocal s3api head-bucket --bucket "$LOCAL_BUCKET" 2>/dev/null \
  || podman exec sheaf_localstack_1 awslocal s3 mb "s3://$LOCAL_BUCKET"
podman exec sheaf_localstack_1 awslocal s3api put-bucket-versioning --bucket "$LOCAL_BUCKET" \
  --versioning-configuration Status=Enabled

log "Running migrations for local database"
DATABASE_URL="$LOCAL_DB_URL" npm run db:local

log "Starting local API on :$API_PORT"
PORT="$API_PORT" S3_BUCKET="$LOCAL_BUCKET" DATABASE_URL="$LOCAL_DB_URL" npm run dev > >(sed 's/^/[local-api] /') 2> >(sed 's/^/[local-api] /' >&2) &
API_PID=$!

log "Starting local web on :$WEB_PORT (proxy -> :$API_PORT)"
VITE_API_PROXY_TARGET="http://localhost:$API_PORT" npm --prefix "$ROOT_DIR/web" run dev -- --port "$WEB_PORT" > >(sed 's/^/[local-web] /') 2> >(sed 's/^/[local-web] /' >&2) &
WEB_PID=$!

log "Local app started: web http://localhost:$WEB_PORT, api http://localhost:$API_PORT"
wait "$API_PID" "$WEB_PID"
