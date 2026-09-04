#!/usr/bin/env sh
# Run all multi-node cluster scenarios against a live cluster.
set -eu

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
export CLARKQ_CLUSTER_DIR="$DIR"

# shellcheck source=lib.sh
. "$DIR/lib.sh"

echo
cyan "clarkQ multi-node cluster demo"
dim  "URL=${CLARKQ_URL}"
dim  "NODES=${CLARKQ_NODES}"
dim  "mode=${CLARKQ_CLUSTER_MODE:-local}  key=${CLARKQ_API_KEY}"
echo

wait_cluster_healthy 2 60 || {
  summary
  exit 1
}

# shellcheck disable=SC1090
for s in \
  "$DIR/scenarios/01_membership.sh" \
  "$DIR/scenarios/02_shard_forward.sh" \
  "$DIR/scenarios/03_replication.sh" \
  "$DIR/scenarios/04_failover.sh" \
  "$DIR/scenarios/05_quorum_smoke.sh" \
  "$DIR/scenarios/06_load_smoke.sh" \
  "$DIR/scenarios/07_linearizable_lease_smoke.sh"
do
  . "$s"
done

summary
