#!/bin/sh
# Manual local run. Not invoked by CI.
# Builds the current checkout into the existing three-broker image, starts
# that compose project with the one-partition topology, and records whether
# finding 4 appears. No netem and no injected disk latency.
set -eu
cd "$(dirname "$0")/.."
project=mkfk-silent-follower
docker=${DOCKER:-docker}
out=${OUT:-docs/benchmarks/silent-follower}

compose() {
	# shellcheck disable=SC2086
	$docker compose -p "$project" -f deploy/compose.yaml -f deploy/compose.silent-follower.yaml "$@"
}

if [ -n "$($docker volume ls -q --filter "label=com.docker.compose.project=$project")" ]; then
	echo "project $project already has volumes; run: $docker compose -p $project -f deploy/compose.yaml -f deploy/compose.silent-follower.yaml down --volumes" >&2
	exit 1
fi

make image DOCKER="$docker"
cleanup() {
	compose down --volumes
}
trap cleanup EXIT
compose up -d broker-1 broker-2 broker-3
go run ./cmd/mkfkbench --silent-follower --out "$out" \
	--commit "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
	--compose-project "$project" --docker "$docker"
