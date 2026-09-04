#!/bin/sh
# Shared helpers for multi-node cluster scenarios (POSIX sh + curl).
# Safe to source multiple times.

: "${CLARKQ_API_KEY:=dev-key}"
: "${CLARKQ_CLUSTER_SECRET:=dev-cluster-secret}"
# Space-separated base URLs (no trailing slash). Default ports avoid common 18xxx collisions.
: "${CLARKQ_NODES:=http://127.0.0.1:38481 http://127.0.0.1:38482 http://127.0.0.1:38483}"
# Default client entrypoint (any live node)
: "${CLARKQ_URL:=http://127.0.0.1:38481}"

if [ -z "${CLARKQ_CLUSTER_LIB_LOADED:-}" ]; then
  PASS=0
  FAIL=0
  SKIP=0
  CLARKQ_CLUSTER_LIB_LOADED=1
fi

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

section() {
  echo
  cyan "════════════════════════════════════════"
  cyan "  $*"
  cyan "════════════════════════════════════════"
}

ok() {
  PASS=$((PASS + 1))
  green "  ✓ $*"
}

bad() {
  FAIL=$((FAIL + 1))
  red "  ✗ $*"
}

skip() {
  SKIP=$((SKIP + 1))
  dim "  · $*"
}

# HTTP against $CLARKQ_URL
req() {
  method=$1
  path=$2
  shift 2
  url="${CLARKQ_URL}${path}"
  CODE=$(curl -sS -o /tmp/clarkq_cluster_body -w '%{http_code}' \
    --connect-timeout 3 --max-time 15 \
    -X "$method" "$url" \
    -H "X-API-Key: ${CLARKQ_API_KEY}" \
    "$@" 2>/tmp/clarkq_cluster_err) || true
  if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then
    CODE=000
    BODY=$(cat /tmp/clarkq_cluster_err 2>/dev/null || echo "curl failed")
  else
    BODY=$(cat /tmp/clarkq_cluster_body 2>/dev/null || true)
  fi
}

req_noauth() {
  method=$1
  path=$2
  shift 2
  url="${CLARKQ_URL}${path}"
  CODE=$(curl -sS -o /tmp/clarkq_cluster_body -w '%{http_code}' \
    --connect-timeout 3 --max-time 10 \
    -X "$method" "$url" "$@" 2>/tmp/clarkq_cluster_err) || true
  if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then
    CODE=000
    BODY=$(cat /tmp/clarkq_cluster_err 2>/dev/null || echo "curl failed")
  else
    BODY=$(cat /tmp/clarkq_cluster_body 2>/dev/null || true)
  fi
}

# HTTP against an explicit base URL
req_node() {
  base=$1
  method=$2
  path=$3
  shift 3
  url="${base}${path}"
  CODE=$(curl -sS -o /tmp/clarkq_cluster_body -w '%{http_code}' \
    --connect-timeout 3 --max-time 15 \
    -X "$method" "$url" \
    -H "X-API-Key: ${CLARKQ_API_KEY}" \
    "$@" 2>/tmp/clarkq_cluster_err) || true
  if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then
    CODE=000
    BODY=$(cat /tmp/clarkq_cluster_err 2>/dev/null || echo "curl failed")
  else
    BODY=$(cat /tmp/clarkq_cluster_body 2>/dev/null || true)
  fi
}

req_internal() {
  base=$1
  method=$2
  path=$3
  shift 3
  url="${base}${path}"
  CODE=$(curl -sS -o /tmp/clarkq_cluster_body -w '%{http_code}' \
    --connect-timeout 3 --max-time 10 \
    -X "$method" "$url" \
    -H "X-ClarkQ-Cluster-Token: ${CLARKQ_CLUSTER_SECRET}" \
    "$@" 2>/tmp/clarkq_cluster_err) || true
  if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then
    CODE=000
    BODY=$(cat /tmp/clarkq_cluster_err 2>/dev/null || echo "curl failed")
  else
    BODY=$(cat /tmp/clarkq_cluster_body 2>/dev/null || true)
  fi
}

expect_code() {
  want=$1
  desc=$2
  if [ "$CODE" = "$want" ]; then
    ok "$desc (HTTP $CODE)"
  else
    bad "$desc (want HTTP $want, got $CODE) body=${BODY}"
  fi
}

body_contains() {
  needle=$1
  desc=$2
  case "$BODY" in
    *"$needle"*) ok "$desc" ;;
    *) bad "$desc (missing '$needle' in: $BODY)" ;;
  esac
}

# True if base URL serves clarkQ /health JSON (not some other app on the port).
is_clarkq_health() {
  base=$1
  body=$(curl -sS --connect-timeout 2 --max-time 3 "${base}/health" 2>/dev/null || true)
  case "$body" in
    *'"status":"ok"'*|*'\"status\": \"ok\"'*)
      case "$body" in
        *version*|*cluster*) return 0 ;;
      esac
      # single-node may omit cluster; still require version field shape
      case "$body" in
        *'"version"'*) return 0 ;;
      esac
      ;;
  esac
  return 1
}

# Count how many configured nodes answer clarkQ /health.
count_healthy() {
  n=0
  for base in $CLARKQ_NODES; do
    if is_clarkq_health "$base"; then
      n=$((n + 1))
    fi
  done
  echo "$n"
}

# First healthy clarkQ node base URL, or empty.
first_healthy() {
  for base in $CLARKQ_NODES; do
    if is_clarkq_health "$base"; then
      echo "$base"
      return 0
    fi
  done
  return 1
}

# Wait until at least $1 nodes are healthy (default: all in CLARKQ_NODES).
wait_cluster_healthy() {
  want=${1:-0}
  if [ "$want" -eq 0 ]; then
    want=0
    for _ in $CLARKQ_NODES; do
      want=$((want + 1))
    done
  fi
  max=${2:-60}
  dim "Waiting for ≥${want} healthy nodes (max ${max}s) ..."
  i=0
  while [ "$i" -lt "$max" ]; do
    got=$(count_healthy)
    if [ "$got" -ge "$want" ]; then
      ok "cluster healthy: ${got}/${want}+ nodes"
      entry=$(first_healthy) || true
      if [ -n "${entry:-}" ]; then
        CLARKQ_URL="$entry"
        export CLARKQ_URL
      fi
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  bad "cluster not healthy enough after ${max}s (healthy=$(count_healthy), want≥${want})"
  return 1
}

# Wait until a live node's /health reports alive length <= $1 (or ==).
# Uses JSON "alive" array string length heuristically via count of http URLs in alive field.
wait_alive_count() {
  want=$1
  max=${2:-30}
  entry=$(first_healthy) || entry="$CLARKQ_URL"
  dim "Waiting for membership alive≈${want} via ${entry} (max ${max}s) ..."
  i=0
  while [ "$i" -lt "$max" ]; do
    body=$(curl -sS --connect-timeout 2 --max-time 5 "${entry}/health" 2>/dev/null || true)
    # Count occurrences of "http" inside the alive section roughly:
    # health embeds "alive":["url",...] — count http:// appearances after "alive"
    alive_part=$(printf '%s' "$body" | sed -n 's/.*"alive":\[\([^]]*\)\].*/\1/p')
    if [ -z "$alive_part" ]; then
      # fallback: total http:// in whole body (includes nodes too — less precise)
      got=$(printf '%s' "$body" | tr ',' '\n' | grep -c 'http' || true)
    else
      got=$(printf '%s' "$alive_part" | tr ',' '\n' | grep -c 'http' || true)
    fi
    # shellcheck disable=SC2086
    if [ "${got:-0}" -eq "$want" ] 2>/dev/null; then
      ok "membership alive count = ${got}"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  bad "membership did not reach alive=${want} (last got=${got:-?} body=${body:-empty})"
  return 1
}

summary() {
  echo
  cyan "──────── cluster demo summary ────────"
  green "  passed: $PASS"
  if [ "$FAIL" -gt 0 ]; then
    red "  failed: $FAIL"
  else
    echo "  failed: 0"
  fi
  if [ "$SKIP" -gt 0 ]; then
    dim "  skipped: $SKIP"
  fi
  echo
  if [ "$FAIL" -gt 0 ]; then
    red "Some cluster checks failed. See above."
    return 1
  fi
  green "All cluster scenarios passed."
  return 0
}

# --- stress / partition helpers ---

# Map host base URL → compose service name (clarkq-1|2|3) using port offset.
svc_from_url() {
  base=$1
  port=$(printf '%s' "$base" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')
  base_port="${CLARKQ_CLUSTER_BASE_PORT:-38481}"
  off=$((port - base_port))
  case "$off" in
    0) echo clarkq-1; return 0 ;;
    1) echo clarkq-2; return 0 ;;
    2) echo clarkq-3; return 0 ;;
  esac
  case "$port" in
    *81) echo clarkq-1; return 0 ;;
    *82) echo clarkq-2; return 0 ;;
    *83) echo clarkq-3; return 0 ;;
  esac
  return 1
}

# Compose project container name for a service (best-effort).
container_for_svc() {
  svc=$1
  PROJECT="${CLARKQ_CLUSTER_PROJECT:-clarkqcluster}"
  COMPOSE_FILE="${CLARKQ_CLUSTER_COMPOSE:-}"
  if [ -n "$COMPOSE_FILE" ] && command -v docker >/dev/null 2>&1; then
    id=$(docker compose -f "$COMPOSE_FILE" -p "$PROJECT" ps -q "$svc" 2>/dev/null | head -1)
    if [ -n "$id" ]; then
      echo "$id"
      return 0
    fi
  fi
  # fallback by name pattern
  docker ps -q -f "name=${PROJECT}-${svc}" 2>/dev/null | head -1
}

# POST with retries on 409/503 (membership / lease / grace).
# Sets CODE/BODY like req; returns 0 if final CODE=201.
retry_enqueue() {
  base=$1
  queue=$2
  body=$3
  max=${4:-12}
  r=0
  while [ "$r" -lt "$max" ]; do
    req_node "$base" POST "/api/v1/queue/${queue}" \
      -H "Content-Type: application/json" \
      -d "$body"
    if [ "$CODE" = "201" ]; then
      return 0
    fi
    if [ "$CODE" = "409" ] || [ "$CODE" = "503" ] || [ "$CODE" = "000" ]; then
      sleep 0.25
      r=$((r + 1))
      # try another healthy entry point next loop
      alt=$(first_healthy 2>/dev/null || true)
      if [ -n "${alt:-}" ]; then
        base="$alt"
      fi
      continue
    fi
    return 1
  done
  return 1
}

# Consume one message with retries; sets CODE/BODY.
retry_consume() {
  base=$1
  queue=$2
  max=${3:-10}
  r=0
  while [ "$r" -lt "$max" ]; do
    req_node "$base" GET "/api/v1/queue/${queue}"
    if [ "$CODE" = "200" ] || [ "$CODE" = "204" ] || [ "$CODE" = "404" ]; then
      return 0
    fi
    if [ "$CODE" = "409" ] || [ "$CODE" = "503" ] || [ "$CODE" = "000" ]; then
      sleep 0.25
      r=$((r + 1))
      alt=$(first_healthy 2>/dev/null || true)
      if [ -n "${alt:-}" ]; then
        base="$alt"
      fi
      continue
    fi
    return 1
  done
  return 1
}

# List currently healthy node URLs (space-separated).
healthy_nodes() {
  out=""
  for base in $CLARKQ_NODES; do
    if is_clarkq_health "$base"; then
      out="${out} ${base}"
    fi
  done
  printf '%s' "$out" | sed 's/^ *//'
}

# Partition a node: docker network disconnect, or local SIGSTOP freeze.
# Arg: base URL of victim.
partition_node() {
  victim=$1
  export CLARKQ_PARTITION_VICTIM="$victim"
  export CLARKQ_PARTITION_KIND=""
  export CLARKQ_PARTITION_TARGET=""

  if [ "${CLARKQ_CLUSTER_MODE:-local}" = "docker" ]; then
    svc=$(svc_from_url "$victim") || {
      bad "cannot map $victim to service"
      return 1
    }
    cid=$(container_for_svc "$svc")
    if [ -z "$cid" ]; then
      bad "no container for $svc"
      return 1
    fi
    # Disconnect from all non-default networks the container is on (usually one bridge).
    nets=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$cid" 2>/dev/null || true)
    if [ -z "$nets" ]; then
      bad "container $cid has no networks"
      return 1
    fi
    for net in $nets; do
      docker network disconnect -f "$net" "$cid" >/tmp/clarkq_part_disc.log 2>&1 || {
        bad "docker network disconnect $net $svc failed"
        return 1
      }
      export CLARKQ_PARTITION_NETS="${CLARKQ_PARTITION_NETS:-} $net"
    done
    export CLARKQ_PARTITION_KIND=docker
    export CLARKQ_PARTITION_TARGET="$cid"
    export CLARKQ_PARTITION_SVC="$svc"
    ok "partitioned docker $svc ($cid) via network disconnect"
    return 0
  fi

  # local: freeze process (simulates unresponsive partition better than kill for leases)
  port=$(printf '%s' "$victim" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')
  pid=""
  if command -v fuser >/dev/null 2>&1; then
    pid=$(fuser "${port}/tcp" 2>/dev/null | awk '{print $1}' | head -1 || true)
  fi
  if [ -z "$pid" ] && command -v ss >/dev/null 2>&1; then
    pid=$(ss -lntp "sport = :${port}" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)
  fi
  if [ -z "$pid" ]; then
    bad "cannot find pid for local node on port $port"
    return 1
  fi
  if kill -STOP "$pid" 2>/tmp/clarkq_part_stop.log; then
    export CLARKQ_PARTITION_KIND=local
    export CLARKQ_PARTITION_TARGET="$pid"
    ok "partitioned local pid=$pid (SIGSTOP freeze) on port $port"
    return 0
  fi
  bad "SIGSTOP failed for pid $pid"
  return 1
}

# Heal previously partitioned node.
heal_node() {
  kind="${CLARKQ_PARTITION_KIND:-}"
  target="${CLARKQ_PARTITION_TARGET:-}"
  if [ -z "$kind" ] || [ -z "$target" ]; then
    skip "no partition state to heal"
    return 0
  fi
  if [ "$kind" = "docker" ]; then
    nets="${CLARKQ_PARTITION_NETS:-}"
    for net in $nets; do
      docker network connect "$net" "$target" >/tmp/clarkq_part_heal.log 2>&1 || {
        # already connected is ok
        true
      }
    done
    ok "healed docker container $target (network reconnect)"
    return 0
  fi
  if [ "$kind" = "local" ]; then
    if kill -CONT "$target" 2>/tmp/clarkq_part_cont.log; then
      ok "healed local pid=$target (SIGCONT)"
      return 0
    fi
    bad "SIGCONT failed for pid $target"
    return 1
  fi
  bad "unknown partition kind $kind"
  return 1
}

# Apply netem delay inside a docker container (needs NET_ADMIN).
# Args: service-name delay e.g. "clarkq-2" "100ms"
apply_netem_delay() {
  svc=$1
  delay=${2:-100ms}
  jitter=${3:-20ms}
  cid=$(container_for_svc "$svc")
  if [ -z "$cid" ]; then
    return 1
  fi
  if ! docker exec "$cid" sh -c "command -v tc >/dev/null 2>&1" 2>/dev/null; then
    return 1
  fi
  # Docker bridge ifaces are often eth0; some runtimes use ens* / eth1 — probe default route.
  docker exec \
    -e "CLARKQ_NETEM_D=$delay" \
    -e "CLARKQ_NETEM_J=$jitter" \
    "$cid" sh -c '
    delay="$CLARKQ_NETEM_D"; jitter="$CLARKQ_NETEM_J"
    iface=$(ip -o route show default 2>/dev/null | awk "{print \$5; exit}")
    if [ -z "$iface" ]; then
      iface=$(ls /sys/class/net 2>/dev/null | grep -v lo | head -1)
    fi
    if [ -z "$iface" ]; then
      echo "no net iface (sys=$(ls /sys/class/net 2>/dev/null))" >&2
      exit 1
    fi
    echo "netem iface=$iface delay=$delay jitter=$jitter" >&2
    if [ -n "$jitter" ]; then
      tc qdisc replace dev "$iface" root netem delay "$delay" "$jitter" || \
        tc qdisc replace dev "$iface" root netem delay "$delay"
    else
      tc qdisc replace dev "$iface" root netem delay "$delay"
    fi
  ' 2>/tmp/clarkq_netem.log
  return $?
}

clear_netem() {
  svc=$1
  cid=$(container_for_svc "$svc")
  [ -n "$cid" ] || return 0
  docker exec "$cid" sh -c '
    for iface in $(ls /sys/class/net 2>/dev/null | grep -v lo); do
      tc qdisc del dev "$iface" root 2>/dev/null || true
    done
  ' >/dev/null 2>&1 || true
}
