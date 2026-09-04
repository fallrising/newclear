#!/bin/sh
# Scenario: isolate one node (network disconnect or SIGSTOP), keep serving on survivors,
# heal, then continue traffic under linearizable + lease.
# Sourced by run-stress.sh

section "09 · Partition / jitter (isolate one node)"

Q="part-stress"
SECS_ISO="${CLARKQ_PARTITION_SECS:-8}"

req GET /api/v1/cluster
if [ "$CODE" != "200" ]; then
  bad "cluster status unavailable"
  return 0 2>/dev/null || exit 0
fi
lease_on=0
case "${CLARKQ_LEASE_ENABLED:-false}" in 1|true|TRUE|yes|YES|on|ON) lease_on=1 ;; esac
printf '%s' "$BODY" | grep -q '"leases_enabled":true' && lease_on=1
if [ "$lease_on" -eq 0 ]; then
  skip "lease not enabled — partition test is most meaningful with CLARKQ_LEASE_ENABLED=true"
  # still allow run if forced
  if [ "${CLARKQ_FORCE_PARTITION:-}" != "1" ]; then
    return 0 2>/dev/null || exit 0
  fi
fi

entry=$(first_healthy) || {
  bad "no healthy entry"
  return 0 2>/dev/null || exit 0
}
CLARKQ_URL="$entry"
export CLARKQ_URL

# Pick victim ≠ entry when possible
VICTIM=""
for base in $CLARKQ_NODES; do
  if [ "$base" != "$entry" ] && is_clarkq_health "$base"; then
    VICTIM=$base
    break
  fi
done
if [ -z "$VICTIM" ]; then
  for base in $CLARKQ_NODES; do
    if [ "$base" != "$entry" ]; then
      VICTIM=$base
      break
    fi
  done
fi
if [ -z "$VICTIM" ]; then
  bad "could not choose partition victim"
  return 0 2>/dev/null || exit 0
fi
dim "  entry=${entry}  victim=${VICTIM}  isolate=${SECS_ISO}s"

req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true

# Baseline writes
pre=0
i=0
while [ "$i" -lt 5 ]; do
  i=$((i + 1))
  if retry_enqueue "$entry" "$Q" "{\"body\":\"pre-${i}\"}" 10; then
    pre=$((pre + 1))
  fi
done
if [ "$pre" -ge 4 ]; then
  ok "pre-partition enqueues ${pre}/5"
else
  bad "pre-partition enqueues only ${pre}/5"
fi

# Isolate
CLARKQ_PARTITION_NETS=""
export CLARKQ_PARTITION_NETS
if ! partition_node "$VICTIM"; then
  return 0 2>/dev/null || exit 0
fi

# Wait membership / health to drop victim (best-effort)
sleep 1
want_alive=2
wait_cluster_healthy 2 20 || true
# membership may still list frozen node as alive until probes fail — give probes time
sleep 2
if [ "${CLARKQ_CLUSTER_MODE:-local}" = "local" ]; then
  # SIGSTOP: probes hang until fail threshold — wait a bit more
  sleep 2
fi

# Traffic only to non-victim healthy nodes during isolation
iso_ok=0
iso_try=0
iso_deadline=$(( $(date +%s) + SECS_ISO ))
while [ "$(date +%s)" -lt "$iso_deadline" ]; do
  iso_try=$((iso_try + 1))
  # never use victim URL
  base=""
  for n in $(healthy_nodes); do
    if [ "$n" != "$VICTIM" ]; then
      base=$n
      break
    fi
  done
  if [ -z "$base" ]; then
    # all health checks may still pass for frozen process until TCP timeout —
    # fall back to non-victim URLs from CLARKQ_NODES
    for n in $CLARKQ_NODES; do
      if [ "$n" != "$VICTIM" ]; then
        base=$n
        break
      fi
    done
  fi
  if retry_enqueue "$base" "$Q" "{\"body\":\"iso-${iso_try}\"}" 6; then
    iso_ok=$((iso_ok + 1))
  fi
  # occasional consume
  if [ $((iso_try % 2)) -eq 0 ]; then
    retry_consume "$base" "$Q" 4 || true
  fi
  sleep 0.35
done

if [ "$iso_ok" -ge 3 ]; then
  ok "during isolation: ${iso_ok} enqueues on survivors (tries≈${iso_try})"
else
  bad "during isolation: only ${iso_ok} successful enqueues (tries=${iso_try})"
fi

# Heal
if ! heal_node; then
  bad "heal failed — cluster may need manual recovery"
  return 0 2>/dev/null || exit 0
fi

wait_cluster_healthy 3 40 || {
  bad "cluster did not return to 3 healthy after heal"
  return 0 2>/dev/null || exit 0
}
# allow membership + leases to settle
sleep 2

# Post-heal traffic
post=0
i=0
while [ "$i" -lt 8 ]; do
  i=$((i + 1))
  base=$(first_healthy) || base="$CLARKQ_URL"
  if retry_enqueue "$base" "$Q" "{\"body\":\"post-${i}\"}" 12; then
    post=$((post + 1))
  fi
done
if [ "$post" -ge 6 ]; then
  ok "post-heal enqueues ${post}/8"
else
  bad "post-heal enqueues only ${post}/8 (last HTTP $CODE body=$BODY)"
fi

# Drain remaining
drained=0
empty_streak=0
deadline=$(( $(date +%s) + 40 ))
while [ "$(date +%s)" -lt "$deadline" ] && [ "$empty_streak" -lt 4 ]; do
  base=$(first_healthy) || base="$CLARKQ_URL"
  if retry_consume "$base" "$Q" 5; then
    if [ "$CODE" = "200" ]; then
      drained=$((drained + 1))
      empty_streak=0
    elif [ "$CODE" = "204" ] || [ "$CODE" = "404" ]; then
      empty_streak=$((empty_streak + 1))
      sleep 0.2
    else
      sleep 0.2
    fi
  else
    sleep 0.25
  fi
done

# We wrote pre + iso + post, consumed some mid-isolation; just require meaningful drain
if [ "$drained" -ge 5 ]; then
  ok "post-partition drain recovered ${drained} messages"
else
  bad "post-partition drain only ${drained} messages"
fi

# Cluster status should show 3 alive eventually
req GET /api/v1/cluster
expect_code 200 "cluster status after partition recovery"
if printf '%s' "$BODY" | grep -q '"enabled":true'; then
  ok "cluster still enabled after partition recovery"
else
  bad "cluster not enabled after recovery"
fi
