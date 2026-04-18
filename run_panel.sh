#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Build frontend if static/index.html doesn't exist or REBUILD_FRONTEND is set
if [ ! -f static/index.html ] || [ "${REBUILD_FRONTEND:-0}" = "1" ]; then
  echo "→ Сборка фронтенда…"
  bash build_frontend.sh
fi

exec uv run python -m uvicorn app.main:app --host "${PANEL_BIND_HOST:-0.0.0.0}" --port "${PANEL_BIND_PORT:-8765}" --reload
