#!/usr/bin/env bash
# Generates TF provider schemas to backend/src/main/resources/tf-schemas/.
#
# Requires: terraform >= 1.5
# Usage:    ./generate.sh [provider...]   (default: all providers in subdirs)
#
# Each provider directory must contain a main.tf pinning the provider version.
# The script runs `terraform init` then `terraform providers schema -json`
# and writes the trimmed output to {provider}-{version}.json.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../src/main/resources/tf-schemas"
mkdir -p "$OUTPUT_DIR"

if ! command -v terraform >/dev/null 2>&1; then
  echo "ERROR: terraform CLI not found in PATH" >&2
  exit 1
fi

providers=("$@")
if [ ${#providers[@]} -eq 0 ]; then
  for d in "$SCRIPT_DIR"/*/; do
    [ -f "$d/main.tf" ] && providers+=("$(basename "$d")")
  done
fi

for provider in "${providers[@]}"; do
  dir="$SCRIPT_DIR/$provider"
  if [ ! -d "$dir" ]; then
    echo "SKIP: $provider (no directory)" >&2
    continue
  fi

  echo "==> $provider: terraform init"
  (cd "$dir" && terraform init -upgrade -input=false >/dev/null)

  version=$(cd "$dir" && terraform version -json | jq -r --arg p "$provider" \
    '.provider_selections | to_entries[] | select(.key | endswith($p)) | .value')

  if [ -z "$version" ] || [ "$version" = "null" ]; then
    echo "ERROR: could not detect provider version for $provider" >&2
    exit 1
  fi

  out="$OUTPUT_DIR/$provider-$version.json"
  echo "==> $provider: dumping schema to $out"
  (cd "$dir" && terraform providers schema -json) > "$out"
  echo "==> wrote $(wc -c < "$out" | tr -d ' ') bytes"
done

echo "Done."
