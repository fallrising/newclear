#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$root/deploy/compose/docker-compose.yml"
project="ojbquay-demo"

docker compose -p "$project" -f "$compose_file" --profile e2e \
  down --volumes --remove-orphans

echo "DEMO_REMOVED project=$project"
