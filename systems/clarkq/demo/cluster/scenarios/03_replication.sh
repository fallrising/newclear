#!/bin/sh
# Scenario: RF≥2 sync replication — message id appears on ≥2 nodes via internal API
# Sourced by run-scenarios.sh

section "03 · Replication (RF copies + internal IDs)"

Q="repl-demo"
entry=$(first_healthy)
CLARKQ_URL="$entry"
export CLARKQ_URL

req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true

req POST "/api/v1/queue/${Q}" \
  -H "Content-Type: application/json" \
  -d '{"body":"replicated-payload","metadata":{"demo":"repl"}}'
expect_code 201 "enqueue for replication"
body_contains '"id"' "enqueue returns id"

# Extract id with sed (no jq dependency)
MSG_ID=$(printf '%s' "$BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
if [ -z "$MSG_ID" ]; then
  MSG_ID=$(printf '%s' "$BODY" | sed -n 's/.*"id": "\([^"]*\)".*/\1/p')
fi
if [ -n "$MSG_ID" ]; then
  ok "parsed message id ${MSG_ID}"
else
  bad "could not parse message id from: $BODY"
  MSG_ID="__missing__"
fi

# Poll internal IDs on all nodes — need at least RF (default 2) holders
RF="${CLARKQ_REPLICATION_FACTOR:-2}"
dim "  waiting for message on ≥${RF} nodes (internal /ids) ..."
holders=0
tries=0
while [ "$tries" -lt 20 ]; do
  holders=0
  for base in $CLARKQ_NODES; do
    req_internal "$base" GET "/api/v1/internal/queue/${Q}/ids"
    if [ "$CODE" = "200" ]; then
      case "$BODY" in
        *"$MSG_ID"*) holders=$((holders + 1)) ;;
      esac
    fi
  done
  if [ "$holders" -ge "$RF" ]; then
    break
  fi
  tries=$((tries + 1))
  sleep 0.5
done

if [ "$holders" -ge "$RF" ]; then
  ok "message present on ${holders} nodes (RF=${RF})"
else
  bad "message only on ${holders} nodes, need ≥${RF} (id=${MSG_ID})"
  for base in $CLARKQ_NODES; do
    req_internal "$base" GET "/api/v1/internal/queue/${Q}/ids"
    dim "  ${base} ids HTTP=${CODE} body=${BODY}"
  done
fi

# Consume once; replica delete should follow
req GET "/api/v1/queue/${Q}"
expect_code 200 "consume replicated message"
body_contains 'replicated-payload' "body matches"

# After consume, id should disappear from most nodes (best-effort; allow short lag)
tries=0
while [ "$tries" -lt 15 ]; do
  left=0
  for base in $CLARKQ_NODES; do
    req_internal "$base" GET "/api/v1/internal/queue/${Q}/ids"
    if [ "$CODE" = "200" ]; then
      case "$BODY" in
        *"$MSG_ID"*) left=$((left + 1)) ;;
      esac
    fi
  done
  if [ "$left" -eq 0 ]; then
    break
  fi
  tries=$((tries + 1))
  sleep 0.5
done
if [ "${left:-0}" -eq 0 ]; then
  ok "message id removed from all nodes after consume"
else
  # soft: still report but not hard-fail if outbox lag — mark bad for visibility
  bad "message id still on ${left} nodes after consume (may indicate replica delete lag)"
fi
