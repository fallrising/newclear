#!/usr/bin/env bash
set -euo pipefail

component_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$component_dir/scripts/check-ci-pins.sh" web
cd -- "$component_dir/web"

pnpm install --frozen-lockfile --ignore-scripts
pnpm run format
pnpm run lint
pnpm run test
# The existing build script runs tsc --noEmit before the production Vite build.
pnpm run build
