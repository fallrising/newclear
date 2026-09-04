#!/bin/sh
# Shared helpers for demo scenarios (POSIX sh + curl).
# Safe to source multiple times: counters are only initialized once.

: "${CLARKQ_URL:=http://127.0.0.1:8080}"
: "${CLARKQ_API_KEY:=dev-key}"

if [ -z "${CLARKQ_DEMO_LIB_LOADED:-}" ]; then
  PASS=0
  FAIL=0
  SKIP=0
  CLARKQ_DEMO_LIB_LOADED=1
fi

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

section() {
  echo
  cyan "════════════════════════════════════════"
  cyan "  $*"
  cyan "════════════════════════════════════════"
}

ok() {
  PASS=$((PASS + 1))
  green "  ✓ $*"
}

bad() {
  FAIL=$((FAIL + 1))
  red "  ✗ $*"
}

skip() {
  SKIP=$((SKIP + 1))
  dim "  · $*"
}

# HTTP helpers: set BODY and CODE
req() {
  method=$1
  path=$2
  shift 2
  # remaining: optional curl args, last may be -d data handled by caller
  url="${CLARKQ_URL}${path}"
  CODE=$(curl -sS -o /tmp/clarkq_demo_body -w '%{http_code}' \
    -X "$method" "$url" \
    -H "X-API-Key: ${CLARKQ_API_KEY}" \
    "$@" 2>/tmp/clarkq_demo_err) || true
  if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then
    CODE=000
    BODY=$(cat /tmp/clarkq_demo_err 2>/dev/null || echo "curl failed")
  else
    BODY=$(cat /tmp/clarkq_demo_body 2>/dev/null || true)
  fi
}

req_noauth() {
  method=$1
  path=$2
  shift 2
  url="${CLARKQ_URL}${path}"
  CODE=$(curl -sS -o /tmp/clarkq_demo_body -w '%{http_code}' \
    -X "$method" "$url" "$@" 2>/tmp/clarkq_demo_err) || true
  if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then
    CODE=000
    BODY=$(cat /tmp/clarkq_demo_err 2>/dev/null || echo "curl failed")
  else
    BODY=$(cat /tmp/clarkq_demo_body 2>/dev/null || true)
  fi
}

req_tenant() {
  method=$1
  path=$2
  tenant=$3
  shift 3
  url="${CLARKQ_URL}${path}"
  CODE=$(curl -sS -o /tmp/clarkq_demo_body -w '%{http_code}' \
    -X "$method" "$url" \
    -H "X-API-Key: ${CLARKQ_API_KEY}" \
    -H "X-Tenant-ID: ${tenant}" \
    "$@" 2>/tmp/clarkq_demo_err) || true
  if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then
    CODE=000
    BODY=$(cat /tmp/clarkq_demo_err 2>/dev/null || echo "curl failed")
  else
    BODY=$(cat /tmp/clarkq_demo_body 2>/dev/null || true)
  fi
}

expect_code() {
  want=$1
  desc=$2
  if [ "$CODE" = "$want" ]; then
    ok "$desc (HTTP $CODE)"
  else
    bad "$desc (want HTTP $want, got $CODE) body=${BODY}"
  fi
}

body_contains() {
  needle=$1
  desc=$2
  case "$BODY" in
    *"$needle"*) ok "$desc" ;;
    *) bad "$desc (missing '$needle' in: $BODY)" ;;
  esac
}

summary() {
  echo
  cyan "──────── demo summary ────────"
  green "  passed: $PASS"
  if [ "$FAIL" -gt 0 ]; then
    red "  failed: $FAIL"
  else
    echo "  failed: 0"
  fi
  if [ "$SKIP" -gt 0 ]; then
    dim "  skipped: $SKIP"
  fi
  echo
  if [ "$FAIL" -gt 0 ]; then
    red "Some checks failed. See above."
    return 1
  fi
  green "All demo scenarios passed."
  echo
  cyan "Try the UI:  ${CLARKQ_URL%/}/ui/"
  dim  "API key:     ${CLARKQ_API_KEY}"
  return 0
}

wait_healthy() {
  i=0
  max=${1:-60}
  dim "Waiting for ${CLARKQ_URL}/health ..."
  while [ "$i" -lt "$max" ]; do
    req_noauth GET /health
    if [ "$CODE" = "200" ]; then
      ok "server healthy"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  bad "server not healthy after ${max}s (last HTTP $CODE)"
  return 1
}
