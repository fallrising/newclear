#!/bin/sh
# Scenario: consistent-hash ownership + reverse-proxy from any node
# Sourced by run-scenarios.sh

section "02 · Shard forward (any node → owner)"

Q="shard-fwd-demo"

# Clear via first healthy (forwards if needed)
entry=$(first_healthy)
CLARKQ_URL="$entry"
export CLARKQ_URL
req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true

# Enqueue the same logical queue via EVERY node (non-owners must proxy)
i=0
for base in $CLARKQ_NODES; do
  i=$((i + 1))
  req_node "$base" POST "/api/v1/queue/${Q}" \
    -H "Content-Type: application/json" \
    -d "{\"body\":\"via-node-${i}\",\"metadata\":{\"from\":\"${base}\"}}"
  expect_code 201 "enqueue via ${base} (forward if not owner)"
done

# List from each node should see the queue (aggregated primary depths)
for base in $CLARKQ_NODES; do
  req_node "$base" GET /api/v1/queues
  expect_code 200 "list queues via ${base}"
  body_contains "$Q" "queue ${Q} visible via ${base}"
done

# Peek head should be first enqueued message (FIFO on owner)
req GET "/api/v1/queue/${Q}?peek=true"
expect_code 200 "peek head"
body_contains 'via-node-1' "FIFO head is first enqueue"

# Drain all
drained=0
while [ "$drained" -lt 10 ]; do
  req GET "/api/v1/queue/${Q}"
  if [ "$CODE" = "204" ]; then
    break
  fi
  if [ "$CODE" = "200" ]; then
    drained=$((drained + 1))
  else
    bad "unexpected dequeue HTTP $CODE body=$BODY"
    break
  fi
done
if [ "$drained" -eq "$i" ]; then
  ok "drained ${drained} messages (one per node enqueue)"
else
  bad "drained ${drained}, expected ${i}"
fi

req GET "/api/v1/queue/${Q}"
expect_code 204 "empty after drain"
