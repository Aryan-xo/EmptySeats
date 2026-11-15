#!/usr/bin/env bash
# Build the UI, then run the backend which serves it on http://localhost:${PORT:-8080}
set -euo pipefail
cd "$(dirname "$0")"
(cd frontend && [ -d node_modules ] || npm install) 
(cd frontend && npm run build)
cd backend && exec cargo run --release
