#!/bin/sh
# Scenario: kill one process/container, remaining nodes still serve
# Sourced by run-scenarios.sh
# Uses CLARKQ_CLUSTER_MODE=local|docker and helper hooks from run-cluster-demo.

section "04 · Failover (kill one node, traffic continues)"

if [ "${CLARKQ_CLUSTER_SKIP_FAILOVER:-}" = "1" ]; then
  skip "failover skipped (CLARKQ_CLUSTER_SKIP_FAILOVER=1)"
  return 0 2>/dev/null || exit 0
fi

Q="failover-demo"
entry=$(first_healthy)
CLARKQ_URL="$entry"
export CLARKQ_URL

req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true

req POST "/api/v1/queue/${Q}" \
  -H "Content-Type: application/json" \
  -d '{"body":"before-kill","metadata":{"phase":"pre"}}'
expect_code 201 "enqueue before killing a node"

# Choose victim: prefer a node that is NOT our current entry if possible
VICTIM=""
for base in $CLARKQ_NODES; do
  if [ "$base" != "$entry" ]; then
    VICTIM=$base
    break
  fi
done
if [ -z "$VICTIM" ]; then
  # only one node listed
  for base in $CLARKQ_NODES; do
    VICTIM=$base
    break
  done
fi
dim "  victim node: ${VICTIM}"

# Kill victim
if [ "${CLARKQ_CLUSTER_MODE:-local}" = "docker" ]; then
  # Map host URL port to compose service
  # ports 18081→clarkq-1, 18082→clarkq-2, 18083→clarkq-3 (defaults)
  svc=""
  # Map by port offset from base (…81→1, …82→2, …83→3) or explicit defaults
  port=$(printf '%s' "$VICTIM" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')
  base_port="${CLARKQ_CLUSTER_BASE_PORT:-38481}"
  off=$((port - base_port))
  case "$off" in
    0) svc=clarkq-1 ;;
    1) svc=clarkq-2 ;;
    2) svc=clarkq-3 ;;
    *)
      case "$port" in
        *81) svc=clarkq-1 ;;
        *82) svc=clarkq-2 ;;
        *83) svc=clarkq-3 ;;
      esac
      ;;
  esac
  if [ -z "$svc" ]; then
    bad "cannot map victim $VICTIM to compose service"
    return 0 2>/dev/null || exit 0
  fi
  COMPOSE_FILE="${CLARKQ_CLUSTER_COMPOSE:-}"
  PROJECT="${CLARKQ_CLUSTER_PROJECT:-clarkqcluster}"
  if [ -n "$COMPOSE_FILE" ] && docker compose -f "$COMPOSE_FILE" -p "$PROJECT" stop "$svc" >/tmp/clarkq_failover_stop.log 2>&1; then
    ok "docker stop ${svc}"
  else
    bad "docker stop ${svc} failed (see /tmp/clarkq_failover_stop.log)"
    return 0 2>/dev/null || exit 0
  fi
else
  # local multi-process: kill by port
  port=$(printf '%s' "$VICTIM" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')
  pid=""
  if command -v fuser >/dev/null 2>&1; then
    pid=$(fuser "${port}/tcp" 2>/dev/null | awk '{print $1}' | head -1 || true)
  fi
  if [ -z "$pid" ] && command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)
  fi
  if [ -z "$pid" ] && [ -f "${CLARKQ_CLUSTER_DATA:-/tmp/clarkq-cluster-demo}/pids" ]; then
    # fall back: kill middle pid (node 2) if victim is :18082 etc.
    # match by scanning logs is hard; use ss
    if command -v ss >/dev/null 2>&1; then
      pid=$(ss -lptn "sport = :${port}" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
    fi
  fi
  if [ -n "$pid" ] && kill "$pid" 2>/dev/null; then
    ok "killed process pid=${pid} on port ${port}"
    # remove from pids file so stop-local won't complain
    DATA="${CLARKQ_CLUSTER_DATA:-/tmp/clarkq-cluster-demo}"
    if [ -f "$DATA/pids" ]; then
      grep -v "^${pid}$" "$DATA/pids" >"$DATA/pids.tmp" 2>/dev/null || true
      mv "$DATA/pids.tmp" "$DATA/pids" 2>/dev/null || true
    fi
  else
    bad "could not find/kill process for ${VICTIM} (port=${port})"
    return 0 2>/dev/null || exit 0
  fi
fi

# Wait for remaining healthy count = total-1
total=0
for _ in $CLARKQ_NODES; do
  total=$((total + 1))
done
want=$((total - 1))
wait_cluster_healthy "$want" 30 || true

# Membership on a live node should eventually drop the dead peer
wait_alive_count "$want" 25 || true

# Use a still-healthy entry
entry=$(first_healthy) || true
if [ -z "${entry:-}" ]; then
  bad "no healthy node after kill"
  return 0 2>/dev/null || exit 0
fi
CLARKQ_URL="$entry"
export CLARKQ_URL
ok "using survivor ${entry}"

# Enqueue after kill — membership views can lag between peers, so try every
# survivor and retry through 503/409 until the ring converges.
enqueued=0
tries=0
while [ "$tries" -lt 25 ]; do
  for base in $CLARKQ_NODES; do
    is_clarkq_health "$base" || continue
    [ "$base" = "$VICTIM" ] && continue
    req_node "$base" POST "/api/v1/queue/${Q}" \
      -H "Content-Type: application/json" \
      -d '{"body":"after-kill","metadata":{"phase":"post"}}'
    if [ "$CODE" = "201" ]; then
      enqueued=1
      CLARKQ_URL="$base"
      export CLARKQ_URL
      break
    fi
  done
  if [ "$enqueued" -eq 1 ]; then
    break
  fi
  tries=$((tries + 1))
  sleep 1
done
if [ "$enqueued" -eq 1 ]; then
  ok "enqueue after node kill (via ${CLARKQ_URL}, tries=$((tries + 1)))"
else
  bad "enqueue after node kill failed after retries (last HTTP $CODE body=$BODY)"
fi

# Drain whatever is available (before-kill may live on a replica)
got_after=0
got_any=0
tries=0
while [ "$tries" -lt 20 ]; do
  # rotate among survivors in case of NOT_OWNER lag
  for base in $CLARKQ_NODES; do
    is_clarkq_health "$base" || continue
    [ "$base" = "$VICTIM" ] && continue
    req_node "$base" GET "/api/v1/queue/${Q}"
    if [ "$CODE" = "200" ]; then
      got_any=$((got_any + 1))
      case "$BODY" in
        *after-kill*) got_after=1 ;;
      esac
      CLARKQ_URL="$base"
      export CLARKQ_URL
    fi
  done
  # stop if empty on a survivor
  req GET "/api/v1/queue/${Q}"
  if [ "$CODE" = "204" ] && [ "$got_any" -ge 1 ]; then
    break
  fi
  if [ "$got_after" -eq 1 ] && [ "$CODE" = "204" ]; then
    break
  fi
  tries=$((tries + 1))
  sleep 0.5
done
if [ "$got_after" -eq 1 ] || [ "$got_any" -ge 1 ]; then
  ok "consume works after failover (got_any=${got_any}, saw after-kill=${got_after})"
else
  bad "could not consume after failover (last HTTP $CODE body=$BODY)"
fi

# Restart victim so later load scenario hits all nodes
if [ "${CLARKQ_CLUSTER_MODE:-local}" = "docker" ]; then
  COMPOSE_FILE="${CLARKQ_CLUSTER_COMPOSE:-}"
  PROJECT="${CLARKQ_CLUSTER_PROJECT:-clarkqcluster}"
  if docker compose -f "$COMPOSE_FILE" -p "$PROJECT" start "$svc" >/tmp/clarkq_failover_start.log 2>&1; then
    ok "restarted docker service ${svc}"
  else
    bad "failed to restart ${svc}"
  fi
else
  # local multi-process: relaunch the killed port with same cluster env
  port=$(printf '%s' "$VICTIM" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')
  DATA="${CLARKQ_CLUSTER_DATA:-/tmp/clarkq-cluster-demo}"
  BIN="${CLARKQ_BIN:-}"
  if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
    ROOT_GUESS="${CLARKQ_CLUSTER_DIR:-}/../.."
    if [ -x "$ROOT_GUESS/bin/clarkq" ]; then
      BIN="$ROOT_GUESS/bin/clarkq"
    fi
  fi
  # resolve absolute BIN
  if [ -n "$BIN" ] && [ -x "$BIN" ]; then
    # recover node index by port offset
    base_port="${CLARKQ_CLUSTER_BASE_PORT:-18081}"
    idx=$((port - base_port + 1))
    datadir="$DATA/${idx}"
    mkdir -p "$datadir" "$DATA/logs"
    # rebuild NODES list comma-separated from CLARKQ_NODES
    NODES_CSV=$(printf '%s' "$CLARKQ_NODES" | tr ' ' ',')
    RF="${CLARKQ_REPLICATION_FACTOR:-2}"
    MODE="${CLARKQ_REPLICATION_MODE:-sync}"
    SECRET="${CLARKQ_CLUSTER_SECRET:-dev-cluster-secret}"
    API_KEY="${CLARKQ_API_KEY:-dev-key}"
    # setsid detaches so later `wait` in load scenario does not block on this node
    if command -v setsid >/dev/null 2>&1; then
      setsid env \
        CLARKQ_ADDR=":${port}" \
        CLARKQ_API_KEY="$API_KEY" \
        CLARKQ_ENCRYPTION_MODE=none \
        CLARKQ_CLUSTER_ADVERTISE_URL="$VICTIM" \
        CLARKQ_CLUSTER_NODES="$NODES_CSV" \
        CLARKQ_CLUSTER_SECRET="$SECRET" \
        CLARKQ_REPLICATION_FACTOR="$RF" \
        CLARKQ_REPLICATION_MODE="$MODE" \
        CLARKQ_CLUSTER_PROBE_INTERVAL=1s \
        CLARKQ_CLUSTER_FAIL_THRESHOLD=2 \
        CLARKQ_CATCHUP_INTERVAL=2s \
        CLARKQ_WAL_PATH="$datadir/clarkq.wal" \
        CLARKQ_SNAPSHOT_PATH="$datadir/snapshot.json" \
        CLARKQ_SNAPSHOT_INTERVAL=10s \
        CLARKQ_OUTBOX_PATH="$datadir/outbox.json" \
        "$BIN" >"$DATA/logs/n${idx}-restart.log" 2>&1 < /dev/null &
    else
      env \
        CLARKQ_ADDR=":${port}" \
        CLARKQ_API_KEY="$API_KEY" \
        CLARKQ_ENCRYPTION_MODE=none \
        CLARKQ_CLUSTER_ADVERTISE_URL="$VICTIM" \
        CLARKQ_CLUSTER_NODES="$NODES_CSV" \
        CLARKQ_CLUSTER_SECRET="$SECRET" \
        CLARKQ_REPLICATION_FACTOR="$RF" \
        CLARKQ_REPLICATION_MODE="$MODE" \
        CLARKQ_CLUSTER_PROBE_INTERVAL=1s \
        CLARKQ_CLUSTER_FAIL_THRESHOLD=2 \
        CLARKQ_CATCHUP_INTERVAL=2s \
        CLARKQ_WAL_PATH="$datadir/clarkq.wal" \
        CLARKQ_SNAPSHOT_PATH="$datadir/snapshot.json" \
        CLARKQ_SNAPSHOT_INTERVAL=10s \
        CLARKQ_OUTBOX_PATH="$datadir/outbox.json" \
        "$BIN" >"$DATA/logs/n${idx}-restart.log" 2>&1 < /dev/null &
    fi
    rpid=$!
    echo "$rpid" >>"$DATA/pids"
    # Drop from this shell's job table when possible
    disown "$rpid" 2>/dev/null || true
    ok "relaunched local node on port ${port} (pid=${rpid})"
  else
    bad "cannot relaunch victim: binary missing"
  fi
fi

wait_cluster_healthy "$total" 40 || wait_cluster_healthy 2 10 || true
