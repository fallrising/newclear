#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${1:-}"
SHA="${2:-}"

if [ $# -ne 2 ]; then
    echo "Usage: $(basename "$0") <app-name> <40-lowercase-hex-sha>" >&2
    exit 1
fi

if [ "$APP_NAME" != "twitter-deck" ]; then
    echo "Error: unknown application '$APP_NAME'. Expected 'twitter-deck'." >&2
    exit 1
fi

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Error: invalid image reference '$SHA'. Must be exactly 40 lowercase hexadecimal characters." >&2
    exit 1
fi

DEPLOY_ROOT="${OBECHOW_DEPLOY_ROOT:-/srv/apps}"
APP_DIR="$DEPLOY_ROOT/$APP_NAME"

if [ ! -d "$APP_DIR" ]; then
    echo "Error: application directory '$APP_DIR' not found." >&2
    exit 1
fi

cd "$APP_DIR"

export TAG="$SHA"

docker compose config --quiet

docker compose pull app

docker compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app

printf 'Deployed %s at ghcr.io/fallrising/obechow:%s\n' "$APP_NAME" "$SHA"
