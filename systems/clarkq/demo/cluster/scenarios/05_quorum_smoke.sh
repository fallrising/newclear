#!/bin/sh
# Scenario: write-path works under RF=2 sync (implicit write quorum majority)
# Sourced by run-scenarios.sh

section "05 · Quorum smoke (sync RF write path)"

Q="quorum-demo"
entry=$(first_healthy)
if [ -z "${entry:-}" ]; then
  bad "no healthy node for quorum smoke"
  return 0 2>/dev/null || exit 0
fi
CLARKQ_URL="$entry"
export CLARKQ_URL

# Purge any leftovers (clear + drain) so counts stay exact
req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true
purge=0
while [ "$purge" -lt 20 ]; do
  req GET "/api/v1/queue/${Q}"
  if [ "$CODE" = "204" ] || [ "$CODE" = "404" ]; then
    break
  fi
  if [ "$CODE" != "200" ]; then
    sleep 0.3
  fi
  purge=$((purge + 1))
done

# Several sequential enqueues should all get 201 under healthy RF=2 cluster
n=0
okn=0
while [ "$n" -lt 5 ]; do
  n=$((n + 1))
  req POST "/api/v1/queue/${Q}" \
    -H "Content-Type: application/json" \
    -d "{\"body\":\"qmsg-${n}\"}"
  if [ "$CODE" = "201" ]; then
    okn=$((okn + 1))
  elif [ "$CODE" = "503" ] || [ "$CODE" = "409" ]; then
    # transient grace / membership lag — retry a few times
    r=0
    while [ "$r" -lt 5 ]; do
      sleep 0.5
      req POST "/api/v1/queue/${Q}" \
        -H "Content-Type: application/json" \
        -d "{\"body\":\"qmsg-${n}\"}"
      if [ "$CODE" = "201" ]; then
        okn=$((okn + 1))
        break
      fi
      r=$((r + 1))
    done
  fi
done
if [ "$okn" -eq 5 ]; then
  ok "5/5 enqueues succeeded under sync RF (write quorum path)"
else
  bad "only ${okn}/5 enqueues succeeded (last HTTP $CODE body=$BODY)"
fi

# Cluster status should report write_quorum
req GET /api/v1/cluster
expect_code 200 "cluster status for quorum fields"
body_contains 'write_quorum' "write_quorum exposed"

# Drain exactly what we wrote (allow a little lag, require ≥5 and no hard cap fail if +catch-up ghosts)
drained=0
empty_streak=0
while [ "$drained" -lt 20 ] && [ "$empty_streak" -lt 3 ]; do
  req GET "/api/v1/queue/${Q}"
  if [ "$CODE" = "200" ]; then
    drained=$((drained + 1))
    empty_streak=0
  elif [ "$CODE" = "204" ]; then
    empty_streak=$((empty_streak + 1))
    sleep 0.2
  else
    sleep 0.3
  fi
done
if [ "$drained" -ge 5 ]; then
  ok "drained ${drained} quorum-written messages (≥5)"
else
  bad "drained only ${drained}/5 messages"
fi
