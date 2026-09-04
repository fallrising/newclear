#!/usr/bin/env sh
# Start a 3-process clarkQ cluster on localhost (multi-process stress base).
#
# Usage:
#   ./start-local.sh
#   CLARKQ_CLUSTER_BASE_PORT=18081 ./start-local.sh
#
# Env:
#   CLARKQ_BIN                 path to binary (default: ../../bin/clarkq)
#   CLARKQ_CLUSTER_BASE_PORT   first port (default 38481 → 38481..38483)
#   CLARKQ_API_KEY             (default dev-key)
#   CLARKQ_CLUSTER_SECRET      (default dev-cluster-secret)
#   CLARKQ_REPLICATION_FACTOR  (default 2)
#   CLARKQ_REPLICATION_MODE    sync|async (default sync)
#   CLARKQ_LINEARIZABLE_CONSUME true|false (default false)
#   CLARKQ_LEASE_ENABLED       true|false (default false)
#   CLARKQ_CLUSTER_DATA        data root (default /tmp/clarkq-cluster-demo)
#
set -eu

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$DIR/../.." && pwd)

BIN="${CLARKQ_BIN:-$ROOT/bin/clarkq}"
BASE_PORT="${CLARKQ_CLUSTER_BASE_PORT:-38481}"
API_KEY="${CLARKQ_API_KEY:-dev-key}"
SECRET="${CLARKQ_CLUSTER_SECRET:-dev-cluster-secret}"
RF="${CLARKQ_REPLICATION_FACTOR:-2}"
MODE="${CLARKQ_REPLICATION_MODE:-sync}"
DATA="${CLARKQ_CLUSTER_DATA:-/tmp/clarkq-cluster-demo}"
PROBE="${CLARKQ_CLUSTER_PROBE_INTERVAL:-1s}"
FAIL_TH="${CLARKQ_CLUSTER_FAIL_THRESHOLD:-2}"
CATCHUP="${CLARKQ_CATCHUP_INTERVAL:-2s}"
LINEARIZABLE="${CLARKQ_LINEARIZABLE_CONSUME:-false}"
LEASE="${CLARKQ_LEASE_ENABLED:-false}"
LEASE_TTL="${CLARKQ_LEASE_TTL:-}"
OWNER_GRACE="${CLARKQ_OWNER_GRACE:-}"

if [ ! -x "$BIN" ]; then
  echo "binary not found or not executable: $BIN" >&2
  echo "Build first: (cd $ROOT && make build)" >&2
  exit 1
fi

# Pick 3 consecutive free TCP ports starting at BASE_PORT (skip busy triples).
port_free() {
  # return 0 if nothing is listening on $1
  if command -v ss >/dev/null 2>&1; then
    ! ss -lnt "( sport = :$1 )" 2>/dev/null | grep -q ":$1"
    return $?
  fi
  python3 -c "import socket;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);
import sys
try:
 s.bind(('0.0.0.0',int(sys.argv[1]))); s.close()
except OSError:
 raise SystemExit(1)
" "$1" 2>/dev/null
}

find_base() {
  start=$1
  max=$((start + 200))
  p=$start
  while [ "$p" -lt "$max" ]; do
    if port_free "$p" && port_free $((p + 1)) && port_free $((p + 2)); then
      echo "$p"
      return 0
    fi
    p=$((p + 3))
  done
  return 1
}

BASE_PORT=$(find_base "$BASE_PORT") || {
  echo "could not find 3 free consecutive ports from ${CLARKQ_CLUSTER_BASE_PORT:-38481}" >&2
  exit 1
}
export CLARKQ_CLUSTER_BASE_PORT="$BASE_PORT"

P1=$BASE_PORT
P2=$((BASE_PORT + 1))
P3=$((BASE_PORT + 2))
N1="http://127.0.0.1:${P1}"
N2="http://127.0.0.1:${P2}"
N3="http://127.0.0.1:${P3}"
NODES="${N1},${N2},${N3}"

mkdir -p "$DATA/1" "$DATA/2" "$DATA/3" "$DATA/logs"
# Stop previous run if any
if [ -f "$DATA/pids" ]; then
  # shellcheck disable=SC1090
  sh "$DIR/stop-local.sh" 2>/dev/null || true
fi

start_one() {
  idx=$1
  port=$2
  advertise=$3
  datadir=$4
  logfile="$DATA/logs/n${idx}.log"
  # Detach from parent shell job control (avoids later bare `wait` hanging on nodes).
  # Optional lease/grace knobs (empty = server defaults)
  extra_env=""
  if [ -n "$LEASE_TTL" ]; then
    extra_env="$extra_env CLARKQ_LEASE_TTL=$LEASE_TTL"
  fi
  if [ -n "$OWNER_GRACE" ]; then
    extra_env="$extra_env CLARKQ_OWNER_GRACE=$OWNER_GRACE"
  fi

  # shellcheck disable=SC2086
  if command -v setsid >/dev/null 2>&1; then
    setsid env \
      CLARKQ_ADDR=":${port}" \
      CLARKQ_API_KEY="$API_KEY" \
      CLARKQ_ENCRYPTION_MODE=none \
      CLARKQ_CLUSTER_ADVERTISE_URL="$advertise" \
      CLARKQ_CLUSTER_NODES="$NODES" \
      CLARKQ_CLUSTER_SECRET="$SECRET" \
      CLARKQ_REPLICATION_FACTOR="$RF" \
      CLARKQ_REPLICATION_MODE="$MODE" \
      CLARKQ_CLUSTER_PROBE_INTERVAL="$PROBE" \
      CLARKQ_CLUSTER_FAIL_THRESHOLD="$FAIL_TH" \
      CLARKQ_CATCHUP_INTERVAL="$CATCHUP" \
      CLARKQ_LINEARIZABLE_CONSUME="$LINEARIZABLE" \
      CLARKQ_LEASE_ENABLED="$LEASE" \
      $extra_env \
      CLARKQ_WAL_PATH="$datadir/clarkq.wal" \
      CLARKQ_SNAPSHOT_PATH="$datadir/snapshot.json" \
      CLARKQ_SNAPSHOT_INTERVAL=10s \
      CLARKQ_OUTBOX_PATH="$datadir/outbox.json" \
      "$BIN" >"$logfile" 2>&1 < /dev/null &
  else
    env \
      CLARKQ_ADDR=":${port}" \
      CLARKQ_API_KEY="$API_KEY" \
      CLARKQ_ENCRYPTION_MODE=none \
      CLARKQ_CLUSTER_ADVERTISE_URL="$advertise" \
      CLARKQ_CLUSTER_NODES="$NODES" \
      CLARKQ_CLUSTER_SECRET="$SECRET" \
      CLARKQ_REPLICATION_FACTOR="$RF" \
      CLARKQ_REPLICATION_MODE="$MODE" \
      CLARKQ_CLUSTER_PROBE_INTERVAL="$PROBE" \
      CLARKQ_CLUSTER_FAIL_THRESHOLD="$FAIL_TH" \
      CLARKQ_CATCHUP_INTERVAL="$CATCHUP" \
      CLARKQ_LINEARIZABLE_CONSUME="$LINEARIZABLE" \
      CLARKQ_LEASE_ENABLED="$LEASE" \
      $extra_env \
      CLARKQ_WAL_PATH="$datadir/clarkq.wal" \
      CLARKQ_SNAPSHOT_PATH="$datadir/snapshot.json" \
      CLARKQ_SNAPSHOT_INTERVAL=10s \
      CLARKQ_OUTBOX_PATH="$datadir/outbox.json" \
      "$BIN" >"$logfile" 2>&1 < /dev/null &
  fi
  pid=$!
  echo "$pid" >>"$DATA/pids"
  disown "$pid" 2>/dev/null || true
  echo "  node${idx} pid=${pid} port=${port} log=${logfile}"
}

: >"$DATA/pids"
echo "→ Starting 3-process cluster (RF=${RF} mode=${MODE})"
echo "  binary: $BIN"
echo "  data:   $DATA"
echo "  ports:  ${P1} ${P2} ${P3}"
start_one 1 "$P1" "$N1" "$DATA/1"
# brief stagger avoids rare same-ms bind races on busy hosts
sleep 0.15
start_one 2 "$P2" "$N2" "$DATA/2"
sleep 0.15
start_one 3 "$P3" "$N3" "$DATA/3"

# Export for callers
cat >"$DATA/env.sh" <<EOF
export CLARKQ_API_KEY='$API_KEY'
export CLARKQ_CLUSTER_SECRET='$SECRET'
export CLARKQ_URL='$N1'
export CLARKQ_NODES='$N1 $N2 $N3'
export CLARKQ_CLUSTER_DATA='$DATA'
export CLARKQ_CLUSTER_BASE_PORT='$BASE_PORT'
export CLARKQ_REPLICATION_FACTOR='$RF'
EOF

# Wait healthy — require clarkQ JSON, not merely HTTP 200 (ports can be hijacked).
is_cq() {
  body=$(curl -sS --connect-timeout 1 --max-time 2 "$1/health" 2>/dev/null || true)
  case "$body" in
    *'"status":"ok"'*)
      case "$body" in
        *version*|*cluster*) return 0 ;;
      esac
      ;;
  esac
  return 1
}

i=0
while [ "$i" -lt 45 ]; do
  ok=0
  for url in "$N1" "$N2" "$N3"; do
    if is_cq "$url"; then
      ok=$((ok + 1))
    fi
  done
  if [ "$ok" -eq 3 ]; then
    # also ensure processes still alive
    dead=0
    while read -r pid; do
      [ -z "$pid" ] && continue
      kill -0 "$pid" 2>/dev/null || dead=$((dead + 1))
    done <"$DATA/pids"
    if [ "$dead" -eq 0 ]; then
      echo "→ All 3 nodes healthy (clarkQ JSON ok)"
      echo "  URLs: $N1  $N2  $N3"
      echo "  Stop: $DIR/stop-local.sh"
      exit 0
    fi
  fi
  i=$((i + 1))
  sleep 1
done

echo "cluster failed to become healthy (need 3x clarkQ /health JSON)" >&2
echo "--- process status ---" >&2
while read -r pid; do
  if kill -0 "$pid" 2>/dev/null; then
    echo "  pid $pid alive" >&2
  else
    echo "  pid $pid DEAD" >&2
  fi
done <"$DATA/pids"
echo "--- logs ---" >&2
tail -n 40 "$DATA/logs"/n*.log 2>/dev/null >&2 || true
sh "$DIR/stop-local.sh" 2>/dev/null || true
exit 1
