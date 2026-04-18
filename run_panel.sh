#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec uv run python -m uvicorn app.main:app --host "${PANEL_BIND_HOST:-0.0.0.0}" --port "${PANEL_BIND_PORT:-8765}" --reload
