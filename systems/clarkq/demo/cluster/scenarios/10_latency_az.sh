#!/bin/sh
# Scenario: multi-AZ-ish high latency via netem (Docker + NET_ADMIN) or soft skip.
# Env:
#   CLARKQ_NETEM_DELAY   default 80ms
#   CLARKQ_NETEM_JITTER  default 40ms
# Sourced by run-stress.sh

section "10 · High-latency (multi-AZ simulation)"

Q="latency-az"
DELAY="${CLARKQ_NETEM_DELAY:-80ms}"
JITTER="${CLARKQ_NETEM_JITTER:-40ms}"

if [ "${CLARKQ_CLUSTER_MODE:-local}" != "docker" ]; then
  skip "latency AZ sim needs Docker + tc/netem (mode=${CLARKQ_CLUSTER_MODE:-local})"
  return 0 2>/dev/null || exit 0
fi

entry=$(first_healthy) || {
  bad "no healthy node"
  return 0 2>/dev/null || exit 0
}
CLARKQ_URL="$entry"
export CLARKQ_URL

# Prefer delaying a non-entry peer to simulate remote AZ
TARGET_SVC=""
for base in $CLARKQ_NODES; do
  if [ "$base" != "$entry" ]; then
    TARGET_SVC=$(svc_from_url "$base") && break
  fi
done
if [ -z "$TARGET_SVC" ]; then
  TARGET_SVC=clarkq-2
fi

dim "  applying netem delay=${DELAY} jitter=${JITTER} on ${TARGET_SVC}"

# Ensure container has NET_ADMIN-capable path; try install/use tc
cid=$(container_for_svc "$TARGET_SVC")
if [ -z "$cid" ]; then
  skip "no container for $TARGET_SVC"
  return 0 2>/dev/null || exit 0
fi

# alpine image may lack iproute2/tc — try install (needs network in container) or skip
if ! docker exec "$cid" sh -c "command -v tc" >/dev/null 2>&1; then
  dim "  tc missing in container; trying apk add iproute2 ..."
  if docker exec -u 0 "$cid" sh -c "apk add --no-cache iproute2 >/dev/null 2>&1"; then
    ok "installed iproute2 in $TARGET_SVC for netem"
  else
    skip "cannot install tc/iproute2 in $TARGET_SVC (no NET_ADMIN/apk); skip latency AZ"
    return 0 2>/dev/null || exit 0
  fi
fi

if ! apply_netem_delay "$TARGET_SVC" "$DELAY" "$JITTER"; then
  # ip may also be missing (busybox); try installing iproute2 already done above
  skip "netem apply failed. log: $(tr '\n' ' ' </tmp/clarkq_netem.log 2>/dev/null | tail -c 200)"
  return 0 2>/dev/null || exit 0
fi
ok "netem delay active on $TARGET_SVC (${DELAY} ± ${JITTER}) [$(tr '\n' ' ' </tmp/clarkq_netem.log 2>/dev/null | tail -c 120)]"

req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true

# Cross-node traffic for a few seconds under elevated RTT
n=0
okn=0
mid_deq=0
deadline=$(( $(date +%s) + 12 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  n=$((n + 1))
  # round-robin all nodes including delayed one
  idx=$(( (n - 1) % 3 ))
  i=0
  base=""
  for b in $CLARKQ_NODES; do
    if [ "$i" -eq "$idx" ]; then
      base=$b
      break
    fi
    i=$((i + 1))
  done
  [ -n "$base" ] || base="$entry"
  if retry_enqueue "$base" "$Q" "{\"body\":\"az-${n}\"}" 10; then
    okn=$((okn + 1))
  fi
  if [ $((n % 2)) -eq 0 ]; then
    if retry_consume "$entry" "$Q" 6; then
      if [ "$CODE" = "200" ]; then
        mid_deq=$((mid_deq + 1))
      fi
    fi
  fi
  sleep 0.2
done

if [ "$okn" -ge $((n * 7 / 10)) ] && [ "$okn" -ge 5 ]; then
  ok "high-latency enqueues ${okn}/${n} (≥70%)"
else
  bad "high-latency enqueues only ${okn}/${n}"
fi

# Drain remainder (mid-loop already consumed some)
drained=0
empty=0
deadline=$(( $(date +%s) + 40 ))
while [ "$(date +%s)" -lt "$deadline" ] && [ "$empty" -lt 4 ]; do
  base=$(first_healthy 2>/dev/null || echo "$entry")
  if retry_consume "$base" "$Q" 6; then
    if [ "$CODE" = "200" ]; then
      drained=$((drained + 1))
      empty=0
    elif [ "$CODE" = "204" ] || [ "$CODE" = "404" ]; then
      empty=$((empty + 1))
      sleep 0.15
    else
      sleep 0.15
    fi
  else
    sleep 0.25
  fi
done
total_deq=$((mid_deq + drained))
need=$((okn * 8 / 10))
if [ "$total_deq" -ge "$need" ]; then
  ok "high-latency drain total ${total_deq}/${okn} (mid=${mid_deq} final=${drained})"
else
  bad "high-latency drain total ${total_deq}/${okn} (mid=${mid_deq} final=${drained}, need≥${need})"
fi

clear_netem "$TARGET_SVC"
ok "cleared netem on $TARGET_SVC"
