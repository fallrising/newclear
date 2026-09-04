#!/usr/bin/env sh
# Advanced cluster stress: linearizable + lease soak, partition, multi-AZ latency.
#
# Always enables:
#   CLARKQ_LINEARIZABLE_CONSUME=true
#   CLARKQ_LEASE_ENABLED=true
#
# Usage:
#   cd demo/cluster
#   ./run-stress.sh                 # local 3-process
#   ./run-stress.sh --docker        # Compose 3-node (recommended for partition/netem)
#   ./run-stress.sh --docker --keep
#   ./run-stress.sh --docker --long # ~5 min soak (CLARKQ_STRESS_SECS=300)
#   CLARKQ_STRESS_SECS=45 ./run-stress.sh --docker
#   ./run-stress.sh --down
#
set -eu

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$DIR/../.." && pwd)
cd "$DIR"

KEEP=0
DOWN_ONLY=0
USE_DOCKER=0
LONG=0

for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --down) DOWN_ONLY=1 ;;
    --docker) USE_DOCKER=1 ;;
    --long) LONG=1 ;;
    -h|--help)
      sed -n '2,22p' "$0" | tr -d '#'
      exit 0
      ;;
  esac
done

if [ "$LONG" = 1 ]; then
  # Overnight-friendly defaults when caller did not override.
  export CLARKQ_STRESS_SECS="${CLARKQ_STRESS_SECS:-300}"
  export CLARKQ_PARTITION_SECS="${CLARKQ_PARTITION_SECS:-15}"
  export CLARKQ_STRESS_PRODS="${CLARKQ_STRESS_PRODS:-6}"
  export CLARKQ_STRESS_CONS="${CLARKQ_STRESS_CONS:-3}"
fi

# Advanced flags always on for stress
export CLARKQ_LINEARIZABLE_CONSUME=true
export CLARKQ_LEASE_ENABLED=true
export CLARKQ_API_KEY="${CLARKQ_API_KEY:-dev-key}"
export CLARKQ_CLUSTER_SECRET="${CLARKQ_CLUSTER_SECRET:-dev-cluster-secret}"
export CLARKQ_REPLICATION_FACTOR="${CLARKQ_REPLICATION_FACTOR:-2}"
export CLARKQ_REPLICATION_MODE="${CLARKQ_REPLICATION_MODE:-sync}"
export CLARKQ_CLUSTER_PROBE_INTERVAL="${CLARKQ_CLUSTER_PROBE_INTERVAL:-1s}"
export CLARKQ_CLUSTER_FAIL_THRESHOLD="${CLARKQ_CLUSTER_FAIL_THRESHOLD:-2}"
# Slightly shorter lease for faster recovery under partition
export CLARKQ_LEASE_TTL="${CLARKQ_LEASE_TTL:-3s}"
export CLARKQ_OWNER_GRACE="${CLARKQ_OWNER_GRACE:-500ms}"

BASE_PORT="${CLARKQ_CLUSTER_BASE_PORT:-38481}"
PROJECT="${CLARKQ_CLUSTER_PROJECT:-clarkqcluster}"
export CLARKQ_CLUSTER_PROJECT="$PROJECT"
export CLARKQ_CLUSTER_BASE_PORT="$BASE_PORT"
export CLARKQ_RUN_STRESS=1

compose() {
  docker compose -f "$DIR/docker-compose.yml" -p "$PROJECT" "$@"
}

if [ "$DOWN_ONLY" = 1 ]; then
  sh "$DIR/run-cluster-demo.sh" --down 2>/dev/null || true
  if [ "$USE_DOCKER" = 1 ] || command -v docker >/dev/null 2>&1; then
    compose down -v 2>/dev/null || true
  fi
  sh "$DIR/stop-local.sh" 2>/dev/null || true
  echo "stress stack torn down."
  exit 0
fi

cleanup_local() {
  if [ "$KEEP" = 1 ]; then
    echo
    echo "Stress cluster left running (--keep)."
    echo "  Stop: ./run-stress.sh --down"
    return 0
  fi
  sh "$DIR/stop-local.sh" || true
}

cleanup_docker() {
  if [ "$KEEP" = 1 ]; then
    echo
    echo "Docker stress cluster left running (--keep)."
    echo "  Stop: ./run-stress.sh --docker --down"
    return 0
  fi
  compose down -v || true
}

run_stress_scenarios() {
  # shellcheck source=lib.sh
  . "$DIR/lib.sh"
  echo
  cyan "clarkQ advanced stress suite"
  dim  "linearizable=true lease=true TTL=${CLARKQ_LEASE_TTL} grace=${CLARKQ_OWNER_GRACE}"
  dim  "soak=${CLARKQ_STRESS_SECS:-20}s mode=${CLARKQ_CLUSTER_MODE}"
  echo

  wait_cluster_healthy 3 90 || return 1

  # shellcheck disable=SC1090
  for s in \
    "$DIR/scenarios/08_soak_stress.sh" \
    "$DIR/scenarios/09_partition_jitter.sh" \
    "$DIR/scenarios/10_latency_az.sh"
  do
    . "$s"
  done
  summary
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

  echo "→ Building and starting 3-node Docker stress cluster (linearizable+lease) ..."
  compose up -d --build

  export CLARKQ_URL="http://127.0.0.1:${BASE_PORT}"
  export CLARKQ_NODES="http://127.0.0.1:${BASE_PORT} http://127.0.0.1:$((BASE_PORT + 1)) http://127.0.0.1:$((BASE_PORT + 2))"

  set +e
  run_stress_scenarios
  RC=$?
  set -e
  cleanup_docker
  exit "$RC"
fi

# local multi-process
export CLARKQ_CLUSTER_MODE=local
export CLARKQ_CLUSTER_DATA="${CLARKQ_CLUSTER_DATA:-/tmp/clarkq-cluster-stress}"
export CLARKQ_BIN="${CLARKQ_BIN:-$ROOT/bin/clarkq}"

if [ ! -x "$CLARKQ_BIN" ]; then
  echo "→ Building clarkQ binary ..."
  if command -v go >/dev/null 2>&1; then
    (cd "$ROOT" && go build -o bin/clarkq ./cmd/clarkq)
  else
    echo "go not found and binary missing: $CLARKQ_BIN" >&2
    exit 1
  fi
fi

echo "→ Starting local 3-process stress cluster ..."
# start-local honors LINEARIZABLE / LEASE env; also pass TTL/grace if supported
export CLARKQ_CLUSTER_DATA
sh "$DIR/start-local.sh"

# shellcheck disable=SC1091
. "${CLARKQ_CLUSTER_DATA}/env.sh"

set +e
run_stress_scenarios
RC=$?
set -e
cleanup_local
exit "$RC"
