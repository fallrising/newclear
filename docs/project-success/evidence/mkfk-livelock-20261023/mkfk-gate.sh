#!/usr/bin/env bash
# mkfk mainline gate on one commit; logs in $2.
set -uo pipefail
cd "$1"; L="$2"; W="$3"
echo "source $(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l)"
step() { local n="$1"; shift; echo "== $n $(date -u +%FT%TZ)"; if "$@" >"$L/$n.log" 2>&1; then echo "PASS $n"; else echo "FAIL $n (exit $?)"; fi; }
step fmt-vet-test make fmt-check vet test
step race make test-race
step model make test-model
step integration make test-integration
step chaos-short make test-chaos CHAOS_PROFILE=short
cp .test-output/chaos-report.json "$L/chaos-short-report.json" 2>/dev/null
step chaos-full make test-chaos CHAOS_PROFILE=full
cp .test-output/chaos-report.json "$L/chaos-full-report.json" 2>/dev/null
cp .test-output/*.log "$L/" 2>/dev/null
step demo make demo DOCKER="$W"
step demo-down make demo-down DOCKER="$W" DELETE_DATA=1
echo "== done $(date -u +%FT%TZ)"
