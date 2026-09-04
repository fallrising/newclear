#!/bin/sh
# Scenario: timed soak under linearizable + lease (producers + consumers).
# Env:
#   CLARKQ_STRESS_SECS   duration seconds (default 20)
#   CLARKQ_STRESS_PRODS  concurrent producers (default 4)
#   CLARKQ_STRESS_CONS   concurrent consumer loops (default 2)
#   CLARKQ_STRESS_RATE   max enqueues per producer per second (default 8)
# Sourced by run-stress.sh (or run-scenarios when CLARKQ_RUN_STRESS=1)

section "08 · Soak stress (linearizable + lease)"

SECS="${CLARKQ_STRESS_SECS:-20}"
PRODS="${CLARKQ_STRESS_PRODS:-4}"
CONS="${CLARKQ_STRESS_CONS:-2}"
RATE="${CLARKQ_STRESS_RATE:-8}"
Q="soak-stress"

# Require advanced flags (status or env)
req GET /api/v1/cluster
if [ "$CODE" != "200" ]; then
  bad "cluster status unavailable"
  return 0 2>/dev/null || exit 0
fi
lin_on=0
lease_on=0
case "${CLARKQ_LINEARIZABLE_CONSUME:-false}" in 1|true|TRUE|yes|YES|on|ON) lin_on=1 ;; esac
case "${CLARKQ_LEASE_ENABLED:-false}" in 1|true|TRUE|yes|YES|on|ON) lease_on=1 ;; esac
printf '%s' "$BODY" | grep -q '"linearizable_consume":true' && lin_on=1
printf '%s' "$BODY" | grep -q '"leases_enabled":true' && lease_on=1
if [ "$lin_on" -eq 0 ] || [ "$lease_on" -eq 0 ]; then
  skip "need CLARKQ_LINEARIZABLE_CONSUME=true and CLARKQ_LEASE_ENABLED=true (lin=${lin_on} lease=${lease_on})"
  return 0 2>/dev/null || exit 0
fi

entry=$(first_healthy) || entry="$CLARKQ_URL"
CLARKQ_URL="$entry"
export CLARKQ_URL

req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true
sleep 0.2

HEALTHY=$(healthy_nodes)
if [ -z "$HEALTHY" ]; then
  bad "no healthy nodes for soak"
  return 0 2>/dev/null || exit 0
fi

tmpdir=$(mktemp -d)
echo 0 >"$tmpdir/enq"
echo 0 >"$tmpdir/deq"
echo 0 >"$tmpdir/enq_fail"
echo 0 >"$tmpdir/deq_err"
: >"$tmpdir/lock"

# portable increment (file-based, best-effort under concurrent writers)
bump() {
  f=$1
  # shellcheck disable=SC2039
  (
    # flock if available
    if command -v flock >/dev/null 2>&1; then
      flock "$tmpdir/lock" sh -c "n=\$(cat '$f'); echo \$((n+1)) >'$f'"
    else
      n=$(cat "$f")
      echo $((n + 1)) >"$f"
    fi
  ) 2>/dev/null || true
}

dim "  soak ${SECS}s  producers=${PRODS} consumers=${CONS} rate≈${RATE}/s/prod  queue=${Q}"
dim "  healthy: ${HEALTHY}"

# shellcheck disable=SC2086
set -- $HEALTHY
nodec=$#
start_ts=$(date +%s)
deadline=$(( start_ts + SECS ))

# Progress ticker for long soaks (every 30s or once near end)
(
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 30
    now=$(date +%s)
    if [ "$now" -ge "$deadline" ]; then
      break
    fi
    e=$(cat "$tmpdir/enq" 2>/dev/null || echo 0)
    d=$(cat "$tmpdir/deq" 2>/dev/null || echo 0)
    left=$((deadline - now))
    dim "  … soak progress enq=${e} deq=${d} remaining≈${left}s"
  done
) &
TICK_PID=$!

# Producers
p=1
PROD_PIDS=""
while [ "$p" -le "$PRODS" ]; do
  (
    i=0
    while [ "$(date +%s)" -lt "$deadline" ]; do
      i=$((i + 1))
      idx=$(( (i + p) % nodec + 1 ))
      eval "base=\${$idx}"
      # re-pick healthy if base died mid-soak
      if ! is_clarkq_health "$base" 2>/dev/null; then
        base=$(first_healthy 2>/dev/null || echo "$base")
      fi
      body="{\"body\":\"soak-p${p}-${i}-$(date +%s%N)\"}"
      if retry_enqueue "$base" "$Q" "$body" 8; then
        bump "$tmpdir/enq"
      else
        bump "$tmpdir/enq_fail"
      fi
      # crude rate limit
      sleep "$(awk "BEGIN{print 1/${RATE}}")" 2>/dev/null || sleep 0.12
    done
  ) &
  PROD_PIDS="$PROD_PIDS $!"
  p=$((p + 1))
done

# Consumers
c=1
CONS_PIDS=""
while [ "$c" -le "$CONS" ]; do
  (
    while [ "$(date +%s)" -lt "$((deadline + 2))" ]; do
      base=$(first_healthy 2>/dev/null || echo "$CLARKQ_URL")
      if retry_consume "$base" "$Q" 6; then
        if [ "$CODE" = "200" ]; then
          bump "$tmpdir/deq"
        elif [ "$CODE" = "204" ] || [ "$CODE" = "404" ]; then
          sleep 0.05
        else
          bump "$tmpdir/deq_err"
          sleep 0.1
        fi
      else
        bump "$tmpdir/deq_err"
        sleep 0.15
      fi
    done
  ) &
  CONS_PIDS="$CONS_PIDS $!"
  c=$((c + 1))
done

# Wait producers first, then drain remaining with consumers still running a bit
for pid in $PROD_PIDS; do
  wait "$pid" 2>/dev/null || true
done
kill "$TICK_PID" 2>/dev/null || true
wait "$TICK_PID" 2>/dev/null || true

# Extra drain window
drain_deadline=$(( $(date +%s) + 25 ))
while [ "$(date +%s)" -lt "$drain_deadline" ]; do
  base=$(first_healthy 2>/dev/null || echo "$CLARKQ_URL")
  if retry_consume "$base" "$Q" 4; then
    if [ "$CODE" = "200" ]; then
      bump "$tmpdir/deq"
      continue
    fi
    if [ "$CODE" = "204" ]; then
      # check depth via list
      req_node "$base" GET /api/v1/queues
      if printf '%s' "$BODY" | grep -q "\"name\":\"${Q}\""; then
        depth=$(printf '%s' "$BODY" | sed -n "s/.*\"name\":\"${Q}\"[^}]*\"depth\":\([0-9]*\).*/\1/p" | head -1)
        if [ "${depth:-1}" = "0" ] || [ -z "$depth" ]; then
          # empty or gone
          empty_ok=1
          # double-check consume
          sleep 0.3
          retry_consume "$base" "$Q" 2
          if [ "$CODE" = "204" ] || [ "$CODE" = "404" ]; then
            break
          fi
        fi
      else
        break
      fi
      sleep 0.15
      continue
    fi
  fi
  sleep 0.1
done

for pid in $CONS_PIDS; do
  wait "$pid" 2>/dev/null || true
done

enq=$(cat "$tmpdir/enq" 2>/dev/null || echo 0)
deq=$(cat "$tmpdir/deq" 2>/dev/null || echo 0)
efail=$(cat "$tmpdir/enq_fail" 2>/dev/null || echo 0)
derr=$(cat "$tmpdir/deq_err" 2>/dev/null || echo 0)
rm -rf "$tmpdir"

dim "  totals: enqueued=${enq} dequeued=${deq} enq_fail=${efail} deq_err=${derr}"

if [ "$enq" -lt 10 ]; then
  bad "too few successful enqueues during soak (${enq}); cluster may be unhealthy"
else
  ok "soak produced ${enq} messages in ${SECS}s (fails=${efail})"
fi

# Concurrent file counters can drift ± a few under race without flock; require ≥90%
# and tolerate tiny overcount (deq ≈ enq).
need=$((enq * 9 / 10))
if [ "$enq" -eq 0 ]; then
  need=0
fi
if [ "$enq" -gt 0 ] && [ "$deq" -ge "$need" ]; then
  # flag pathological overcount (likely double-consume bug) if deq >> enq
  max_deq=$((enq + enq / 20 + 5))
  if [ "$deq" -gt "$max_deq" ]; then
    bad "soak drain ${deq}/${enq} overshoots too far (possible double-consume)"
  else
    ok "soak drained ${deq}/${enq} (≥90%)"
  fi
else
  bad "soak drain ${deq}/${enq} (need ≥${need})"
fi

# Permanent error rate should stay modest (retries absorb 409/503)
if [ "$enq" -gt 0 ]; then
  # enq_fail is after retries exhausted — should be rare
  maxfail=$((enq / 5 + 2))
  if [ "$efail" -le "$maxfail" ]; then
    ok "enqueue hard-failures ${efail} within budget (≤${maxfail})"
  else
    bad "too many enqueue hard-failures ${efail} (budget ≤${maxfail})"
  fi
fi
