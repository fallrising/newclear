#!/bin/sh
# Runs the named top-level tests and fails unless every one of them ran and
# passed, so a renamed or deleted test cannot turn a gate green. The full
# verbose output, including any failing seed and event history, is kept in
# $MKFK_TEST_LOG.
set -u
packages=$1
shift
log=${MKFK_TEST_LOG:?MKFK_TEST_LOG is required}
pattern=$(printf '%s|' "$@")
pattern="^(${pattern%|})\$"
mkdir -p "$(dirname "$log")"
${GO:-go} test -count=1 -v -run "$pattern" $packages >"$log" 2>&1
status=$?
grep -E '^(--- |ok|FAIL)' "$log"
missing=0
for name in "$@"; do
	if ! grep -q "^--- PASS: $name " "$log"; then
		echo "required test did not pass: $name" >&2
		missing=1
	fi
done
echo "full output: $log"
test "$status" -eq 0 && test "$missing" -eq 0
