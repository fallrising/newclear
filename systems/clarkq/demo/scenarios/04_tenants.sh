#!/bin/sh
# Scenario: multi-tenant quotas (server demo stack enables quotas)
# Sourced by run-scenarios.sh (lib.sh already loaded).

section "04 · Multi-tenant quotas"

# Tenant acme: two queues max in demo compose
req_tenant POST "/api/v1/queue/acme-jobs" acme \
  -H "Content-Type: application/json" \
  -d '{"body":"job-a"}'
expect_code 201 "tenant acme creates queue acme-jobs"

req_tenant POST "/api/v1/queue/acme-mail" acme \
  -H "Content-Type: application/json" \
  -d '{"body":"mail-a"}'
expect_code 201 "tenant acme creates second queue acme-mail"

req_tenant POST "/api/v1/queue/acme-extra" acme \
  -H "Content-Type: application/json" \
  -d '{"body":"should-fail"}'
expect_code 429 "third queue hits TENANT_QUOTA (max 2)"

# Cross-tenant bind: beta cannot write acme-jobs
req_tenant POST "/api/v1/queue/acme-jobs" beta \
  -H "Content-Type: application/json" \
  -d '{"body":"steal"}'
expect_code 403 "tenant beta cannot write acme-bound queue"

# beta can use own queue
req_tenant POST "/api/v1/queue/beta-jobs" beta \
  -H "Content-Type: application/json" \
  -d '{"body":"beta-ok"}'
expect_code 201 "tenant beta owns beta-jobs"
