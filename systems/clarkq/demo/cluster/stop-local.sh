#!/usr/bin/env sh
# Stop the multi-process cluster started by start-local.sh
set -eu

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
DATA="${CLARKQ_CLUSTER_DATA:-/tmp/clarkq-cluster-demo}"

if [ ! -f "$DATA/pids" ]; then
  # Also kill by port if leftover
  BASE_PORT="${CLARKQ_CLUSTER_BASE_PORT:-38481}"
  for off in 0 1 2; do
    port=$((BASE_PORT + off))
    # fuser if available
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${port}/tcp" 2>/dev/null || true
    fi
  done
  echo "no pid file at $DATA/pids (best-effort port cleanup done)"
  exit 0
fi

while read -r pid; do
  [ -z "$pid" ] && continue
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    # grace then force
    i=0
    while [ "$i" -lt 10 ] && kill -0 "$pid" 2>/dev/null; do
      i=$((i + 1))
      sleep 0.2
    done
    kill -9 "$pid" 2>/dev/null || true
    echo "  stopped pid $pid"
  fi
done <"$DATA/pids"

rm -f "$DATA/pids"
echo "cluster stopped (data kept under $DATA — remove manually if desired)"
