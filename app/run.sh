#!/usr/bin/env bash
# Start the research desk. The API key is read from ../.env and stays server-side.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f ../.env ]; then echo "expected ../.env with TYPESAFE_API_KEY" >&2; exit 1; fi
set -a; . ../.env; set +a
exec uv run uvicorn server:app --port "${PORT:-8765}" --reload
