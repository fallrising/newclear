#!/bin/sh
# Run all demo scenarios against a live clarkQ (host or docker network).
set -eu

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# Export for scenarios that need compose paths (e.g. restart test).
export CLARKQ_DEMO_DIR="$DIR"
: "${CLARKQ_DEMO_COMPOSE:=$DIR/docker-compose.yml}"
: "${CLARKQ_DEMO_PROJECT:=clarkqdemo}"
export CLARKQ_DEMO_COMPOSE CLARKQ_DEMO_PROJECT

# shellcheck source=lib.sh
. "$DIR/lib.sh"

echo
cyan "clarkQ capability demo"
dim  "URL=${CLARKQ_URL}  key=${CLARKQ_API_KEY}"
echo

wait_healthy 90 || {
  summary
  exit 1
}

# shellcheck disable=SC1091
for s in \
  "$DIR/scenarios/01_health_and_ui.sh" \
  "$DIR/scenarios/02_task_queue.sh" \
  "$DIR/scenarios/03_auth.sh" \
  "$DIR/scenarios/04_tenants.sh" \
  "$DIR/scenarios/05_persistence.sh" \
  "$DIR/scenarios/06_metrics_and_longpoll.sh"
do
  # Each scenario sources lib and mutates PASS/FAIL in current shell
  # shellcheck disable=SC1090
  . "$s"
done

summary
