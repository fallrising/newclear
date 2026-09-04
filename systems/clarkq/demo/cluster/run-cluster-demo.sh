#!/usr/bin/env sh
# Build (if needed) + start multi-node clarkQ + run cluster scenarios.
#
# Default: 3 host processes (true multi-process stress).
# Optional: --docker for Compose 3-node stack.
#
# Usage:
#   cd demo/cluster && ./run-cluster-demo.sh
#   ./run-cluster-demo.sh --docker
#   ./run-cluster-demo.sh --keep
#   ./run-cluster-demo.sh --down
#   CLARKQ_CLUSTER_LOAD_N=80 ./run-cluster-demo.sh
#
set -eu

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$DIR/../.." && pwd)
cd "$DIR"

KEEP=0
DOWN_ONLY=0
USE_DOCKER=0

for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --down) DOWN_ONLY=1 ;;
    --docker) USE_DOCKER=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | tr -d '#'
      exit 0
      ;;
  esac
done

export CLARKQ_API_KEY="${CLARKQ_API_KEY:-dev-key}"
export CLARKQ_CLUSTER_SECRET="${CLARKQ_CLUSTER_SECRET:-dev-cluster-secret}"
export CLARKQ_REPLICATION_FACTOR="${CLARKQ_REPLICATION_FACTOR:-2}"
export CLARKQ_REPLICATION_MODE="${CLARKQ_REPLICATION_MODE:-sync}"
BASE_PORT="${CLARKQ_CLUSTER_BASE_PORT:-38481}"
PROJECT="${CLARKQ_CLUSTER_PROJECT:-clarkqcluster}"
export CLARKQ_CLUSTER_PROJECT="$PROJECT"

compose() {
  docker compose -f "$DIR/docker-compose.yml" -p "$PROJECT" "$@"
}

if [ "$DOWN_ONLY" = 1 ]; then
  if [ -f /tmp/clarkq-cluster-demo/pids ] || [ "${CLARKQ_CLUSTER_MODE:-}" = "local" ]; then
    sh "$DIR/stop-local.sh" || true
  fi
  if command -v docker >/dev/null 2>&1; then
    compose down -v 2>/dev/null || true
  fi
  echo "cluster demo torn down."
  exit 0
fi

cleanup_local() {
  if [ "$KEEP" = 1 ]; then
    echo
    echo "Cluster left running (--keep)."
    echo "  Nodes:  http://127.0.0.1:${BASE_PORT} .. +2"
    echo "  Stop:   cd demo/cluster && ./run-cluster-demo.sh --down"
    return 0
  fi
  sh "$DIR/stop-local.sh" || true
}

cleanup_docker() {
  if [ "$KEEP" = 1 ]; then
    echo
    echo "Docker cluster left running (--keep)."
    echo "  Ports:  ${BASE_PORT}-$((BASE_PORT + 2))"
    echo "  Stop:   cd demo/cluster && ./run-cluster-demo.sh --docker --down"
    return 0
  fi
  compose down -v || true
}

if [ "$USE_DOCKER" = 1 ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required for --docker" >&2
    exit 1
  fi
  export CLARKQ_CLUSTER_MODE=docker
  export CLARKQ_CLUSTER_COMPOSE="$DIR/docker-compose.yml"
  export CLARKQ_CLUSTER_HOST_PORT1=$BASE_PORT
  export CLARKQ_CLUSTER_HOST_PORT2=$((BASE_PORT + 1))
  export CLARKQ_CLUSTER_HOST_PORT3=$((BASE_PORT + 2))

  echo "→ Building and starting 3-node Docker cluster ..."
  compose up -d --build

  export CLARKQ_URL="http://127.0.0.1:${BASE_PORT}"
  export CLARKQ_NODES="http://127.0.0.1:${BASE_PORT} http://127.0.0.1:$((BASE_PORT + 1)) http://127.0.0.1:$((BASE_PORT + 2))"

  # wait via scenarios helper
  set +e
  # shellcheck source=lib.sh
  . "$DIR/lib.sh"
  wait_cluster_healthy 3 120
  WH=$?
  set -e
  if [ "$WH" -ne 0 ]; then
    compose logs --no-color | tail -80 >&2
    cleanup_docker
    exit 1
  fi

  set +e
  sh "$DIR/run-scenarios.sh"
  RC=$?
  set -e
  cleanup_docker
  exit "$RC"
fi

# ---- local multi-process (default) ----
export CLARKQ_CLUSTER_MODE=local
export CLARKQ_CLUSTER_DATA="${CLARKQ_CLUSTER_DATA:-/tmp/clarkq-cluster-demo}"
export CLARKQ_BIN="${CLARKQ_BIN:-$ROOT/bin/clarkq}"
export PATH="${PATH}"

if [ ! -x "$CLARKQ_BIN" ]; then
  echo "→ Building clarkQ binary ..."
  if command -v go >/dev/null 2>&1; then
    (cd "$ROOT" && go build -o bin/clarkq ./cmd/clarkq)
  else
    echo "go not found and binary missing: $CLARKQ_BIN" >&2
    exit 1
  fi
fi

# Ensure PATH has go if needed for nothing else
export CLARKQ_CLUSTER_BASE_PORT="$BASE_PORT"

echo "→ Starting local 3-process cluster ..."
sh "$DIR/start-local.sh"

# shellcheck disable=SC1091
. "${CLARKQ_CLUSTER_DATA}/env.sh"

set +e
sh "$DIR/run-scenarios.sh"
RC=$?
set -e

cleanup_local
exit "$RC"
