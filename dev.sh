#!/usr/bin/env bash
# Start the whole BYOS stack for local dev: FastAPI (:8000) + Next.js web (:3000).
# Run via `pnpm dev` from the repo root (or `bash dev.sh`). Ctrl-C stops both.
# Kept compatible with macOS's stock bash 3.2 (no `wait -n`).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "▲ BYOS dev — API on :8000, web on :3000  (Ctrl-C to stop)"

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] || continue
    pkill -P "$pid" 2>/dev/null || true  # reloader worker / next child
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup INT TERM EXIT

# `exec` so each backgrounded process IS uvicorn/pnpm (clean kills).
(cd "$ROOT/apps/api" && exec uv run uvicorn byos_api.main:app --reload --reload-dir src) &
pids+=("$!")

(cd "$ROOT/apps/web" && exec pnpm dev) &
pids+=("$!")

wait
