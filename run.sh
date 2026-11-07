#!/usr/bin/env bash
# Starts odderjam at http://localhost:8000 (set ODDS_API_KEY for live odds; mock data otherwise)
cd "$(dirname "$0")"
[ -f .env ] && { set -a; . ./.env; set +a; }
[ -d frontend/dist ] || (cd frontend && npm install && npm run build)
exec .venv/bin/uvicorn backend.main:app --port 8000
