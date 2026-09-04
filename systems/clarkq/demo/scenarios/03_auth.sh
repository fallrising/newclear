#!/bin/sh
# Scenario: API key authentication
# Sourced by run-scenarios.sh (lib.sh already loaded).

section "03 · API key authentication"

# Without key
url="${CLARKQ_URL}/api/v1/queues"
CODE=$(curl -sS -o /tmp/clarkq_demo_body -w '%{http_code}' "$url" 2>/dev/null || echo 000)
BODY=$(cat /tmp/clarkq_demo_body 2>/dev/null || true)
expect_code 401 "request without API key is rejected"
body_contains UNAUTHORIZED "error code UNAUTHORIZED"

# Wrong key
CODE=$(curl -sS -o /tmp/clarkq_demo_body -w '%{http_code}' \
  -H "X-API-Key: wrong-key" "$url" 2>/dev/null || echo 000)
BODY=$(cat /tmp/clarkq_demo_body 2>/dev/null || true)
expect_code 401 "wrong API key is rejected"

# Bearer form
CODE=$(curl -sS -o /tmp/clarkq_demo_body -w '%{http_code}' \
  -H "Authorization: Bearer ${CLARKQ_API_KEY}" "$url" 2>/dev/null || echo 000)
BODY=$(cat /tmp/clarkq_demo_body 2>/dev/null || true)
expect_code 200 "Authorization: Bearer works"

# Health stays public
req_noauth GET /health
expect_code 200 "GET /health stays public under auth"
