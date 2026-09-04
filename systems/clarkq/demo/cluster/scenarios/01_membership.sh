#!/bin/sh
# Scenario: membership / health / cluster status
# Sourced by run-scenarios.sh

section "01 · Membership & cluster status"

for base in $CLARKQ_NODES; do
  if is_clarkq_health "$base"; then
    ok "clarkQ health ${base}"
  else
    bad "not clarkQ health on ${base} (wrong process or down?)"
    continue
  fi
  BODY=$(curl -sS --connect-timeout 2 --max-time 5 "${base}/health" 2>/dev/null || true)
  case "$BODY" in
    *alive*) ok "health embeds cluster alive on ${base}" ;;
    *) bad "health missing alive on ${base}: $BODY" ;;
  esac
done

# Pick first healthy as CLARKQ_URL
entry=$(first_healthy) || entry="$CLARKQ_URL"
CLARKQ_URL="$entry"
export CLARKQ_URL

req GET /api/v1/cluster
expect_code 200 "GET /api/v1/cluster"
body_contains '"enabled":true' "cluster enabled"
body_contains 'configured_nodes' "configured_nodes present"
body_contains 'alive_nodes' "alive_nodes present"
body_contains 'replication_factor' "replication_factor present"
body_contains 'generation' "generation present"

# Expect 3 configured nodes in JSON
count=0
for _ in $CLARKQ_NODES; do
  count=$((count + 1))
done
# Count http occurrences in configured_nodes roughly
cfg_hits=$(printf '%s' "$BODY" | tr ',' '\n' | grep -c 'http' || true)
if [ "${cfg_hits:-0}" -ge "$count" ]; then
  ok "configured node URLs visible (≥${count} http refs)"
else
  bad "expected ≥${count} node URL refs in cluster status, got ${cfg_hits:-0}"
fi
