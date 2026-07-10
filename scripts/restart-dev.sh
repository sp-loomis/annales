#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-5173}"

log() {
  printf '\033[1;36m[restart-dev]\033[0m %s\n' "$1"
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    log "Killing listeners on port $port: $pids"
    kill $pids 2>/dev/null || true
    sleep 0.3
    local stubborn
    stubborn="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$stubborn" ]]; then
      log "Force killing stubborn listeners on port $port: $stubborn"
      kill -9 $stubborn 2>/dev/null || true
    fi
  fi
}

kill_pattern() {
  local pattern="$1"
  local matches
  matches="$(pgrep -f "$pattern" 2>/dev/null || true)"
  if [[ -n "$matches" ]]; then
    log "Killing processes matching: $pattern"
    pkill -f "$pattern" 2>/dev/null || true
  fi
}

cleanup_children() {
  log "Stopping child dev servers"
  if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  if [[ -n "${WEB_PID:-}" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
}

trap cleanup_children EXIT INT TERM

log "Stopping any existing backend/frontend servers"
kill_port "$API_PORT"
kill_port "$WEB_PORT"
kill_pattern "tsx watch --env-file-if-exists=.env src/server.ts"
kill_pattern "vite"
kill_pattern "npm run dev -w web"
kill_pattern "npm --prefix .*/web run dev"

cd "$ROOT_DIR"

log "Starting backend on :$API_PORT"
npm run dev > >(sed 's/^/[api] /') 2> >(sed 's/^/[api] /' >&2) &
API_PID=$!

log "Starting frontend on :$WEB_PORT"
npm --prefix "$ROOT_DIR/web" run dev > >(sed 's/^/[web] /') 2> >(sed 's/^/[web] /' >&2) &
WEB_PID=$!

log "Servers started. Press Ctrl+C to stop both."
wait "$API_PID" "$WEB_PID"
