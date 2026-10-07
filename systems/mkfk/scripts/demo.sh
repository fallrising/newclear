#!/bin/sh
# Starts a fresh three-broker Compose experiment and walks the M7 demo.
# It refuses to reuse volumes from an earlier run, and it only touches the
# containers, network, and volumes of its own Compose project.
set -eu
project=${COMPOSE_PROJECT:-mkfk-demo}
docker=${DOCKER:-docker}
compose="$docker compose -p $project -f deploy/compose.yaml"
if [ -n "$($docker volume ls -q --filter "label=com.docker.compose.project=$project")" ]; then
	echo "project $project already has volumes; run 'make demo-down DELETE_DATA=1' to start fresh" >&2
	exit 1
fi
$compose up -d --quiet-pull broker-1 broker-2 broker-3
${GO:-go} run ./cmd/mkfkdemo -project "$project" -docker "$docker"
