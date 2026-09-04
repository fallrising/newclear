#!/bin/sh
# Scenario: classic async job queue (producer + worker)
# Sourced by run-scenarios.sh (lib.sh already loaded).

section "02 · Task queue (producer → worker FIFO)"

Q="demo-jobs"

# clear if exists
req DELETE "/api/v1/queue/${Q}" >/dev/null 2>&1 || true
req DELETE "/api/v1/queue/${Q}"
# 404 or 200 both fine
if [ "$CODE" = "200" ] || [ "$CODE" = "404" ]; then
  ok "prepare queue ${Q}"
else
  bad "prepare clear (HTTP $CODE)"
fi

req POST "/api/v1/queue/${Q}" \
  -H "Content-Type: application/json" \
  -d '{"body":"{\"task\":\"send_email\",\"to\":\"a@example.com\"}","metadata":{"priority":"normal"}}'
expect_code 201 "producer enqueue job 1"
body_contains '"queue":"demo-jobs"' "enqueue names queue"

req POST "/api/v1/queue/${Q}" \
  -H "Content-Type: application/json" \
  -d '{"body":"{\"task\":\"resize\",\"id\":42}"}'
expect_code 201 "producer enqueue job 2"

req GET /api/v1/queues
expect_code 200 "list queues"
body_contains "demo-jobs" "queue appears in list"

req GET "/api/v1/queue/${Q}?peek=true"
expect_code 200 "worker peek (non-destructive)"
body_contains send_email "FIFO head is first job"

req GET "/api/v1/queue/${Q}"
expect_code 200 "worker consume job 1"
body_contains send_email "consumed first job"

req GET "/api/v1/queue/${Q}"
expect_code 200 "worker consume job 2"
body_contains resize "consumed second job"

req GET "/api/v1/queue/${Q}"
expect_code 204 "empty queue returns 204"

req GET /api/v1/metrics
expect_code 200 "metrics JSON"
body_contains enqueued_total "metrics counters present"
