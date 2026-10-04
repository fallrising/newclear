#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker required for real pg-jev integration' >&2; exit 2; }
image="pg-jev-router-lab:8d9598d"
docker build -t "$image" .
docker run --rm --network none --cpus 2 --memory 1g --pids-limit 256 \
  --tmpfs /var/lib/postgresql/data:rw,size=256m "$image"
