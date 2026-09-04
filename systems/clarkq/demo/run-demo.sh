#!/usr/bin/env sh
# Build + start clarkQ with Docker Compose, run capability scenarios, print results.
#
# Usage:
#   cd demo && ./run-demo.sh
#   CLARKQ_DEMO_PORT=18080 ./run-demo.sh
#   ./run-demo.sh --down          # stop and remove demo stack
#   ./run-demo.sh --keep          # leave stack running after tests
#
set -eu

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$DIR"

PROJECT="${CLARKQ_DEMO_PROJECT:-clarkqdemo}"
PORT="${CLARKQ_DEMO_PORT:-8080}"
API_KEY="${CLARKQ_API_KEY:-dev-key}"
KEEP=0
DOWN_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --down) DOWN_ONLY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | tr -d '#'
      exit 0
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

compose() {
  docker compose -f "$DIR/docker-compose.yml" -p "$PROJECT" "$@"
}

if [ "$DOWN_ONLY" = 1 ]; then
  compose down -v
  echo "demo stack removed."
  exit 0
fi

export CLARKQ_API_KEY="$API_KEY"
export CLARKQ_DEMO_PORT="$PORT"

echo "→ Building and starting clarkQ (project=${PROJECT}, port=${PORT}) ..."
compose up -d --build clarkq

echo "→ Waiting for health ..."
i=0
while [ "$i" -lt 90 ]; do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
if ! curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "server failed to become healthy" >&2
  compose logs --no-color clarkq | tail -50 >&2
  exit 1
fi

export CLARKQ_URL="http://127.0.0.1:${PORT}"
export CLARKQ_API_KEY="$API_KEY"
export CLARKQ_DEMO_COMPOSE="$DIR/docker-compose.yml"
export CLARKQ_DEMO_PROJECT="$PROJECT"

# Prefer host curl; fall back to runner container
if command -v curl >/dev/null 2>&1; then
  echo "→ Running scenarios on host ..."
  set +e
  sh "$DIR/run-scenarios.sh"
  RC=$?
  set -e
else
  echo "→ Running scenarios in demo-runner container ..."
  set +e
  compose --profile runner run --rm demo-runner
  RC=$?
  set -e
fi

if [ "$KEEP" = 1 ]; then
  echo
  echo "Stack left running (--keep)."
  echo "  UI:      http://127.0.0.1:${PORT}/ui/"
  echo "  API key: ${API_KEY}"
  echo "  Stop:    cd demo && ./run-demo.sh --down"
else
  echo "→ Stopping demo stack ..."
  compose down -v
fi

exit "$RC"
