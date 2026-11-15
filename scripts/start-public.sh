#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_URL="https://croplens-api.abhaysaiamakam.workers.dev"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is not running. Start Docker Desktop, then run this command again." >&2
  exit 1
fi

if ! npx --yes wrangler whoami >/dev/null 2>&1; then
  echo "Wrangler is not authenticated. Run: npx --yes wrangler login" >&2
  exit 1
fi

docker compose --profile public up -d --build api web gateway
docker compose --profile public up -d --force-recreate tunnel

TUNNEL_URL=""
for _ in $(seq 1 30); do
  TUNNEL_URL="$(docker compose logs --no-color --tail=80 tunnel \
    | sed -nE 's#.*(https://[[:alnum:]-]+\.trycloudflare\.com).*#\1#p' \
    | tail -n 1 \
    | tr -d '\r')"
  if [[ -n "$TUNNEL_URL" ]]; then
    break
  fi
  sleep 2
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "Could not find the Quick Tunnel URL. Check: docker compose logs -f tunnel" >&2
  exit 1
fi

echo "Updating the stable CropLens Worker to use $TUNNEL_URL"
(cd apps/api-proxy && npx --yes wrangler deploy --var "ORIGIN:${TUNNEL_URL}")

if ! curl -fsS --retry 10 --retry-delay 2 "$WORKER_URL/api/v1/health" >/dev/null; then
  echo "Worker deployed, but the API health check failed. Check Docker logs with: docker compose logs -f" >&2
  exit 1
fi
if ! curl -fsS --retry 10 --retry-delay 2 "$WORKER_URL/phase1" >/dev/null; then
  echo "Worker deployed, but the Phase 1 page check failed. Check Docker logs with: docker compose logs -f" >&2
  exit 1
fi

echo "CropLens is live at $WORKER_URL"
echo "Phase 1: $WORKER_URL/phase1"
echo "API health: $WORKER_URL/api/v1/health"
