#!/bin/sh
# Scenario: health, version, admin UI (public pages)
# Sourced by run-scenarios.sh (lib.sh already loaded).

section "01 · Health, version & Admin UI"

req_noauth GET /health
expect_code 200 "GET /health without API key"
body_contains '"status":"ok"' "health status ok"
body_contains version "health includes version field"

req_noauth GET /version
expect_code 200 "GET /version"
body_contains version "version payload"

req_noauth GET /ui/
expect_code 200 "GET /ui/ admin console HTML"
body_contains "clarkQ" "UI title present"

req GET /api/v1/queues
expect_code 200 "API accepts API key"
