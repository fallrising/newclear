#!/bin/sh
# Scenario: light concurrent load across nodes
# Sourced by run-scenarios.sh

section "06 · Load smoke (concurrent enqueue + drain)"

Q="load-demo"
N="${CLARKQ_CLUSTER_LOAD_N:-40}"
entry=$(first_healthy)
if [ -z "${entry:-}" ]; then
  bad "no healthy node for load smoke"
  return 0 2>/dev/null || exit 0
fi
CLARKQ_URL="$entry"
export CLARKQ_URL

req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true
# ensure clean
sleep 0.3
req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true

# Only target currently healthy nodes (after failover restarts may lag)
HEALTHY=""
for base in $CLARKQ_NODES; do
  c=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 1 --max-time 2 \
    "${base}/health" 2>/dev/null || echo 000)
  if [ "$c" = "200" ]; then
    HEALTHY="${HEALTHY} ${base}"
  fi
done
HEALTHY=$(printf '%s' "$HEALTHY" | sed 's/^ *//')
if [ -z "$HEALTHY" ]; then
  bad "no healthy nodes for load smoke"
  return 0 2>/dev/null || exit 0
fi

tmpdir=$(mktemp -d)
# shellcheck disable=SC2086
set -- $HEALTHY
nodec=$#

dim "  launching ${N} concurrent enqueues across ${nodec} healthy node(s) ..."
i=1
PIDS=""
while [ "$i" -le "$N" ]; do
  idx=$(( (i - 1) % nodec + 1 ))
  eval "base=\${$idx}"
  (
    code=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 10 \
      -X POST "${base}/api/v1/queue/${Q}" \
      -H "X-API-Key: ${CLARKQ_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"body\":\"load-${i}\"}" 2>/dev/null || echo 000)
    echo "$code" >"${tmpdir}/${i}.code"
  ) &
  PIDS="$PIDS $!"
  if [ $((i % 20)) -eq 0 ]; then
    # wait only this batch of producer PIDs (not unrelated bg jobs)
    for p in $PIDS; do
      wait "$p" 2>/dev/null || true
    done
    PIDS=""
  fi
  i=$((i + 1))
done
for p in $PIDS; do
  wait "$p" 2>/dev/null || true
done

okn=0
failn=0
i=1
while [ "$i" -le "$N" ]; do
  c=$(cat "${tmpdir}/${i}.code" 2>/dev/null || echo 000)
  if [ "$c" = "201" ]; then
    okn=$((okn + 1))
  else
    failn=$((failn + 1))
  fi
  i=$((i + 1))
done
rm -rf "$tmpdir"

# Allow a few failures under kill aftermath; require ≥90%
need=$((N * 9 / 10))
if [ "$okn" -ge "$need" ]; then
  ok "concurrent enqueue ${okn}/${N} succeeded (≥90%)"
else
  bad "concurrent enqueue only ${okn}/${N} (failed=${failn})"
fi

# Drain with timeout
drained=0
empty_streak=0
deadline=$(( $(date +%s) + 30 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  req GET "/api/v1/queue/${Q}"
  if [ "$CODE" = "200" ]; then
    drained=$((drained + 1))
    empty_streak=0
  elif [ "$CODE" = "204" ]; then
    empty_streak=$((empty_streak + 1))
    if [ "$empty_streak" -ge 3 ]; then
      break
    fi
    sleep 0.1
  else
    sleep 0.2
  fi
done

if [ "$drained" -ge "$need" ]; then
  ok "drained ${drained} messages (need ≥${need})"
else
  bad "drained only ${drained}/${N} (need ≥${need})"
fi

req GET /api/v1/metrics
expect_code 200 "metrics after load"
body_contains enqueued_total "enqueued_total present"
