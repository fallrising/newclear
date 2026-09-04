#!/usr/bin/env bash
# Minimal Docker-flow CI/CD skeleton for business apps on this VPS.
# Intended usage from CI:
#   IMAGE=ghcr.io/you/app-a:sha ./ci/deploy-app.sh
set -euo pipefail

IMAGE="${IMAGE:?IMAGE required, e.g. ghcr.io/org/app:tag}"
SERVICE_NAME="${SERVICE_NAME:-app}"
NETWORK="${NETWORK:-platform_edge}"
HOST_PORT="${HOST_PORT:-}"

echo "Pulling $IMAGE"
docker pull "$IMAGE"

if docker network inspect "$NETWORK" >/dev/null 2>&1; then
  :
else
  echo "Network $NETWORK missing. Start platform stack first." >&2
  exit 1
fi

EXISTING="$(docker ps -aq -f name=^/${SERVICE_NAME}$ || true)"
if [[ -n "$EXISTING" ]]; then
  docker rm -f "$SERVICE_NAME"
fi

PORT_ARGS=()
if [[ -n "$HOST_PORT" ]]; then
  PORT_ARGS=(-p "${HOST_PORT}:8080")
fi

docker run -d --name "$SERVICE_NAME" --network "$NETWORK" --restart unless-stopped \
  "${PORT_ARGS[@]}" \
  "$IMAGE"

echo "Deployed $SERVICE_NAME from $IMAGE on network $NETWORK"
echo "Next: add Nginx location + Prometheus scrape for this service."
