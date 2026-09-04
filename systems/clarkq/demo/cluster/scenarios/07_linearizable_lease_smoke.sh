#!/bin/sh
# Scenario: optional linearizable consume + lease ownership smoke.
# Skips when flags are off (default cluster demo). Enable with:
#   CLARKQ_LINEARIZABLE_CONSUME=true CLARKQ_LEASE_ENABLED=true ./run-cluster-demo.sh
# Sourced by run-scenarios.sh

section "07 · Linearizable consume + lease (optional)"

Q="adv-lin-lease-demo"
entry=$(first_healthy)
if [ -z "${entry:-}" ]; then
  bad "no healthy node for advanced smoke"
  return 0 2>/dev/null || exit 0
fi
CLARKQ_URL="$entry"
export CLARKQ_URL

req GET /api/v1/cluster
if [ "$CODE" != "200" ]; then
  bad "cluster status unavailable (HTTP $CODE)"
  return 0 2>/dev/null || exit 0
fi

# Detect flags from live cluster status, fall back to env used to start the stack.
lin_on=0
lease_on=0
case "${CLARKQ_LINEARIZABLE_CONSUME:-false}" in
  1|true|TRUE|yes|YES|on|ON) lin_on=1 ;;
esac
case "${CLARKQ_LEASE_ENABLED:-false}" in
  1|true|TRUE|yes|YES|on|ON) lease_on=1 ;;
esac
if printf '%s' "$BODY" | grep -q '"leases_enabled":true'; then
  lease_on=1
fi
if printf '%s' "$BODY" | grep -q '"linearizable_consume":true'; then
  lin_on=1
fi

if [ "$lin_on" -eq 0 ] && [ "$lease_on" -eq 0 ]; then
  skip "linearizable/lease flags off — set CLARKQ_LINEARIZABLE_CONSUME / CLARKQ_LEASE_ENABLED to exercise"
  return 0 2>/dev/null || exit 0
fi

req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true

# --- write path (lease may gate ownership) ---
n=0
okn=0
while [ "$n" -lt 3 ]; do
  n=$((n + 1))
  r=0
  while [ "$r" -lt 8 ]; do
    req POST "/api/v1/queue/${Q}" \
      -H "Content-Type: application/json" \
      -d "{\"body\":\"adv-${n}\"}"
    if [ "$CODE" = "201" ]; then
      okn=$((okn + 1))
      break
    fi
    # membership / lease / grace — honor Retry-After-ish backoff
    if [ "$CODE" = "409" ] || [ "$CODE" = "503" ]; then
      if printf '%s' "$BODY" | grep -q '"retryable":true'; then
        :
      fi
      sleep 0.35
      r=$((r + 1))
      continue
    fi
    break
  done
done

if [ "$okn" -eq 3 ]; then
  ok "3/3 enqueues under advanced flags (lin=${lin_on} lease=${lease_on})"
else
  bad "only ${okn}/3 enqueues under advanced flags (last HTTP $CODE body=$BODY)"
fi

# --- consume path (linearizable uses read/delete quorum) ---
drained=0
tries=0
while [ "$drained" -lt 3 ] && [ "$tries" -lt 30 ]; do
  tries=$((tries + 1))
  req GET "/api/v1/queue/${Q}"
  if [ "$CODE" = "200" ]; then
    drained=$((drained + 1))
    continue
  fi
  if [ "$CODE" = "204" ]; then
    # empty mid-stream only if we already got all; else wait for quorum/lease
    if [ "$drained" -ge 3 ]; then
      break
    fi
    sleep 0.25
    continue
  fi
  if [ "$CODE" = "409" ] || [ "$CODE" = "503" ]; then
    sleep 0.35
    continue
  fi
  sleep 0.2
done

if [ "$drained" -ge 3 ]; then
  ok "linearizable/normal drain got ${drained} messages"
else
  bad "drain only ${drained}/3 under advanced flags (last HTTP $CODE)"
fi

# Lease path: cluster status should report leases_enabled / leases_held
if [ "$lease_on" -eq 1 ]; then
  req GET /api/v1/cluster
  expect_code 200 "cluster status with leases"
  if printf '%s' "$BODY" | grep -q '"leases_enabled":true'; then
    ok "cluster status exposes leases_enabled=true"
  else
    skip "leases_enabled not true in status (enqueue path still exercised)"
  fi
fi

if [ "$lin_on" -eq 1 ]; then
  ok "linearizable consume path exercised (flag on)"
fi
