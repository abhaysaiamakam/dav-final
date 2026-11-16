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

wait_for_endpoint() {
  local url="$1"
  local label="$2"
  local host="${url#https://}"
  host="${host%%/*}"
  local ip
  for _ in $(seq 1 30); do
    if [[ "$host" == *.trycloudflare.com ]]; then
      while IFS= read -r ip; do
        [[ -n "$ip" ]] || continue
        if curl -fsS --connect-timeout 5 --max-time 10 --resolve "$host:443:$ip" "$url" >/dev/null 2>&1; then
          return 0
        fi
      done < <(dig +short "$host" A 2>/dev/null | awk '/^[0-9.]+$/')
    else
      if curl -fsS --connect-timeout 5 --max-time 10 "$url" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 2
  done
  echo "$label is not reachable yet: $url" >&2
  return 1
}

echo "Waiting for the new Quick Tunnel to become reachable"
if ! wait_for_endpoint "$TUNNEL_URL/api/v1/health" "Quick Tunnel API"; then
  echo "Check the tunnel and Docker services with: docker compose --profile public logs -f" >&2
  exit 1
fi

echo "Updating the stable CropLens Worker to use $TUNNEL_URL"
(cd apps/api-proxy && npx --yes wrangler deploy --var "ORIGIN:${TUNNEL_URL}")

if ! wait_for_endpoint "$WORKER_URL/api/v1/health" "Worker API health endpoint"; then
  echo "Worker deployed, but the API health check failed. Check Docker logs with: docker compose logs -f" >&2
  exit 1
fi
if ! wait_for_endpoint "$WORKER_URL/phase1" "Worker Phase 1 page"; then
  echo "Worker deployed, but the Phase 1 page check failed. Check Docker logs with: docker compose logs -f" >&2
  exit 1
fi

echo "CropLens is live at $WORKER_URL"
echo "Phase 1: $WORKER_URL/phase1"
echo "API health: $WORKER_URL/api/v1/health"
