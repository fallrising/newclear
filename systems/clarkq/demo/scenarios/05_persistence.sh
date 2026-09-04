#!/bin/sh
# Scenario: WAL/snapshot survive container restart
# Sourced by run-scenarios.sh (lib.sh already loaded).
# Requires: docker compose service name "clarkq" and CLARKQ_DEMO_COMPOSE/PROJECT.
# When CLARKQ_DEMO_SKIP_RESTART=1, skip (e.g. pure remote URL without compose).

section "05 · Persistence across restart (WAL + snapshot)"

if [ "${CLARKQ_DEMO_SKIP_RESTART:-}" = "1" ]; then
  skip "restart scenario skipped (CLARKQ_DEMO_SKIP_RESTART=1)"
  return 0 2>/dev/null || exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  skip "docker not available on runner; skip restart test"
  return 0 2>/dev/null || exit 0
fi

Q="persist-demo"
req POST "/api/v1/queue/${Q}" \
  -H "Content-Type: application/json" \
  -d '{"body":"survive-reboot","metadata":{"demo":"persist"}}'
expect_code 201 "enqueue message before restart"
# Enqueue response is {id,queue,created_at} — body is not echoed.
body_contains '"id"' "got message id"
body_contains '"queue":"persist-demo"' "enqueue names persist queue"

COMPOSE_FILE="${CLARKQ_DEMO_COMPOSE:-${CLARKQ_DEMO_DIR:-.}/docker-compose.yml}"
PROJECT="${CLARKQ_DEMO_PROJECT:-clarkqdemo}"

dim "  restarting clarkq container (compose project=${PROJECT}) ..."
if docker compose -f "$COMPOSE_FILE" -p "$PROJECT" restart clarkq >/tmp/clarkq_restart.log 2>&1; then
  ok "docker compose restart clarkq"
else
  bad "docker compose restart failed (see /tmp/clarkq_restart.log)"
  return 0 2>/dev/null || exit 0
fi

# wait healthy again
i=0
while [ "$i" -lt 45 ]; do
  req_noauth GET /health
  if [ "$CODE" = "200" ]; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
expect_code 200 "server healthy after restart"

req GET "/api/v1/queue/${Q}"
expect_code 200 "dequeue after restart"
body_contains survive-reboot "message survived restart (WAL/snapshot)"
