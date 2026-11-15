#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
docker compose --profile public down
echo "CropLens Docker services and the Cloudflare Tunnel are stopped. The Worker URL remains deployed, but the app is offline until the stack is started again."
