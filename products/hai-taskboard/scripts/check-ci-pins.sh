#!/usr/bin/env bash
set -euo pipefail

component_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
repository_dir="$(cd -- "$component_dir/../.." && pwd)"
workflow="$repository_dir/.github/workflows/hai-taskboard-ci.yml"
documentation="$component_dir/docs/reproducibility.md"

fail() { printf 'CI pin check: %s\n' "$*" >&2; exit 1; }
equal() { [[ "$1" == "$2" ]] || fail "$3: expected '$2', got '$1'"; }
one() {
  local value
  value="$(sed -n "$1" "$2")"
  [[ -n "$value" && "$value" != *$'\n'* ]] || fail "missing or ambiguous pin in $2"
  printf '%s' "$value"
}

backend_image="$(one 's/^| Backend image | `\([^`]*\)` |$/\1/p' "$documentation")"
web_image="$(one 's/^| Web image | `\([^`]*\)` |$/\1/p' "$documentation")"
[[ "$backend_image" =~ ^golang:([0-9]+\.[0-9]+\.[0-9]+)-bookworm@sha256:[0-9a-f]{64}$ ]] || fail 'invalid backend image pin'
go_version="${BASH_REMATCH[1]}"
[[ "$web_image" =~ ^node:([0-9]+\.[0-9]+\.[0-9]+)-bookworm-slim@sha256:[0-9a-f]{64}$ ]] || fail 'invalid web image pin'
node_version="${BASH_REMATCH[1]}"
pnpm_version="$(one 's/^| Node\/pnpm | Node `[^`]*` LTS; pnpm `\([^`]*\)` |$/\1/p' "$documentation")"

equal "$(one 's/^      image: \(golang:.*\)$/\1/p' "$workflow")" "$backend_image" 'backend image'
equal "$(one 's/^      image: \(node:.*\)$/\1/p' "$workflow")" "$web_image" 'web image'
equal "$(one 's/^toolchain \(.*\)$/\1/p' "$component_dir/backend/go.mod")" "go$go_version" 'Go toolchain'
equal "$(one 's/^go \(.*\)$/\1/p' "$component_dir/backend/go.mod")" "${go_version%.*}" 'Go language version'
equal "$(one 's/^| Go module\/toolchain | `\([^`]*\)`; `\([^`]*\)` |$/\1; \2/p' "$documentation")" "go ${go_version%.*}; toolchain go$go_version" 'documented Go toolchain'
equal "$(cat "$component_dir/web/.node-version")" "$node_version" 'Node version file'
equal "$(one 's/^| Node\/pnpm | Node `\([^`]*\)` LTS; pnpm `[^`]*` |$/\1/p' "$documentation")" "$node_version" 'documented Node version'
equal "$(one 's/^  "packageManager": "\([^"]*\)",$/\1/p' "$component_dir/web/package.json")" "pnpm@$pnpm_version" 'package manager'
equal "$(one 's/^    "node": "\([^"]*\)"$/\1/p' "$component_dir/web/package.json")" "${node_version%.*}.x" 'Node engine'
equal "$(one 's/^          npm install --global --ignore-scripts --no-package-lock pnpm@\(.*\)$/\1/p' "$workflow")" "$pnpm_version" 'pnpm bootstrap'

case "${1:-static}" in
  static) ;;
  backend)
    export GOTOOLCHAIN=local
    equal "$(go env GOVERSION)" "go$go_version" 'Go runtime'
    ;;
  web-runtime|web)
    equal "$(node --version)" "v$node_version" 'Node runtime'
    if [[ "$1" == web ]]; then
      equal "$(pnpm --version)" "$pnpm_version" 'pnpm runtime'
    fi
    ;;
  *) fail 'usage: check-ci-pins.sh [static|backend|web-runtime|web]' ;;
esac
printf 'CI pins agree (%s).\n' "${1:-static}"
